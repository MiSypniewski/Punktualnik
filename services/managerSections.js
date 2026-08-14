import db from "./db";

const stmtGet = db.prepare(`SELECT section FROM ManagerSections WHERE managerID = ? ORDER BY section`);
const stmtDelete = db.prepare(`DELETE FROM ManagerSections WHERE managerID = ?`);
const stmtInsert = db.prepare(`INSERT OR IGNORE INTO ManagerSections (managerID, section) VALUES (?, ?)`);

/** @returns {string[]} sekcje obsługiwane przez kierownika (może być pusta) */
export const getManagerSections = (managerID) => stmtGet.all(Number(managerID)).map((r) => r.section);

// Podmiana kompletu przypisań w jednej transakcji — inaczej błąd w środku
// zostawiłby kierownika z połową sekcji.
export const setManagerSections = db.transaction((managerID, sections) => {
  stmtDelete.run(Number(managerID));
  for (const section of sections) {
    const value = String(section).trim();
    if (value) stmtInsert.run(Number(managerID), value);
  }
  return getManagerSections(managerID);
});

export default getManagerSections;
