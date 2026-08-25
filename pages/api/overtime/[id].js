import { getToken } from "next-auth/jwt";
import decideOvertimeRequest from "../../../services/decideOvertimeRequest";
import cancelOvertimeRequest from "../../../services/cancelOvertimeRequest";
import revokeOvertimeRequest from "../../../services/revokeOvertimeRequest";
import { canApproveOvertime } from "../../../services/roles";
import { canSeeUser } from "../../../services/scope";
import getUserData from "../../../services/getUserData";
import findOvertimeRequest from "../../../services/getOvertimeRequestById";

// "cancel" jest osobno, bo to akcja pracownika, nie kierownika.
// "revoke" też stoi osobno, ale z odwrotnego powodu: to jedyna akcja, która
// działa na wniosku JUŻ ROZPATRZONYM, więc nie mieści się w tablicy decyzji.
const DECISIONS = { approve: "approved", reject: "rejected" };
const ALLOWED_ACTIONS = ["approve", "reject", "cancel", "revoke"];

// Tyle znaków przyjmuje pole notatki w panelu kierownika.
const NOTE_MAX = 300;

// eslint-disable-next-line import/no-anonymous-default-export
export default async (req, res) => {
  const token = await getToken({ req });
  if (!token) {
    return res.status(401).json({ error: "not_authorized" });
  }

  if (req.method !== "PUT") {
    res.setHeader("Allow", "PUT");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const { id } = req.query;
  if (!/^\d+$/.test(id ?? "")) {
    return res.status(400).json({ error: "bad_id" });
  }

  const { action, note } = req.body ?? {};
  // Lista, a nie `action in DECISIONS` — `in` przepuściłoby klucze
  // z prototypu obiektu ("toString", "constructor", ...).
  if (!ALLOWED_ACTIONS.includes(action)) {
    return res.status(400).json({ error: "bad_action" });
  }

  // Anulowanie — tylko własny wniosek i tylko dopóki oczekuje.
  // Obie te rzeczy sprawdza WHERE w cancelOvertimeRequest.
  if (action === "cancel") {
    const { changed, request } = cancelOvertimeRequest({ id, userID: token.userID });
    if (!changed) {
      // Nie rozróżniamy "cudzy wniosek" od "już rozpatrzony" — brak potwierdzenia,
      // czy wniosek o danym id w ogóle istnieje.
      return res.status(409).json({ error: "cannot_cancel" });
    }
    return res.status(200).json({ status: "cancelled", request });
  }

  if (!canApproveOvertime(token.role)) {
    return res.status(403).json({ error: "permission_denied" });
  }

  // Sama rola nie wystarczy: wniosek musi należeć do pracownika z sekcji, którą
  // ten kierownik obsługuje. Bez tego wystarczyłoby zgadnąć id, żeby decydować
  // o cudzym zespole, nawet nie widząc go na liście.
  const target = findOvertimeRequest(id);
  if (!target) {
    return res.status(404).json({ error: "not_found" });
  }
  const [author] = await getUserData(target.userID);
  if (!canSeeUser(token, author)) {
    return res.status(403).json({ error: "permission_denied" });
  }

  if (action === "revoke") {
    // Powód obowiązkowy. Cofnięcie rusza saldo, za którym stoją pieniądze,
    // a pracownik po miesiącu ma prawo wiedzieć, czemu jego godziny zniknęły.
    const reason = String(note ?? "").trim().slice(0, NOTE_MAX);
    if (!reason) {
      return res.status(422).json({ error: "reason_required" });
    }

    const { changed, request } = revokeOvertimeRequest({
      id,
      decidedBy: token.userID,
      fallbackName: token.name,
      reason,
    });

    if (!changed) {
      return res.status(409).json({ error: "already_revoked" });
    }

    return res.status(200).json({ status: "revoked", request });
  }

  const { changed, request } = decideOvertimeRequest({
    id,
    status: DECISIONS[action],
    decidedBy: token.userID,
    fallbackName: token.name,
    decisionNote: note,
  });

  if (!changed) {
    return res.status(409).json({ error: "already_decided" });
  }

  return res.status(200).json({ status: DECISIONS[action], request });
};
