import dayjs from "dayjs";
import db from "./db";

// Anulowanie własnego wniosku przez pracownika.
//
// Własność sprawdza SQL (`userID = @userID`), a nie kod wołający — dokładnie jak
// w cancelOvertimeRequest.js. Dzięki temu nawet błąd w warstwie API nie pozwoli
// anulować cudzego wniosku.
//
// Tylko z `pending`: zatwierdzony urlop odwołuje kierownik, bo pula jest już
// pomniejszona, a w kalendarzu zespołu ktoś na tej nieobecności polega.
const update = db.prepare(`
  UPDATE Absences
     SET status = 'cancelled', decidedAt = @decidedAt
   WHERE id = @id AND userID = @userID AND status = 'pending'`);

const findById = db.prepare(`SELECT * FROM Absences WHERE id = ?`);

/**
 * @returns {{changed: boolean, absence: object|undefined}}
 *   changed === false znaczy "cudzy ALBO już rozpatrzony" — świadomie bez
 *   rozróżnienia, żeby nie potwierdzać istnienia cudzego id.
 */
const cancelAbsence = ({ id, userID }) => {
  const info = update.run({
    id: Number(id),
    userID: Number(userID),
    decidedAt: dayjs().format(),
  });

  return { changed: info.changes > 0, absence: findById.get(Number(id)) };
};

export default cancelAbsence;
