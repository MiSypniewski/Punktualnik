import Joi from "joi";
import dayjs from "dayjs";
import db from "./db";
import { ABSENCE_KIND_KEYS } from "./absenceKinds";
import { countWorkingDays } from "./workingDays";

// Zakładanie nieobecności — wniosek pracownika ALBO wpis kierownika.
//
// Daty to gołe 'YYYY-MM-DD', jak w Overtime i TaskEntries.data, a nie ISO
// z offsetem jak Times.data: nieobecność dotyczy całych dni, więc porównania
// są zwykłym porównaniem stringów i nie zależą od strefy serwera.

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const schema = Joi.object({
  userID: Joi.number().integer().positive().required(),
  kind: Joi.string()
    .valid(...ABSENCE_KIND_KEYS)
    .required(),
  dateFrom: Joi.string().pattern(DATE).required(),
  dateTo: Joi.string().pattern(DATE).required(),
  reason: Joi.string().trim().max(500).allow("").default(""),
}).messages({
  "any.required": "Uzupełnij wszystkie pola wniosku.",
  "any.only": "Nieznany rodzaj nieobecności.",
  "string.pattern.base": "Podaj daty w formacie RRRR-MM-DD.",
  "string.max": "Opis jest za długi (najwyżej 500 znaków).",
});

const fail = (code, message) => {
  const err = new Error(message);
  err.code = code;
  throw err;
};

// Nachodzenie na siebie sprawdzamy wyłącznie wobec wniosków ŻYWYCH: odrzucony
// i anulowany nie zajmują kalendarza. Warunek zakresów jest klasyczny —
// początek jednego przed końcem drugiego i odwrotnie; dni graniczne liczą się,
// bo urlop kończący się w piątek i zaczynający w ten sam piątek to kolizja.
const stmtOverlap = db.prepare(`
  SELECT id, kind, dateFrom, dateTo FROM Absences
   WHERE userID = @userID
     AND status IN ('pending', 'approved')
     AND dateFrom <= @dateTo
     AND dateTo >= @dateFrom
   LIMIT 1`);

const insert = db.prepare(`
  INSERT INTO Absences (userID, kind, dateFrom, dateTo, year, workDays, reason,
                        status, createdAt, createdBy, createdByName,
                        decidedAt, decidedBy, decidedByName)
  VALUES (@userID, @kind, @dateFrom, @dateTo, @year, @workDays, @reason,
          @status, @createdAt, @createdBy, @createdByName,
          @decidedAt, @decidedBy, @decidedByName)`);

const findById = db.prepare(`SELECT * FROM Absences WHERE id = ?`);

const pl = (date) => dayjs(date).format("DD.MM.YYYY");

/**
 * @param {object} payload
 * @param {boolean} [payload.autoApprove] wpis kierownika — od razu zatwierdzony,
 *   bo zakłada go osoba, która i tak by go akceptowała
 * @param {number} payload.createdBy       kto zakłada (z tokenu)
 * @param {string} payload.createdByName   podpis, denormalizowany świadomie
 * @returns {object} zapisany wiersz
 */
const createAbsence = async ({ autoApprove = false, createdBy, createdByName, ...payload }) => {
  const value = await schema.validateAsync(payload);
  const { userID, kind, dateFrom, dateTo, reason } = value;

  if (dateTo < dateFrom) {
    fail("bad_range", "Data „do” jest wcześniejsza niż „od”.");
  }

  // Wniosek nie przechodzi przez sylwestra. Pula urlopowa rozlicza się rocznie,
  // więc zakres 28.12–3.01 musiałby rozdzielić dni na dwa salda — a wtedy jeden
  // wniosek miałby dwa wymiary i dwie historie. Prościej i uczciwiej poprosić
  // o dwa wnioski raz na rok, niż tłumaczyć potem, czemu saldo się nie zgadza.
  const year = Number(dateFrom.slice(0, 4));
  if (Number(dateTo.slice(0, 4)) !== year) {
    fail(
      "year_boundary",
      "Nieobecność nie może przechodzić przez koniec roku — podziel ją na dwa wnioski."
    );
  }

  const workDays = countWorkingDays(dateFrom, dateTo);
  if (workDays === 0) {
    fail(
      "no_working_days",
      "W tym zakresie nie ma ani jednego dnia roboczego — sprawdź daty."
    );
  }

  const clash = stmtOverlap.get({ userID, dateFrom, dateTo });
  if (clash) {
    fail("overlap", `Ten zakres nachodzi na nieobecność ${pl(clash.dateFrom)}–${pl(clash.dateTo)}.`);
  }

  const now = dayjs().format();
  const info = insert.run({
    userID,
    kind,
    dateFrom,
    dateTo,
    year,
    workDays,
    reason,
    status: autoApprove ? "approved" : "pending",
    createdAt: now,
    createdBy: createdBy ?? null,
    createdByName: createdByName ?? null,
    // Wpis kierownika jest zatwierdzony w chwili powstania, więc podpis decyzji
    // to ten sam człowiek i ten sam moment. Bez tego historia pokazywałaby
    // "zatwierdzony przez nikogo".
    decidedAt: autoApprove ? now : null,
    decidedBy: autoApprove ? createdBy ?? null : null,
    decidedByName: autoApprove ? createdByName ?? null : null,
  });

  return findById.get(info.lastInsertRowid);
};

export default createAbsence;
