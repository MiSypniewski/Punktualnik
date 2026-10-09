import db from "./db";
import { now as appNow, workDayStart } from "./workday";
import { buildPersonReport, monthBounds, teamAverage, workingDaysOf } from "../utils/monthlyReport";

// Miesięczne podsumowania pracowników: policzenie, zapis migawki i odczyt.
//
// Raport jest MIGAWKĄ w tabeli MonthlyReports, a nie widokiem liczonym przy
// każdym wejściu: ten sam miesiąc ma pokazywać jutro te same liczby co dziś.
// Dane wsteczne są jednak u nas zmienne (kierownik poprawia karty bez limitu
// daty, L4 wpisuje się po fakcie), dlatego migawkę da się przeliczyć — i widać
// na niej, kiedy i przez kogo powstała.
//
// Wszystkie zapytania biorą CAŁY miesiąc naraz, a podział na osoby robi JS.
// Zapytanie per osoba byłoby kilkudziesięcioma synchronicznymi odczytami pod
// rząd — dokładnie ten kształt pracy, który 21.08.2026 zatrzymał pętlę zdarzeń.

const stmtPeople = db.prepare(
  `SELECT id, name, surname, section, isActive
     FROM Users
    WHERE role <> 'editor'
    ORDER BY surname COLLATE NOCASE, name COLLATE NOCASE`
);

// Ten sam warunek "karta odbita" co hasPunch w services/dayBoard.js.
// substr(data,1,10) trafia w idx_times_datepart.
const stmtCards = db.prepare(
  `SELECT userID, substr(data,1,10) AS day
     FROM Times
    WHERE substr(data,1,10) BETWEEN @from AND @to
      AND startTime IS NOT NULL AND startTime <> ''
      AND COALESCE(status, '') <> 'wait'`
);

// Tylko zatwierdzone: wniosek oczekujący nie jest jeszcze nieobecnością,
// a miesiąc, o którym mowa, już się skończył.
const stmtAbsences = db.prepare(
  `SELECT userID, kind, dateFrom, dateTo
     FROM Absences
    WHERE status = 'approved' AND dateFrom <= @to AND dateTo >= @from
    ORDER BY id`
);

const stmtEntries = db.prepare(
  `SELECT userID, data, projectID, SUM(seconds) AS seconds
     FROM TaskEntries
    WHERE data BETWEEN @from AND @to AND endedAt IS NOT NULL
    GROUP BY userID, data, projectID`
);

const stmtProjects = db.prepare(`SELECT id, name, color FROM Projects`);

const groupBy = (rows, pick = (r) => r) =>
  rows.reduce((acc, row) => {
    if (!acc.has(row.userID)) acc.set(row.userID, []);
    acc.get(row.userID).push(pick(row));
    return acc;
  }, new Map());

/**
 * Policzenie miesiąca, bez zapisu.
 *
 * Sekcja pochodzi z Users.section W CHWILI LICZENIA, nie z dnia wpisu: raport
 * mówi o człowieku, a człowiek należy do jednego zespołu naraz. Do raportu
 * wchodzi każdy czynny pracownik oraz każdy były, który zostawił w tym
 * miesiącu kartę albo wpis — odejście w połowie miesiąca nie kasuje jego pracy.
 *
 * @param {string} month 'YYYY-MM'
 * @param {string[]} [sections] pominięte = cała firma, pusta tablica = nic
 * @returns {{userID: number, name: string, surname: string, section: string, payload: object}[]}
 */
export const buildMonth = (month, sections) => {
  if (Array.isArray(sections) && sections.length === 0) return [];

  const range = monthBounds(month);
  const workingDays = workingDaysOf(month);

  const cards = groupBy(stmtCards.all(range), (r) => r.day);
  const absences = groupBy(stmtAbsences.all(range));
  const entries = groupBy(stmtEntries.all(range));
  const projects = new Map(stmtProjects.all().map((p) => [p.id, p]));

  const people = stmtPeople
    .all()
    .filter((u) => !sections || sections.includes(u.section))
    .filter((u) => u.isActive || cards.has(u.id) || entries.has(u.id));

  const rows = people.map((u) => ({
    userID: u.id,
    name: u.name,
    surname: u.surname,
    section: u.section,
    payload: buildPersonReport({
      workingDays,
      cardDays: new Set(cards.get(u.id) || []),
      absences: absences.get(u.id) || [],
      entries: entries.get(u.id) || [],
      projects,
    }),
  }));

  // Średnia zespołu jedzie W wierszu każdej osoby: migawka ma być kompletna
  // sama w sobie, także wtedy, gdy kierownik widzi tylko część sekcji firmy.
  const teams = new Map();
  for (const row of rows) {
    if (!teams.has(row.section)) teams.set(row.section, []);
    teams.get(row.section).push(row.payload);
  }
  for (const row of rows) row.payload.team = teamAverage(teams.get(row.section));

  return rows;
};

const stmtDeleteMonth = db.prepare(`DELETE FROM MonthlyReports WHERE month = ?`);
const stmtDeleteSection = db.prepare(`DELETE FROM MonthlyReports WHERE month = ? AND section = ?`);
// OR REPLACE, bo osoba mogła zmienić sekcję od poprzedniej migawki: jej stary
// wiersz wisi pod inną sekcją i samo DELETE po sekcji by go nie ruszyło.
const stmtInsert = db.prepare(
  `INSERT OR REPLACE INTO MonthlyReports
     (month, userID, name, surname, section, payload, generatedAt, generatedBy, generatedByName)
   VALUES (@month, @userID, @name, @surname, @section, @payload, @generatedAt, @generatedBy, @generatedByName)`
);

const save = db.transaction((month, sections, rows, by) => {
  if (sections) for (const section of sections) stmtDeleteSection.run(month, section);
  else stmtDeleteMonth.run(month);

  const generatedAt = appNow().format("YYYY-MM-DD HH:mm:ss");
  for (const row of rows) {
    stmtInsert.run({
      month,
      userID: row.userID,
      name: row.name,
      surname: row.surname,
      section: row.section,
      payload: JSON.stringify(row.payload),
      generatedAt,
      generatedBy: by?.id ?? null,
      generatedByName: by?.name ?? null,
    });
  }
  return rows.length;
});

/**
 * Policzenie i zapis. Zawsze całymi sekcjami — przeliczenie jednej osoby
 * zmienia średnią jej zespołu, więc pozostałe wiersze sekcji zestarzałyby się
 * w tej samej chwili.
 *
 * @param {string} month 'YYYY-MM'
 * @param {object} [options]
 * @param {string[]} [options.sections] pominięte = cała firma (automat)
 * @param {{id: number, name: string}} [options.by] kto przeliczył; brak = automat
 * @returns {number} liczba zapisanych wierszy
 */
export const generateMonth = (month, { sections, by } = {}) =>
  save(month, sections, buildMonth(month, sections), by);

/** Ostatni ZAMKNIĘTY miesiąc — liczony dobą roboczą, jak wszystko inne. */
export const lastClosedMonth = (moment = appNow()) =>
  workDayStart(moment).subtract(1, "month").format("YYYY-MM");

/** Czy miesiąc już się skończył. Bieżącego nie zapisujemy: migawka niepełnego
 *  miesiąca wyglądałaby jak gotowy raport z połową dni „bez ewidencji”. */
export const isClosedMonth = (month, moment = appNow()) => month <= lastClosedMonth(moment);

const readCache = new Map();
const stmtRead = (count) => {
  if (!readCache.has(count)) {
    const ph = Array.from({ length: count }, (_, i) => `@sec${i}`).join(", ");
    readCache.set(
      count,
      db.prepare(
        `SELECT userID, name, surname, section, payload, generatedAt, generatedByName
           FROM MonthlyReports
          WHERE month = @month AND section IN (${ph})
          ORDER BY section, surname COLLATE NOCASE, name COLLATE NOCASE`
      )
    );
  }
  return readCache.get(count);
};

/**
 * Migawka miesiąca w zasięgu kierownika.
 * @param {string} month 'YYYY-MM'
 * @param {string[]} sections sekcje z services/scope.js
 */
export const getMonth = (month, sections) => {
  if (!Array.isArray(sections) || sections.length === 0) return [];

  const params = { month };
  sections.forEach((s, i) => {
    params[`sec${i}`] = String(s);
  });

  return stmtRead(sections.length)
    .all(params)
    .map(({ payload, ...row }) => ({ ...row, ...JSON.parse(payload) }));
};
