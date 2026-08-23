import dayjs from "dayjs";
import db from "./db";

// Decyzja kierownika. Kopia wzorca z decideOvertimeRequest.js — łącznie
// z najważniejszym szczegółem: `AND status = 'pending'` siedzi W UPDATE, a nie
// w osobnym SELECT przed nim. To optimistic lock. Dwie otwarte karty kierownika
// nie nadpiszą sobie decyzji: drugi UPDATE zmieni zero wierszy, a wołający
// dostanie `changed === false` i zamieni to na 409.
const update = db.prepare(`
  UPDATE Absences
     SET status = @status, decidedAt = @decidedAt, decidedBy = @decidedBy,
         decidedByName = @decidedByName, decisionNote = @decisionNote
   WHERE id = @id AND status = 'pending'`);

const findById = db.prepare(`SELECT * FROM Absences WHERE id = ?`);

// Token JWT niesie samo imię, a pod historyczną decyzją ma stać pełny podpis.
const findDecider = db.prepare(`SELECT name, surname FROM Users WHERE id = ?`);

/**
 * @returns {{changed: boolean, absence: object|undefined}}
 */
const decideAbsence = ({ id, status, decidedBy, fallbackName, decisionNote = "" }) => {
  if (status !== "approved" && status !== "rejected") {
    throw new Error("bad_status");
  }

  const decider = findDecider.get(Number(decidedBy));
  const decidedByName = decider ? `${decider.name} ${decider.surname}` : fallbackName ?? null;

  const info = update.run({
    id: Number(id),
    status,
    decidedAt: dayjs().format(),
    decidedBy: Number(decidedBy),
    decidedByName,
    decisionNote: decisionNote || null,
  });

  return { changed: info.changes > 0, absence: findById.get(Number(id)) };
};

export default decideAbsence;
