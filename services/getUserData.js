import db from "./db";

// Kolumny jawnie — bez passwordHash i passwordSalt. Wcześniej `SELECT *` ciągnął
// je z bazy przy KAŻDYM sprawdzeniu uprawnień (a robi to niemal każdy endpoint),
// żeby zaraz podmienić na ";)" w JS. Do weryfikacji hasła służy
// services/authorizeUser.js i to jedyne miejsce, które tych pól potrzebuje.
const stmt = db.prepare(
  `SELECT id, name, surname, section, location, email, role, isActive
     FROM Users WHERE id = ?`
);

const getUserData = async (userID) => {
  const user = stmt.get(Number(userID));
  if (!user) return [];

  // ID (wielkimi literami) to nazwa używana przez formularze i karty.
  return [{ ...user, ID: user.id }];
};

export default getUserData;
