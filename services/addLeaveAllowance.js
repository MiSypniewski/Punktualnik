import Joi from "joi";
import dayjs from "dayjs";
import db from "./db";

// Dopisanie dni urlopu do puli pracownika na dany rok.
//
// Przydziału się NIE nadpisuje, tylko dokłada kolejny wiersz — pula ma historię.
// "26 dni na start roku", "4 dni zaległe z poprzedniego", "-2 dni korekta po
// zmianie wymiaru etatu" to trzy zdarzenia, a nie trzy wersje jednej liczby.
// Dlatego `days` bywa ujemne i to jest poprawne.

const schema = Joi.object({
  userID: Joi.number().integer().positive().required(),
  // Dolna granica z zapasem na wpisywanie zaległości wstecz, górna, żeby
  // literówka w roku ("2606") nie zakładała puli, której nikt nigdy nie znajdzie.
  year: Joi.number().integer().min(2020).max(2100).required(),
  // Zero nie jest przydziałem, tylko pomyłką. Granice chronią przed wpisaniem
  // "260" zamiast "26" — nikt nie ma trzystu dni urlopu.
  days: Joi.number().integer().invalid(0).min(-365).max(365).required(),
  note: Joi.string().trim().max(200).allow("").default(""),
}).messages({
  "any.required": "Uzupełnij pracownika, rok i liczbę dni.",
  "any.invalid": "Zero dni niczego nie zmienia — podaj liczbę dodatnią albo ujemną.",
  "number.min": "Liczba dni jest poza sensownym zakresem.",
  "number.max": "Liczba dni jest poza sensownym zakresem.",
  "number.base": "Podaj liczbę dni jako liczbę całkowitą.",
});

const insert = db.prepare(`
  INSERT INTO LeaveAllowance (userID, year, days, note, createdAt, createdBy, createdByName)
  VALUES (@userID, @year, @days, @note, @createdAt, @createdBy, @createdByName)`);

const findById = db.prepare(`SELECT * FROM LeaveAllowance WHERE id = ?`);

const addLeaveAllowance = async ({ createdBy, createdByName, ...payload }) => {
  const value = await schema.validateAsync(payload);

  const info = insert.run({
    ...value,
    createdAt: dayjs().format(),
    createdBy: createdBy ?? null,
    createdByName: createdByName ?? null,
  });

  return findById.get(info.lastInsertRowid);
};

// Historia przydziałów jednego pracownika — do pokazania pod saldem, żeby było
// widać, skąd wzięła się liczba dni.
const stmtHistory = db.prepare(`
  SELECT * FROM LeaveAllowance
   WHERE userID = @userID AND year = @year
   ORDER BY id DESC`);

export const getAllowanceHistory = (userID, year) =>
  stmtHistory.all({ userID: Number(userID), year: Number(year) });

export default addLeaveAllowance;
