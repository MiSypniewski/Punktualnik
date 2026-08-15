import db from "./db";
import { parseHmsToMinutes } from "../utils";

// Agregaty do dashboardu kierownika.
//
// Wszystko tu przyjmuje `sections` z services/scope.js i honoruje tę samą
// zasadę co reszta modułów: pusta tablica = zero wyników, nigdy "wszystko".
// Kierownik bez przypisań ma widzieć pusty panel, a nie całą firmę.

// Ile wierszy szczegółowych trafia na ekran. Limit jest niski celowo: każdy
// wiersz jedzie do przeglądarki jako props SSR, a przy 500 wierszach payload
// strony rósł do 175 kB i Next wypisywał ostrzeżenie o przekroczeniu progu
// 128 kB ("large-page-data"). Na Mikrusie i na telefonie to realny koszt,
// a setek wierszy i tak nikt nie przegląda w tabeli — od tego jest CSV,
// który limitu nie ma.
const DETAIL_LIMIT = 200;

// Filtry są opcjonalne i jest ich pięć, więc SQL składamy dynamicznie
// i cache'ujemy gotowe statementy — ten sam zabieg co w getTimesReport.js.
const cache = new Map();

const buildWhere = ({ sectionCount, withProject, withUser, withMin }) => {
  let where = ` WHERE e.data BETWEEN @from AND @to`;
  if (sectionCount > 0) {
    const ph = Array.from({ length: sectionCount }, (_, i) => `@sec${i}`).join(", ");
    where += ` AND e.section IN (${ph})`;
  }
  if (withProject) where += ` AND e.projectID = @projectID`;
  if (withUser) where += ` AND e.userID = @userID`;
  if (withMin) where += ` AND e.minutes >= @minMinutes`;
  // Wpis wciąż biegnący nie ma jeszcze wymiaru — do raportów nie wchodzi.
  where += ` AND e.endedAt IS NOT NULL`;
  return where;
};

const prepared = (kind, shape, sql) => {
  const key = `${kind}#${shape.sectionCount}#${shape.withProject}#${shape.withUser}#${shape.withMin}`;
  if (!cache.has(key)) cache.set(key, db.prepare(sql(buildWhere(shape))));
  return cache.get(key);
};

// Widok w przeglądarce jest przycięty, żeby nie renderować tysięcy wierszy na
// telefonie — ale eksport CSV musi dać komplet, bo dokładnie to obiecuje
// komunikat nad tabelą ("pobierz CSV — eksport obejmuje komplet").
const LIMIT_CLAUSE = { view: ` LIMIT ${DETAIL_LIMIT}`, all: "" };

const shapeOf = ({ sections, projectID, userID, minMinutes }) => ({
  sectionCount: Array.isArray(sections) ? sections.length : 0,
  withProject: Boolean(projectID),
  withUser: Boolean(userID),
  withMin: Number(minMinutes) > 0,
});

const paramsOf = ({ from, to, sections, projectID, userID, minMinutes }) => {
  const params = { from, to };
  (Array.isArray(sections) ? sections : []).forEach((s, i) => {
    params[`sec${i}`] = String(s);
  });
  if (projectID) params.projectID = Number(projectID);
  if (userID) params.userID = Number(userID);
  if (Number(minMinutes) > 0) params.minMinutes = Number(minMinutes);
  return params;
};

/** Wspólna bramka: brak dostępnych sekcji = pusty wynik, bez odpytywania bazy. */
const noScope = (filters) => Array.isArray(filters.sections) && filters.sections.length === 0;

export const getSummary = (filters) => {
  if (noScope(filters)) return { minutes: 0, entries: 0, people: 0, autoClosed: 0 };

  return prepared(
    "sum",
    shapeOf(filters),
    (where) => `
      SELECT COALESCE(SUM(e.minutes), 0) AS minutes,
             COUNT(*)                    AS entries,
             COUNT(DISTINCT e.userID)    AS people,
             COALESCE(SUM(e.autoClosed), 0) AS autoClosed
        FROM TaskEntries e${where}`
  ).get(paramsOf(filters));
};

export const getByProject = (filters) => {
  if (noScope(filters)) return [];

  return prepared(
    "proj",
    shapeOf(filters),
    (where) => `
      SELECT p.id, p.name, p.client, p.color,
             SUM(e.minutes)           AS minutes,
             COUNT(*)                 AS entries,
             COUNT(DISTINCT e.userID) AS people
        FROM TaskEntries e
        JOIN Projects p ON p.id = e.projectID${where}
       GROUP BY p.id
       ORDER BY minutes DESC`
  ).all(paramsOf(filters));
};

const stmtAttendanceCache = new Map();

/**
 * Obecność z modułu kart czasu (Times) w tym samym oknie.
 *
 * Times.totalWorkTime jest TEKSTEM "HH:mm:ss" (spadek po Airtable), więc sumy
 * nie da się policzyć w SQL bez parsowania — wiersze zliczamy w JS przez
 * parseHmsToMinutes. Przy skali tej firmy to kilkaset wierszy na miesiąc.
 *
 * Times.data trzyma pełne ISO, stąd substr(...,1,10) — dokładnie tak samo
 * filtruje services/getTimesReport.js.
 */
const getAttendanceMinutes = ({ from, to, sections, userID }) => {
  const sectionCount = Array.isArray(sections) ? sections.length : 0;
  const withUser = Boolean(userID);
  const key = `att#${sectionCount}#${withUser}`;

  if (!stmtAttendanceCache.has(key)) {
    let where = ` WHERE substr(t.data,1,10) BETWEEN @from AND @to`;
    if (sectionCount > 0) {
      const ph = Array.from({ length: sectionCount }, (_, i) => `@sec${i}`).join(", ");
      where += ` AND t.section IN (${ph})`;
    }
    if (withUser) where += ` AND t.userID = @userID`;
    stmtAttendanceCache.set(
      key,
      db.prepare(`SELECT t.userID, t.totalWorkTime FROM Times t${where}`)
    );
  }

  const params = { from, to };
  (Array.isArray(sections) ? sections : []).forEach((s, i) => {
    params[`sec${i}`] = String(s);
  });
  if (withUser) params.userID = Number(userID);

  return stmtAttendanceCache.get(key).all(params).reduce((acc, row) => {
    acc[row.userID] = (acc[row.userID] || 0) + parseHmsToMinutes(row.totalWorkTime);
    return acc;
  }, {});
};

/**
 * Zestawienie "był w pracy" vs "co zaraportował", per pracownik.
 *
 * Obie wielkości są niezależne i celowo nic się na ich podstawie nie blokuje —
 * zapomniana karta nie może unieważnić zaraportowanej pracy, a zapomniane
 * raportowanie nie może podważyć obecności. Kolumna służy kierownikowi do
 * wychwycenia dni, którymi warto się zainteresować.
 */
export const getByUser = (filters) => {
  if (noScope(filters)) return [];

  const rows = prepared(
    "user",
    shapeOf(filters),
    (where) => `
      SELECT u.id, u.name, u.surname, u.section,
             SUM(e.minutes) AS reported,
             COUNT(*)       AS entries
        FROM TaskEntries e
        JOIN Users u ON u.id = e.userID${where}
       GROUP BY u.id
       ORDER BY u.surname COLLATE NOCASE, u.name COLLATE NOCASE`
  ).all(paramsOf(filters));

  const attendance = getAttendanceMinutes(filters);

  return rows.map((r) => {
    const present = attendance[r.id] || 0;
    return {
      ...r,
      present,
      diff: r.reported - present,
      // Pokrycie liczymy tylko wtedy, gdy jest do czego — bez odbitej karty
      // procent byłby dzieleniem przez zero i sugerowałby wynik, którego nie ma.
      coverage: present > 0 ? Math.round((r.reported / present) * 100) : null,
    };
  });
};

/**
 * @param {"view"|"all"} scope "view" tnie do DETAIL_LIMIT (ekran),
 *                             "all" zwraca komplet (eksport CSV).
 */
export const getEntries = (filters, scope = "view") => {
  if (noScope(filters)) return { rows: [], total: 0, limit: DETAIL_LIMIT };

  const total = getSummary(filters).entries;

  const rows = prepared(
    `list-${scope}`,
    shapeOf(filters),
    (where) => `
      SELECT e.id, e.data, e.startedAt, e.endedAt, e.minutes, e.description,
             e.autoClosed, e.editedByName, e.section, e.userID, e.projectID,
             u.name, u.surname,
             p.name AS projectName, p.client AS projectClient, p.color AS projectColor
        FROM TaskEntries e
        JOIN Users u    ON u.id = e.userID
        JOIN Projects p ON p.id = e.projectID${where}
       ORDER BY e.data DESC, e.startedAt DESC${LIMIT_CLAUSE[scope] ?? LIMIT_CLAUSE.view}`
  ).all(paramsOf(filters));

  return {
    rows: rows.map((r) => ({ ...r, autoClosed: Boolean(r.autoClosed) })),
    total,
    limit: DETAIL_LIMIT,
  };
};
