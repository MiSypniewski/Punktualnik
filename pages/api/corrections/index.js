import { getActiveToken } from "../../../services/session";
import {
  createCorrection,
  getTodayCard,
  listForManager,
  listForUser,
  CORRECTION_STATUS_FOR,
} from "../../../services/cardCorrections";
import { canEditTimes, canTrackTasks } from "../../../services/roles";
import getUserData from "../../../services/getUserData";
import { notifyNewCardCorrection } from "../../../services/notifyGChat";
import { notifyCorrectionPending } from "../../../services/notifyMail";
import { visibleSections } from "../../../services/scope";
import { logApiError, publicError } from "../../../services/log";

// Zgłoszenia korekty dzisiejszej karty (services/cardCorrections.js).
//
// GET bez parametrów: własne zgłoszenia i dzisiejsza karta — dla formularza.
// GET ?scope=team: lista kierownika, zawężona do jego sekcji.
// POST: nowe zgłoszenie; userID WYŁĄCZNIE z tokenu.

// eslint-disable-next-line import/no-anonymous-default-export
export default async (req, res) => {
  const token = await getActiveToken(req);
  if (!token) {
    return res.status(401).json({ error: "not_authorized" });
  }

  if (req.method === "GET") {
    res.setHeader("Cache-Control", "no-store");
    if (req.query.scope === "team") {
      if (!canEditTimes(token.role)) {
        return res.status(403).json({ error: "permission_denied" });
      }
      return res.status(200).json({ requests: listForManager(visibleSections(token)) });
    }
    return res.status(200).json({
      today: getTodayCard(token.userID),
      requests: listForUser(token.userID),
    });
  }

  if (req.method === "POST") {
    // Kiosk (editor) to konto współdzielone — zgłoszenie nie miałoby właściciela.
    if (!canTrackTasks(token.role)) {
      return res.status(403).json({ error: "permission_denied" });
    }

    const { start, end, open, reason } = req.body ?? {};
    try {
      const request = createCorrection({ userID: token.userID, start, end, open: open === true, reason });

      // Bez await, jak przy nadgodzinach — pracownik nie czeka na Google i SMTP.
      const [author] = await getUserData(token.userID);
      notifyNewCardCorrection(request, author).catch(() => {});
      notifyCorrectionPending(request, author).catch(() => {});

      return res.status(201).json({ status: "created", request });
    } catch (error) {
      const status = CORRECTION_STATUS_FOR[error.code] ?? 422;
      logApiError("api/corrections", error, status, { userID: token.userID });
      return res.status(status).json({ error: publicError(error).code || "invalid", message: publicError(error).message });
    }
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "method_not_allowed" });
};
