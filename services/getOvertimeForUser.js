import db from "./db";

// Pełna historia jednego pracownika — wszystkie statusy, najnowsze na górze.
// Sortowanie po id na drugim miejscu porządkuje wnioski z tego samego dnia
// w kolejności składania.
const stmt = db.prepare(
  `SELECT * FROM Overtime
   WHERE userID = @userID
   ORDER BY data DESC, id DESC`
);

const getOvertimeForUser = (userID) => stmt.all({ userID: Number(userID) });

export default getOvertimeForUser;
