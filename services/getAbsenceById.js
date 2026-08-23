import db from "./db";

// Potrzebne wyłącznie po to, żeby PRZED decyzją sprawdzić, czyj jest wniosek —
// sama rola kierownika nie wystarcza, musi jeszcze obsługiwać sekcję autora
// (services/scope.js: canSeeUser). Ten sam zabieg co getOvertimeRequestById.js.
const stmt = db.prepare(`SELECT * FROM Absences WHERE id = ?`);

export const getAbsenceById = (id) => stmt.get(Number(id));

export default getAbsenceById;
