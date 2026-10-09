import db from "./db";
import { now as appNow, appTime, workDayStart } from "./workday";
import { CATEGORY_SQL } from "./entryStats";
import { kindSign } from "./overtimeKinds";
import { getReviewsForMonth } from "./monthlyReview";
import { parseHmsToSeconds } from "../utils";
import { buildPersonReport, monthBounds, rankByAverage, teamStats } from "../utils/monthlyReport";
import { computeScore } from "../utils/monthlyScore";

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
  `SELECT id, name, surname, section, isActive, role
     FROM Users
    WHERE role <> 'editor'
    ORDER BY surname COLLATE NOCASE, name COLLATE NOCASE`
);

// Ten sam warunek "karta odbita" co hasPunch w services/dayBoard.js.
// substr(data,1,10) trafia w idx_times_datepart.
const stmtCards = db.prepare(
  `SELECT userID, substr(data,1,10) AS day, startTime, endTime, totalWorkTime, autoClosed
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
    ORDER BY dateFrom, id`
);

const stmtEntries = db.prepare(
  `SELECT userID, data, projectID, SUM(seconds) AS seconds
     FROM TaskEntries
    WHERE data BETWEEN @from AND @to AND endedAt IS NOT NULL
    GROUP BY userID, data, projectID`
);

// Zadanie to wolny opis, więc "to samo zadanie" znaczy tu: ten sam opis w tym
// samym projekcie. Wielkość liter i spacje na końcach nie tworzą osobnej pozycji.
const stmtTasks = db.prepare(
  `SELECT userID, projectID, MIN(TRIM(description)) AS description,
          SUM(seconds) AS seconds, COUNT(*) AS entries
     FROM TaskEntries
    WHERE data BETWEEN @from AND @to AND endedAt IS NOT NULL
    GROUP BY userID, projectID, LOWER(TRIM(description))`
);

// Alias `e` jest wymagany przez CATEGORY_SQL (services/entryStats.js) — kategorie
// "ręczny / czas edytowany / auto" mają znaczyć to samo co w raporcie zadań.
const stmtQuality = db.prepare(
  `SELECT e.userID,
          COUNT(*) AS entries,
          COALESCE(SUM(${CATEGORY_SQL} = 'manual'), 0) AS manual,
          COALESCE(SUM(${CATEGORY_SQL} = 'edited'), 0) AS edited,
          COALESCE(SUM(${CATEGORY_SQL} = 'auto'), 0)   AS auto
     FROM TaskEntries e
    WHERE e.data BETWEEN @from AND @to AND e.endedAt IS NOT NULL
    GROUP BY e.userID`
);

const stmtOvertime = db.prepare(
  `SELECT userID, data, kind, minutes, reason
     FROM Overtime
    WHERE status = 'approved' AND data BETWEEN @from AND @to
    ORDER BY data, id`
);

const stmtProjects = db.prepare(`SELECT id, name, color FROM Projects`);

// Od kiedy w ogóle istnieją wpisy zadań. Miesiąc, w którym moduł wystartował
// (sierpień 2026: od 17.), ma karty z całego miesiąca i zadania z połowy —
// bez tej daty średnia dzienna wszystkich wyszłaby o połowę za niska.
const stmtEntriesFrom = db.prepare(`SELECT MIN(data) AS day FROM TaskEntries`);

const groupBy = (rows, pick = (r) => r) =>
  rows.reduce((acc, row) => {
    if (!acc.has(row.userID)) acc.set(row.userID, []);
    acc.get(row.userID).push(pick(row));
    return acc;
  }, new Map());

// Znacznik karty (ISO z offsetem) → minuty od północy w strefie aplikacji.
// appTime, nie wycinanie znaków: offset w znaczniku bywa +00:00 i +02:00
// zależnie od tego, kto go zapisał (services/workday.js).
const minuteOfDay = (stamp) => {
  if (!stamp) return null;
  const [h, m] = appTime(stamp, "HH:mm").split(":").map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
};

const toCard = (row) => ({
  day: row.day,
  seconds: parseHmsToSeconds(row.totalWorkTime),
  startMin: minuteOfDay(row.startTime),
  endMin: minuteOfDay(row.endTime),
  autoClosed: Boolean(row.autoClosed),
});

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

  const cards = groupBy(stmtCards.all(range), toCard);
  const absences = groupBy(stmtAbsences.all(range));
  const entries = groupBy(stmtEntries.all(range));
  const tasks = groupBy(stmtTasks.all(range));
  const quality = new Map(stmtQuality.all(range).map(({ userID, ...q }) => [userID, q]));
  const overtime = groupBy(stmtOvertime.all(range), (o) => ({ ...o, sign: kindSign(o.kind) }));
  const projects = new Map(stmtProjects.all().map((p) => [p.id, p]));
  const entriesFrom = stmtEntriesFrom.get().day || null;

  const people = stmtPeople
    .all()
    .filter((u) => !sections || sections.includes(u.section))
    .filter((u) => u.isActive || cards.has(u.id) || entries.has(u.id));

  const rows = people.map((u) => ({
    userID: u.id,
    name: u.name,
    surname: u.surname,
    section: u.section,
    manager: u.role === "manager",
    payload: buildPersonReport({
      month,
      cards: cards.get(u.id),
      absences: absences.get(u.id),
      entries: entries.get(u.id),
      tasks: tasks.get(u.id),
      quality: quality.get(u.id),
      overtime: overtime.get(u.id),
      projects,
      entriesFrom,
    }),
  }));

  // Wskaźniki zespołu jadą W wierszu każdej osoby: migawka ma być kompletna
  // sama w sobie, także wtedy, gdy kierownik widzi tylko część sekcji firmy.
  //
  // Kierownik nie wchodzi do wskaźników zespołu ani do klasyfikacji: jego dzień
  // to w dużej części praca, której się nie raportuje, więc zaniżałby średnią
  // ludziom, których ocenia. Sam nadal ogląda siebie na tle zespołu.
  const teams = new Map();
  for (const row of rows) {
    if (!teams.has(row.section)) teams.set(row.section, []);
    teams.get(row.section).push(row);
  }
  for (const members of teams.values()) {
    const staff = members.filter((row) => !row.manager).map((row) => row.payload);
    const stats = teamStats(staff);
    const ranks = rankByAverage(staff);
    for (const { manager, payload } of members) {
      payload.outsideTeam = manager;
      payload.team = { ...stats, rank: manager ? null : ranks[staff.indexOf(payload)] };
    }
  }

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

const COLUMNS = `r.month, r.userID, r.name, r.surname, r.section, r.payload, r.generatedAt, r.generatedByName`;

const parse = ({ payload, ...row }) => ({ ...row, ...JSON.parse(payload) });

// Wersja kształtu migawki (pole `v` z utils/monthlyReport.js). Wiersz w starszym
// kształcie traktujemy jak brak raportu: ekran pokaże „wygeneruj”, zamiast
// wywrócić się na polu, którego w starym JSON-ie nie ma.
const PAYLOAD_VERSION = 2;
const current = (row) => row.v === PAYLOAD_VERSION;

const readCache = new Map();
const stmtRead = (count) => {
  if (!readCache.has(count)) {
    const ph = Array.from({ length: count }, (_, i) => `@sec${i}`).join(", ");
    readCache.set(
      count,
      db.prepare(
        `SELECT ${COLUMNS}
           FROM MonthlyReports r
          WHERE r.month = @month AND r.section IN (${ph})
          ORDER BY r.section, r.surname COLLATE NOCASE, r.name COLLATE NOCASE`
      )
    );
  }
  return readCache.get(count);
};

// Lista zbiorcza nie potrzebuje tablicy dni, zadań ani rejestrów — to pola
// raportu jednej osoby i przy dwudziestu osobach stanowią większość odpowiedzi.
const HEAVY = ["days", "tasks", "absences", "longDays"];
const light = (row) => {
  // Bez `undefined` w wyniku: getServerSideProps nie umie go zserializować.
  const { items, ...overtime } = row.overtime;
  const out = { ...row, overtime };
  for (const key of HEAVY) delete out[key];
  return out;
};

/**
 * Migawka miesiąca w zasięgu kierownika — wersja do listy zbiorczej.
 * @param {string} month 'YYYY-MM'
 * @param {string[]} sections sekcje z services/scope.js
 */
export const getMonth = (month, sections) => {
  if (!Array.isArray(sections) || sections.length === 0) return [];

  const params = { month };
  sections.forEach((s, i) => {
    params[`sec${i}`] = String(s);
  });

  return stmtRead(sections.length).all(params).map(parse).filter(current).map(light);
};

/**
 * Lista zbiorcza: migawka + ocena, jeśli kierownik ją już wpisał. Jedno
 * miejsce dla strony (pierwsze malowanie) i dla API (odświeżenie po przeliczeniu).
 */
export const listMonth = (month, sections) => {
  const reviews = getReviewsForMonth(month);
  return getMonth(month, sections).map((person) => ({
    ...person,
    score: computeScore(person, reviews.get(person.userID))?.score ?? null,
  }));
};

const stmtHistory = db.prepare(
  `SELECT ${COLUMNS}
     FROM MonthlyReports r
    WHERE r.userID = @userID AND r.month <= @month
    ORDER BY r.month DESC
    LIMIT @limit`
);

/** Ile miesięcy wstecz pokazują wykresy trendu, razem z bieżącym. */
export const TREND_MONTHS = 6;

/**
 * Raport jednej osoby: wskazany miesiąc i poprzedzające go migawki (do trendu),
 * od najstarszej. Pusta tablica, gdy za wskazany miesiąc migawki nie ma.
 */
export const getPersonHistory = (userID, month, limit = TREND_MONTHS) => {
  const rows = stmtHistory.all({ userID: Number(userID), month, limit }).map(parse).filter(current);
  if (rows.length === 0 || rows[0].month !== month) return [];
  return rows.reverse();
};
