import Joi from "joi";
import dayjs from "dayjs";
import db from "./db";
import { KIND_KEYS } from "./overtimeKinds";

// `data` to zwykłe YYYY-MM-DD — świadomie inaczej niż w Times, gdzie dzień jest
// znacznikiem ISO przypiętym do 03:00. Tu nie ma nic do przypinania: wniosek
// dotyczy całego dnia, a porównania dat są zwykłym porównaniem stringów.
const schema = Joi.object({
  userID: Joi.number().integer().positive().required(),
  kind: Joi.string()
    .valid(...KIND_KEYS)
    .required(),
  data: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
  // Górny limit to doba — chroni przed literówką w stylu "800 godzin".
  minutes: Joi.number().integer().min(1).max(24 * 60).required(),
  reason: Joi.string().max(500).allow("").default(""),
});

const insert = db.prepare(
  `INSERT INTO Overtime (userID, kind, data, minutes, reason, status, createdAt)
   VALUES (@userID, @kind, @data, @minutes, @reason, 'pending', @createdAt)`
);

const findById = db.prepare(`SELECT * FROM Overtime WHERE id = ?`);

const createOvertimeRequest = async (payload) => {
  const value = await schema.validateAsync(payload);
  const info = insert.run({ ...value, createdAt: dayjs().format() });
  return findById.get(info.lastInsertRowid);
};

export default createOvertimeRequest;
