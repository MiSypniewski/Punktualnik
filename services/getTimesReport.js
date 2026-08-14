import db from "./db";

// `data` jest zapisywane jako ISO (np. 2026-05-18T03:00:00+02:00),
// więc filtrujemy po pierwszych 10 znakach = "YYYY-MM-DD".
// Dzięki temu nie ma problemu z przesunięciem strefy (DST) przy granicy zakresu.
const COLUMNS = `userID, name, surname, section, location, data, startTime, endTime, totalWorkTime, status, overTime`;

// Zawężamy po Times.section, czyli po sekcji z DNIA zapisu, a nie po dzisiejszej
// sekcji pracownika (Times denormalizuje te pola po Airtable). Skutek jest
// zamierzony: gdy ktoś zmieni zespół, jego stare dni zostają u poprzedniego
// kierownika, a nowy widzi go dopiero od przeprowadzki.
const build = (extra) => `
  SELECT ${COLUMNS} FROM Times
  WHERE substr(data,1,10) BETWEEN @from AND @to${extra}
  ORDER BY data, surname, name`;

const cache = new Map();

const getStatement = (withUser, sectionCount) => {
  const key = `${withUser ? "u" : "-"}#${sectionCount}`;
  if (!cache.has(key)) {
    let extra = withUser ? ` AND userID = @userID` : "";
    if (sectionCount > 0) {
      const placeholders = Array.from({ length: sectionCount }, (_, i) => `@sec${i}`).join(", ");
      extra += ` AND section IN (${placeholders})`;
    }
    cache.set(key, db.prepare(build(extra)));
  }
  return cache.get(key);
};

/**
 * from / to: "YYYY-MM-DD" (włącznie). userID: null/undefined/"" = wszyscy.
 * sections: pominięte = bez zawężania, pusta tablica = nic.
 */
const getTimesReport = ({ from, to, userID, sections }) => {
  if (Array.isArray(sections) && sections.length === 0) return [];

  const withUser = !(userID === undefined || userID === null || userID === "");
  const params = { from, to };
  if (withUser) params.userID = Number(userID);

  const list = Array.isArray(sections) ? sections : [];
  list.forEach((s, i) => {
    params[`sec${i}`] = String(s);
  });

  const rows = getStatement(withUser, list.length).all(params);
  return rows.map((r) => ({ ...r, overTime: Boolean(r.overTime) }));
};

export default getTimesReport;
