import { getToken } from "next-auth/jwt";
import decideAbsence from "../../../services/decideAbsence";
import cancelAbsence from "../../../services/cancelAbsence";
import findAbsence from "../../../services/getAbsenceById";
import { canApproveLeave } from "../../../services/roles";
import { canSeeUser } from "../../../services/scope";
import getUserData from "../../../services/getUserData";

// Kopia bramek z pages/api/overtime/[id].js — ten sam obieg, więc ta sama
// kolejność sprawdzeń i te same kody odpowiedzi.
const DECISIONS = { approve: "approved", reject: "rejected" };
const ALLOWED_ACTIONS = ["approve", "reject", "cancel"];

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

  return res.status(200).json({ status: DECISIONS[action], absence });
};
