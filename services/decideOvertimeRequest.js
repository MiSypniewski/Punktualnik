import dayjs from "dayjs";
import db from "./db";

const findById = db.prepare(`SELECT * FROM Overtime WHERE id = ?`);

// Warunek status = 'pending' jest częścią UPDATE, nie osobnym SELECT-em przed
// nim. Dzięki temu dwa równoległe kliknięcia (albo dwie zakładki kierownika)
// nie nadpiszą sobie decyzji — drugi UPDATE zmieni 0 wierszy i wołający
// dostanie informację, że wniosek był już rozpatrzony.
const update = db.prepare(
  `UPDATE Overtime
   SET status = @status,
       decidedAt = @decidedAt,
       decidedBy = @decidedBy,
       decidedByName = @decidedByName,
       decisionNote = @decisionNote
   WHERE id = @id AND status = 'pending'`
);

/**
 * @param {{id: number, status: "approved"|"rejected", decidedBy: number,
 *          decidedByName: string, decisionNote?: string}} payload
 * @returns {{changed: boolean, request: object|undefined}}
 */
const decideOvertimeRequest = ({ id, status, decidedBy, decidedByName, decisionNote }) => {
  if (status !== "approved" && status !== "rejected") {
    throw new Error("bad_status");
  }

  const info = update.run({
    id: Number(id),
    status,
    decidedAt: dayjs().format(),
    decidedBy: Number(decidedBy),
    decidedByName: decidedByName ?? null,
    decisionNote: decisionNote || null,
  });

  return { changed: info.changes > 0, request: findById.get(Number(id)) };
};

export default decideOvertimeRequest;
