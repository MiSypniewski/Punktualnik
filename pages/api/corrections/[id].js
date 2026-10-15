import { getToken } from "next-auth/jwt";
import {
  cancelCorrection,
  decideCorrection,
  getCorrection,
  CORRECTION_STATUS_FOR,
} from "../../../services/cardCorrections";
import { canEditTimes } from "../../../services/roles";
import { canSeeUser } from "../../../services/scope";
import getUserData from "../../../services/getUserData";
import { notifyCorrectionDecided } from "../../../services/notifyMail";
import { logApiError } from "../../../services/log";

// Decyzja o zgłoszeniu korekty karty. Kolejność sprawdzeń jak w
// pages/api/overtime/[id].js: token → akcja → (anulowanie pracownika) → rola
// → zgłoszenie istnieje → zasięg → decyzja.

const DECISIONS = { approve: "approved", reject: "rejected" };
const ALLOWED_ACTIONS = ["approve", "reject", "cancel"];
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
  if (!ALLOWED_ACTIONS.includes(action)) {
    return res.status(400).json({ error: "bad_action" });
  }

  if (action === "cancel") {
    const { changed, request } = cancelCorrection({ id, userID: token.userID });
    if (!changed) {
      return res.status(409).json({ error: "cannot_cancel" });
    }
    return res.status(200).json({ status: "cancelled", request });
  }

  if (!canEditTimes(token.role)) {
    return res.status(403).json({ error: "permission_denied" });
  }

  const target = getCorrection(id);
  if (!target) {
    return res.status(404).json({ error: "not_found" });
  }
  // Zasięg po BIEŻĄCEJ sekcji pracownika — jak przy dopisaniu karty
  // (pages/api/time/manage/index.js) i jak przy wnioskach nadgodzinowych.
  const [author] = await getUserData(target.userID);
  if (!canSeeUser(token, author)) {
    return res.status(403).json({ error: "permission_denied" });
  }

  try {
    const result = decideCorrection({
      id,
      status: DECISIONS[action],
      actor: { userID: token.userID, name: token.name },
      decisionNote: String(note ?? "").trim().slice(0, NOTE_MAX),
    });

    if (!result.changed) {
      return res.status(409).json({ error: "already_decided" });
    }

    notifyCorrectionDecided(result.request, author, result.card).catch(() => {});

    return res.status(200).json({ status: DECISIONS[action], request: result.request, card: result.card });
  } catch (error) {
    const status = CORRECTION_STATUS_FOR[error.code] ?? 422;
    logApiError("api/corrections/[id]", error, status, { correctionID: Number(id), by: token.userID });
    return res.status(status).json({ error: error.code || "invalid", message: error.message });
  }
};
