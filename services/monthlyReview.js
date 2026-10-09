import db from "./db";
import { now as appNow } from "./workday";

// Ocena miesiąca wpisywana przez kierownika: trzy podoceny, uzasadnienie
// i rekomendacje. Wszystko, co w raporcie jest osądem, a nie rachunkiem.

export const REVIEW_TEXT_MAX = 4000;

const COLUMNS = `month, userID, tech, docs, initiative, comment, actions, growth, updatedAt, updatedByName`;

const stmtGet = db.prepare(`SELECT ${COLUMNS} FROM MonthlyReviews WHERE month = ? AND userID = ?`);

// Ostatnia WCZEŚNIEJSZA ocena tej osoby — podpowiedź do formularza. Kompetencje
// nie zmieniają się co miesiąc, więc kierownik zwykle potwierdza te same liczby.
const stmtPrevious = db.prepare(
  `SELECT ${COLUMNS} FROM MonthlyReviews WHERE userID = ? AND month < ? ORDER BY month DESC LIMIT 1`
);

const stmtForUser = db.prepare(
  `SELECT ${COLUMNS} FROM MonthlyReviews WHERE userID = @userID AND month BETWEEN @from AND @to`
);

const stmtForMonth = db.prepare(`SELECT ${COLUMNS} FROM MonthlyReviews WHERE month = ?`);

const stmtSave = db.prepare(
  `INSERT INTO MonthlyReviews
     (month, userID, tech, docs, initiative, comment, actions, growth, updatedAt, updatedBy, updatedByName)
   VALUES (@month, @userID, @tech, @docs, @initiative, @comment, @actions, @growth, @updatedAt, @updatedBy, @updatedByName)
   ON CONFLICT(month, userID) DO UPDATE SET
     tech = @tech, docs = @docs, initiative = @initiative,
     comment = @comment, actions = @actions, growth = @growth,
     updatedAt = @updatedAt, updatedBy = @updatedBy, updatedByName = @updatedByName`
);

export const getReview = (month, userID) => stmtGet.get(month, Number(userID)) || null;

export const getPreviousReview = (month, userID) => stmtPrevious.get(Number(userID), month) || null;

/** Oceny jednej osoby z zakresu miesięcy, jako mapa 'YYYY-MM' → ocena. */
export const getReviewsForUser = (userID, from, to) =>
  new Map(stmtForUser.all({ userID: Number(userID), from, to }).map((r) => [r.month, r]));

/** Oceny wszystkich osób za miesiąc, jako mapa userID → ocena. */
export const getReviewsForMonth = (month) => new Map(stmtForMonth.all(month).map((r) => [r.userID, r]));

/**
 * @param {object} review
 * @param {{id: number, name: string}} by
 */
export const saveReview = ({ month, userID, tech, docs, initiative, comment, actions, growth }, by) => {
  stmtSave.run({
    month,
    userID: Number(userID),
    tech,
    docs,
    initiative,
    comment,
    actions,
    growth,
    updatedAt: appNow().format("YYYY-MM-DD HH:mm:ss"),
    updatedBy: by?.id ?? null,
    updatedByName: by?.name ?? null,
  });
  return getReview(month, userID);
};
