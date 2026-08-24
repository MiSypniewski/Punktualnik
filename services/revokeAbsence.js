import dayjs from "dayjs";
import db from "./db";

const findById = db.prepare(`SELECT * FROM Absences WHERE id = ?`);

const findDecider = db.prepare(`SELECT name, surname FROM Users WHERE id = ?`);

// Cofnięcie nieobecności przez kierownika — bliźniak revokeOvertimeRequest.js.
//
// Najczęstszy przypadek to rezygnacja z URLOPU JUŻ ZATWIERDZONEGO: pracownik
// sam go nie anuluje (services/cancelAbsence.js działa tylko na 'pending'), bo
// pula jest już pomniejszona, a ktoś na tej nieobecności planował zmiany.
//
// Po zmianie statusu na 'revoked' dni wracają do puli same — leaveBalance.js
// sumuje wyłącznie 'approved'. Tak samo znika kafelek nieobecności na kiosku
// i dopisek przy nazwisku w "Teraz w toku" (getAbsencesForDay.js, liveBoard.js).
// Ten sam termin da się zgłosić ponownie, bo kontrola nakładania się wniosków
// patrzy tylko na 'pending' i 'approved' (services/createAbsence.js).
const update = db.prepare(`
  UPDATE Absences
     SET status = 'revoked',
         decidedAt = @decidedAt,
         decidedBy = @decidedBy,
         decidedByName = @decidedByName,
         decisionNote = @decisionNote
   WHERE id = @id AND status != 'revoked'`);

/**
 * @param {{id: number, decidedBy: number, fallbackName?: string, reason: string}} payload
 * @returns {{changed: boolean, absence: object|undefined}}
 */
const revokeAbsence = ({ id, decidedBy, fallbackName, reason }) => {
  const decider = findDecider.get(Number(decidedBy));
  const decidedByName = decider ? `${decider.name} ${decider.surname}` : fallbackName ?? null;

  const info = update.run({
    id: Number(id),
    decidedAt: dayjs().format(),
    decidedBy: Number(decidedBy),
    decidedByName,
    decisionNote: String(reason ?? "").trim() || null,
  });

  return { changed: info.changes > 0, absence: findById.get(Number(id)) };
};

export default revokeAbsence;
