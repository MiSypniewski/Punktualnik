import db from "./db";

// Limit istnieje dlatego, że lista jedzie w całości do propsów SSR — czyli do
// HTML-a strony. Saldo liczy osobne zapytanie agregujące (services/leaveBalance.js),
// więc limit nie ma jak sfałszować puli.
export const USER_ABSENCE_LIMIT = 200;

const stmt = db.prepare(`
  SELECT * FROM Absences
   WHERE userID = @userID
   ORDER BY dateFrom DESC, id DESC
   LIMIT @limit`);

export const getAbsencesForUser = (userID, { limit = USER_ABSENCE_LIMIT } = {}) =>
  stmt.all({ userID: Number(userID), limit });

export default getAbsencesForUser;
