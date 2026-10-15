import db from "./db";

// Ile wniosków czeka na decyzję kierownika — urlopowych, nadgodzinowych
// i zgłoszeń korekty karty.
//
// Osobny serwis, a nie getAbsences({ status: "pending" }).length: tę liczbę
// pasek stacyjny odpytuje CYKLICZNIE z każdej strony, więc ma kosztować jeden
// COUNT po indeksie statusu (idx_absences_status, idx_overtime_status), a nie
// SELECT * z danymi osobowymi, z którego bierze się samą długość tablicy.
//
// Zasięg sekcyjny jest ten sam co w obu panelach wniosków — inaczej licznik
// obiecywałby wnioski, których kierownik po wejściu na stronę nie zobaczy.

const sectionsCondition = (count) =>
  `u.section IN (${Array.from({ length: count }, (_, i) => `@sec${i}`).join(", ")})`;

// Lista sekcji ma zmienną długość, więc zapytania cache'ujemy per liczba sekcji
// (wzorzec z services/getAbsences.js).
const cache = new Map();

const statements = (count) => {
  if (!cache.has(count)) {
    const count_ = (table) =>
      db.prepare(
        `SELECT COUNT(*) AS n
           FROM ${table} t
           JOIN Users u ON u.id = t.userID
          WHERE t.status = 'pending' AND ${sectionsCondition(count)}`
      );
    cache.set(count, {
      absences: count_("Absences"),
      overtime: count_("Overtime"),
      corrections: count_("CardCorrections"),
    });
  }
  return cache.get(count);
};

/**
 * @param {string[]} sections sekcje w zasięgu kierownika; pusta lista = nikt
 * @returns {{absences: number, overtime: number, corrections: number}}
 */
export const getPendingCounts = (sections) => {
  if (!Array.isArray(sections) || sections.length === 0) return { absences: 0, overtime: 0, corrections: 0 };

  const params = Object.fromEntries(sections.map((s, i) => [`sec${i}`, s]));
  const stmt = statements(sections.length);

  return {
    absences: stmt.absences.get(params).n,
    overtime: stmt.overtime.get(params).n,
    corrections: stmt.corrections.get(params).n,
  };
};

export default getPendingCounts;
