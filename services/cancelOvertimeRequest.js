import dayjs from "dayjs";
import db from "./db";

const findById = db.prepare(`SELECT * FROM Overtime WHERE id = ?`);

// Własność wniosku i jego stan sprawdza SQL, nie kod wołający: warunek
// userID = @userID w WHERE sprawia, że nie da się anulować cudzego wniosku
// nawet przy błędzie w warstwie API. Po decyzji kierownika anulowanie
// przestaje działać (status nie jest już 'pending').
const update = db.prepare(
  `UPDATE Overtime
   SET status = 'cancelled', decidedAt = @decidedAt
   WHERE id = @id AND userID = @userID AND status = 'pending'`
);

/**
 * @returns {{changed: boolean, request: object|undefined}}
 */
const cancelOvertimeRequest = ({ id, userID }) => {
  const info = update.run({
    id: Number(id),
    userID: Number(userID),
    decidedAt: dayjs().format(),
  });

  return { changed: info.changes > 0, request: findById.get(Number(id)) };
};

export default cancelOvertimeRequest;
