import { getToken } from "next-auth/jwt";
import decideAbsence from "../../../services/decideAbsence";
import cancelAbsence from "../../../services/cancelAbsence";
import revokeAbsence from "../../../services/revokeAbsence";
import findAbsence from "../../../services/getAbsenceById";
import { canApproveLeave } from "../../../services/roles";
import { canSeeUser } from "../../../services/scope";
import getUserData from "../../../services/getUserData";
import { notifyAbsenceApproved } from "../../../services/notifyMail";

// Kopia bramek z pages/api/overtime/[id].js — ten sam obieg, więc ta sama
// kolejność sprawdzeń i te same kody odpowiedzi.
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
  // Lista, a nie `action in DECISIONS` — `in` przepuściłoby klucze z prototypu
  // obiektu ("toString", "constructor", ...).
  if (!ALLOWED_ACTIONS.includes(action)) {
    return res.status(400).json({ error: "bad_action" });
  }

  // Anulowanie — akcja pracownika. Że wniosek jest własny i wciąż oczekuje,
  // pilnuje WHERE w cancelAbsence, nie ten warunek.
  if (action === "cancel") {
    const { changed, absence } = cancelAbsence({ id, userID: token.userID });
    if (!changed) {
      return res.status(409).json({ error: "cannot_cancel" });
    }
    return res.status(200).json({ status: "cancelled", absence });
  }

  if (!canApproveLeave(token.role)) {
    return res.status(403).json({ error: "permission_denied" });
  }

  // Sama rola nie wystarczy: wniosek musi należeć do pracownika z sekcji, którą
  // ten kierownik obsługuje. Bez tego wystarczyłoby zgadnąć id, żeby decydować
  // o cudzym zespole, nawet nie widząc go na liście.
  const target = findAbsence(id);
  if (!target) {
    return res.status(404).json({ error: "not_found" });
  }
  const [author] = await getUserData(target.userID);
  if (!canSeeUser(token, author)) {
    return res.status(403).json({ error: "permission_denied" });
  }

  if (action === "revoke") {
    // Powód obowiązkowy: cofnięcie oddaje dni do puli i zdejmuje nieobecność
    // z kiosku, więc pracownik musi mieć w historii odpowiedź, co się stało.
    const reason = String(note ?? "").trim().slice(0, NOTE_MAX);
    if (!reason) {
      return res.status(422).json({ error: "reason_required" });
    }

    const { changed, absence } = revokeAbsence({
      id,
      decidedBy: token.userID,
      fallbackName: token.name,
      reason,
    });

    if (!changed) {
      return res.status(409).json({ error: "already_revoked" });
    }

    return res.status(200).json({ status: "revoked", absence });
  }

  const { changed, absence } = decideAbsence({
    id,
    status: DECISIONS[action],
    decidedBy: token.userID,
    fallbackName: token.name,
    decisionNote: note,
  });

  if (!changed) {
    return res.status(409).json({ error: "already_decided" });
  }

  // Mail leci WYŁĄCZNIE przy zatwierdzeniu i bez await — dokładnie tym samym
  // wzorcem co powiadomienie na czat (pages/api/absences/index.js). Niedostępny
  // serwer poczty nie ma prawa spowolnić ani wywrócić decyzji kierownika, która
  // jest już zapisana w bazie.
  if (action === "approve") {
    notifyAbsenceApproved(absence, author).catch(() => {});
  }

  return res.status(200).json({ status: DECISIONS[action], absence });
};
