import db from "./db";

// Lista nieobecności dla kierownika — filtry składane z klocków.
//
// Wzorzec przepisany z getOvertimeRequests.js: do SQL trafiają wyłącznie stałe
// z tego pliku, wartości zawsze przez binding (@param), a gotowe statementy
// siedzą w cache pod kluczem złożonym z użytych filtrów. Bez cache'u każde
// wejście na stronę przygotowywałoby zapytanie od nowa.

const BASE = `
  SELECT a.*, u.name, u.surname, u.section, u.location
    FROM Absences a
    JOIN Users u ON u.id = a.userID`;

// Oczekujące zawsze na górze — to jedyna sekcja, w której kierownik ma coś DO
// ZROBIENIA; reszta jest do czytania.
const ORDER = `
  ORDER BY (a.status = 'pending') DESC, a.dateFrom DESC, a.id DESC`;

const CONDITIONS = {
  status: `a.status = @status`,
  kind: `a.kind = @kind`,
  userID: `a.userID = @userID`,
  year: `a.year = @year`,
  // Zakres dat pyta o PRZECIĘCIE z nieobecnością, nie o zawieranie się w niej:
  // filtr "sierpień" ma pokazać urlop 28.07–5.08, bo on trwał w sierpniu.
  from: `a.dateTo >= @from`,
  to: `a.dateFrom <= @to`,
};

export const ABSENCE_LIST_LIMIT = 500;

const sectionsCondition = (count) =>
  `u.section IN (${Array.from({ length: count }, (_, i) => `@sec${i}`).join(", ")})`;

const isSet = (v) => v !== undefined && v !== null && v !== "";

const cache = new Map();

/**
 * @param {object} [filters] status, kind, userID, year, from, to, sections
 *   `sections` pominięte = bez zawężania (wołający odpowiada za uprawnienia),
 *   `sections: []` = nikt, czyli pusta lista od razu.
 * @param {object} [options] `limit: null` zdejmuje limit — używa tego eksport CSV,
 *   który obiecuje komplet.
 */
export const getAbsences = (filters = {}, { limit = ABSENCE_LIST_LIMIT } = {}) => {
  const { sections, ...rest } = filters;

  if (Array.isArray(sections) && sections.length === 0) return [];

  const keys = Object.keys(CONDITIONS).filter((k) => isSet(rest[k]));
  const sectionCount = Array.isArray(sections) ? sections.length : 0;
  const limited = limit !== null;

  const cacheKey = `${keys.join("|")}#${sectionCount}#${limited ? "lim" : "all"}`;

  let stmt = cache.get(cacheKey);
  if (!stmt) {
    const where = [
      ...keys.map((k) => CONDITIONS[k]),
      ...(sectionCount > 0 ? [sectionsCondition(sectionCount)] : []),
    ];
    stmt = db.prepare(
      `${BASE}${where.length ? `\n WHERE ${where.join(" AND ")}` : ""}${ORDER}${
        limited ? " LIMIT @limit" : ""
      }`
    );
    cache.set(cacheKey, stmt);
  }

  const params = Object.fromEntries(keys.map((k) => [k, rest[k]]));
  if (sectionCount > 0) sections.forEach((s, i) => (params[`sec${i}`] = s));
  if (limited) params.limit = limit;

  return stmt.all(params);
};

export default getAbsences;
