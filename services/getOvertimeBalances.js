import db from "./db";
import { signedMinutesSql } from "./overtimeBalanceSql";

// Zestawienie sald wszystkich aktywnych pracowników.
//
// LEFT JOIN, a nie JOIN — inaczej z listy zniknęliby ci, którzy nigdy nie
// złożyli wniosku, a kierownik ma widzieć cały zespół (saldo 0 to też
// informacja). Filtr statusu musi siedzieć w CASE wewnątrz SUM, a nie w WHERE:
// w WHERE zamieniłby LEFT JOIN z powrotem w zwykły JOIN i wyciął zerowe salda.
// Do salda liczą się tylko wnioski zatwierdzone; oczekujące tylko zliczamy.
const query = (sectionsWhere) => `
  SELECT
    u.id, u.name, u.surname, u.section, u.location,
    COALESCE(SUM(CASE WHEN o.status = 'approved' THEN ${signedMinutesSql("o")} ELSE 0 END), 0) AS balance,
    COALESCE(SUM(CASE WHEN o.status = 'pending' THEN 1 ELSE 0 END), 0) AS pendingCount
  FROM Users u
  LEFT JOIN Overtime o ON o.userID = u.id
  WHERE u.isActive = 1${sectionsWhere}
  GROUP BY u.id
  ORDER BY u.surname, u.name`;

const stmtAll = db.prepare(query(""));

// Osobne zapytanie per liczba sekcji — treść jest budowana wyłącznie z liczby
// pozycji, same nazwy sekcji zawsze idą przez binding.
const cache = new Map();
const stmtForSections = (count) => {
  if (!cache.has(count)) {
    const placeholders = Array.from({ length: count }, (_, i) => `@sec${i}`).join(", ");
    cache.set(count, db.prepare(query(` AND u.section IN (${placeholders})`)));
  }
  return cache.get(count);
};

/**
 * @param {string[]} [sections] zawężenie do sekcji; pominięcie = wszyscy,
 *   pusta tablica = nikt (kierownik bez przypisań).
 */
const getOvertimeBalances = (sections) => {
  if (!Array.isArray(sections)) return stmtAll.all();
  if (sections.length === 0) return [];

  const params = {};
  sections.forEach((s, i) => {
    params[`sec${i}`] = String(s);
  });
  return stmtForSections(sections.length).all(params);
};

export default getOvertimeBalances;
