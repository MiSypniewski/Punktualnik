import db from "./db";

// Pełna lista kont do filtra na stronie eksportu (bez maskowania haseł —
// zwracamy tylko pola potrzebne do dropdowna). Times.userID == Users.id.
const stmt = db.prepare(
  `SELECT id, name, surname, section FROM Users ORDER BY surname, name`
);

const getAllUsers = () => stmt.all();

export default getAllUsers;
