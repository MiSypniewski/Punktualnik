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

const cache = new Map();

const getStatement = (keys) => {
  const cacheKey = keys.join("|");
  if (!cache.has(cacheKey)) {
    const where = keys.length ? `\n  WHERE ${keys.map((k) => CONDITIONS[k]).join(" AND ")}` : "";
    cache.set(cacheKey, db.prepare(`${BASE}${where}${ORDER}`));
  }
  return cache.get(cacheKey);
};

const isSet = (v) => v !== undefined && v !== null && v !== "";

/**
 * @param {{status?: string, userID?: number|string, from?: string, to?: string}} filters
 */
const getOvertimeRequests = (filters = {}) => {
  const params = {};
  if (isSet(filters.status)) params.status = String(filters.status);
  if (isSet(filters.userID)) params.userID = Number(filters.userID);
  if (isSet(filters.from)) params.from = String(filters.from);
  if (isSet(filters.to)) params.to = String(filters.to);

  const keys = Object.keys(CONDITIONS).filter((k) => k in params);
  return getStatement(keys).all(params);
};

export default getOvertimeRequests;
