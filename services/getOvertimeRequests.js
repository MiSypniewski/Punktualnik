import db from "./db";

// Widok kierownika: wnioski wszystkich pracowników z danymi osobowymi z Users.
//
// Filtry są opcjonalne, więc SQL składamy z gotowych fragmentów i cache'ujemy
// przygotowane zapytania po zestawie użytych filtrów (jest ich najwyżej 16).
// Do zapytania trafiają wyłącznie stałe z tego pliku — wartości zawsze idą
// przez binding @param, nigdy przez interpolację.
const BASE = `
  SELECT o.*, u.name, u.surname, u.section, u.location
  FROM Overtime o
  JOIN Users u ON u.id = o.userID`;

// Oczekujące zawsze na górze — to jest lista zadań do wyklikania.
const ORDER = `
  ORDER BY (o.status = 'pending') DESC, o.data DESC, o.id DESC`;

const CONDITIONS = {
  status: `o.status = @status`,
  userID: `o.userID = @userID`,
  from: `o.data >= @from`,
  to: `o.data <= @to`,
};

// Domyślne przycięcie listy. Wnioski nie kasują się nigdy, więc bez limitu ten
// sam SELECT po roku zwracałby komplet historii sekcji — do propsów SSR, czyli
// prosto do HTML-a wysyłanego przeglądarce. Eksport CSV świadomie podaje
// { limit: null }, bo obiecuje komplet.
export const OVERTIME_LIST_LIMIT = 500;

const cache = new Map();

// Lista sekcji ma zmienną długość, więc nie mieści się w słowniku stałych
// warunków — generujemy @sec0, @sec1... i cache'ujemy osobno per liczba sekcji.
const sectionsCondition = (count) =>
  `u.section IN (${Array.from({ length: count }, (_, i) => `@sec${i}`).join(", ")})`;

const getStatement = (keys, sectionCount, limited) => {
  const cacheKey = `${keys.join("|")}#${sectionCount}#${limited ? "lim" : "all"}`;
  if (!cache.has(cacheKey)) {
    const parts = keys.map((k) => CONDITIONS[k]);
    if (sectionCount > 0) parts.push(sectionsCondition(sectionCount));
    const where = parts.length ? `\n  WHERE ${parts.join(" AND ")}` : "";
    const limit = limited ? `\n  LIMIT @limit` : "";
    cache.set(cacheKey, db.prepare(`${BASE}${where}${ORDER}${limit}`));
  }
  return cache.get(cacheKey);
};

const isSet = (v) => v !== undefined && v !== null && v !== "";

/**
 * @param {{status?: string, userID?: number|string, from?: string, to?: string,
 *          sections?: string[]}} filters
 *   `sections` zawęża wynik do podanych sekcji. Pominięcie pola = bez zawężania
 *   (wołający odpowiada za uprawnienia); pusta tablica = świadomie nic nie widać.
 * @param {{limit?: number|null}} opts limit — ile wierszy najwyżej.
 *   null = komplet (eksport CSV). Domyślnie OVERTIME_LIST_LIMIT.
 */
const getOvertimeRequests = (filters = {}, { limit = OVERTIME_LIST_LIMIT } = {}) => {
  const { sections } = filters;
  if (Array.isArray(sections) && sections.length === 0) return [];

  const params = {};
  if (isSet(filters.status)) params.status = String(filters.status);
  if (isSet(filters.userID)) params.userID = Number(filters.userID);
  if (isSet(filters.from)) params.from = String(filters.from);
  if (isSet(filters.to)) params.to = String(filters.to);

  const keys = Object.keys(CONDITIONS).filter((k) => k in params);

  const list = Array.isArray(sections) ? sections : [];
  list.forEach((s, i) => {
    params[`sec${i}`] = String(s);
  });

  const limited = Number.isFinite(limit) && limit > 0;
  if (limited) params.limit = limit;

  return getStatement(keys, list.length, limited).all(params);
};

export default getOvertimeRequests;
