import db from "./db";
import { TIME_LIST_LIMIT } from "../utils";

// Lista kart czasu dla panelu korekty (/time/zarzadzaj).
//
// Osobny serwis, a NIE dodatkowy parametr w services/getTimesReport.js — mimo
// że zawężenie jest tam identyczne. Tamten karmi eksport CSV, a jego lista
// kolumn jest jednocześnie nagłówkiem pliku, który ludzie mają już w Excelu
// i w swoich formułach. Dołożenie do niego `id` czy `autoClosed` po cichu
// przestawiłoby kolumny w każdym arkuszu opartym o ten eksport.
//
// Zawężamy po Times.section, czyli po sekcji Z DNIA ZAPISU — ta sama reguła,
// co w eksporcie (services/getTimesReport.js): po zmianie zespołu stare dni
// zostają u poprzedniego kierownika.

const COLUMNS = `
  id, userID, name, surname, section, location, data, startTime, endTime,
  totalWorkTime, status, overTime, autoClosed, editedAt, editedByName`;

const build = (extra) => `
  SELECT ${COLUMNS} FROM Times
   WHERE substr(data, 1, 10) BETWEEN @from AND @to${extra}
   ORDER BY data DESC, surname, name
   LIMIT ${TIME_LIST_LIMIT}`;

// Osobne zapytanie na każdy kształt filtra; nazwy sekcji zawsze przez binding.
// Kopia mechanizmu z getTimesReport.js — SQLite nie ma parametru "lista".
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
 * @param {{from: string, to: string, userID?: number|string, sections: string[]}} filters
 *   sections: pusta tablica = nikt (kierownik bez przypisań nie widzi nikogo —
 *   bezpieczna wartość domyślna z services/scope.js).
 */
const getSectionTimes = ({ from, to, userID, sections }) => {
  const list = Array.isArray(sections) ? sections : [];
  if (list.length === 0) return [];

  const withUser = !(userID === undefined || userID === null || userID === "");
  const params = { from, to };
  if (withUser) params.userID = Number(userID);
  list.forEach((s, i) => {
    params[`sec${i}`] = String(s);
  });

  return getStatement(withUser, list.length)
    .all(params)
    .map((r) => ({ ...r, overTime: Boolean(r.overTime), autoClosed: Boolean(r.autoClosed) }));
};

export default getSectionTimes;
