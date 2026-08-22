import db from "./db";

// Historia jednego pracownika — wszystkie statusy, najnowsze na górze.
// Sortowanie po id na drugim miejscu porządkuje wnioski z tego samego dnia
// w kolejności składania.
//
// Z limitem, bo ta lista idzie w całości do propsów SSR strony /nadgodziny,
// czyli do HTML-a wysyłanego przeglądarce. Wniosków się nie kasuje, więc bez
// przycięcia rosłaby w nieskończoność. Saldo liczy osobne zapytanie agregujące
// (services/getOvertimeBalance.js), więc limit nie ma wpływu na wyliczenia.
export const USER_HISTORY_LIMIT = 200;

const stmt = db.prepare(
  `SELECT * FROM Overtime
   WHERE userID = @userID
   ORDER BY data DESC, id DESC
   LIMIT @limit`
);

const getOvertimeForUser = (userID, { limit = USER_HISTORY_LIMIT } = {}) =>
  stmt.all({ userID: Number(userID), limit });

export default getOvertimeForUser;
