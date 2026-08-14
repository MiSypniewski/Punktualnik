import db from "./db";

const stmt = db.prepare(`SELECT * FROM Overtime WHERE id = ?`);

/** Pojedynczy wniosek — potrzebny do sprawdzenia, czyj jest, zanim zapadnie decyzja. */
const getOvertimeRequestById = (id) => stmt.get(Number(id));

export default getOvertimeRequestById;
