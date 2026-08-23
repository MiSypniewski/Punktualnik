import db from "./db";
import { parseHmsToSeconds } from "../utils";

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

// Szukanie po nazwie zadania.
//
// Ani LIKE, ani lower() w SQLite nie znają liter spoza ASCII — "Śruba" nie
// odpowiedziałoby na "śruba", a opisy są po polsku, więc filtr byłby zdradliwy:
// czasem trafia, czasem nie. Porównanie robi więc JS.
//
// Ogonki ZDEJMUJEMY po obu stronach: kierownik szukający na szybko wpisze
// "sruby", a w bazie stoi "Śruby montażowe" — filtr, który tego nie znajduje,
// jest gorszy niż żaden, bo sugeruje, że wpisu nie ma. NFD rozkłada literę na
// znak bazowy i znak diakrytyczny, ale "ł" jest osobnym znakiem i nie rozkłada
// się wcale, stąd osobne podstawienie.
const fold = (text) =>
  String(text ?? "")
    .toLocaleLowerCase("pl")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ł/g, "l");

// Igła przychodzi już złożona (patrz paramsOf) — składanie jej przy każdym
// wierszu byłoby czystą stratą. Indeksu to nie użyje, ale na description i tak
// go nie ma, a zapytanie jest wcześniej zawężone zakresem dat i sekcją.
db.function("plContains", { deterministic: true }, (haystack, needle) =>
  fold(haystack).includes(needle) ? 1 : 0
);

// Filtry są opcjonalne i jest ich sześć, więc SQL składamy dynamicznie
// i cache'ujemy gotowe statementy — ten sam zabieg co w getTimesReport.js.
const cache = new Map();

const buildWhere = ({ sectionCount, withProject, withUser, withMin, withQuery }) => {
  let where = ` WHERE e.data BETWEEN @from AND @to`;
  if (sectionCount > 0) {
    const ph = Array.from({ length: sectionCount }, (_, i) => `@sec${i}`).join(", ");
    where += ` AND e.section IN (${ph})`;
  }
  if (withProject) where += ` AND e.projectID = @projectID`;
  if (withUser) where += ` AND e.userID = @userID`;
  // Próg przychodzi z formularza W MINUTACH ("wpisy dłuższe niż 15 min"), bo tak
  // się o tym myśli; do SQL leci już przeliczony na sekundy (patrz paramsOf).
  if (withMin) where += ` AND e.seconds >= @minSeconds`;
  if (withQuery) where += ` AND plContains(e.description, @q) = 1`;
  // Wpis wciąż biegnący nie ma jeszcze wymiaru — do raportów nie wchodzi.
  where += ` AND e.endedAt IS NOT NULL`;
  return where;
};

const prepared = (kind, shape, sql) => {
  const key = `${kind}#${shape.sectionCount}#${shape.withProject}#${shape.withUser}#${shape.withMin}#${shape.withQuery}`;
  if (!cache.has(key)) cache.set(key, db.prepare(sql(buildWhere(shape))));
  return cache.get(key);
};

// Widok w przeglądarce jest przycięty, żeby nie renderować tysięcy wierszy na
// telefonie — ale eksport CSV musi dać komplet, bo dokładnie to obiecuje
// komunikat nad tabelą ("pobierz CSV — eksport obejmuje komplet").
const LIMIT_CLAUSE = { view: ` LIMIT ${DETAIL_LIMIT}`, all: "" };

const needleOf = ({ q }) => fold(String(q ?? "").trim());

const shapeOf = (filters) => ({
  sectionCount: Array.isArray(filters.sections) ? filters.sections.length : 0,
  withProject: Boolean(filters.projectID),
  withUser: Boolean(filters.userID),
  withMin: Number(filters.minMinutes) > 0,
  withQuery: needleOf(filters).length > 0,
});

const paramsOf = (filters) => {
  const { from, to, sections, projectID, userID, minMinutes } = filters;
  const params = { from, to };
  (Array.isArray(sections) ? sections : []).forEach((s, i) => {
    params[`sec${i}`] = String(s);
  });
  if (projectID) params.projectID = Number(projectID);
  if (userID) params.userID = Number(userID);
  if (Number(minMinutes) > 0) params.minSeconds = Number(minMinutes) * 60;

  const needle = needleOf(filters);
  if (needle) params.q = needle;
  return params;
};

/** Wspólna bramka: brak dostępnych sekcji = pusty wynik, bez odpytywania bazy. */
const noScope = (filters) => Array.isArray(filters.sections) && filters.sections.length === 0;

export const getSummary = (filters) => {
  if (noScope(filters)) return { seconds: 0, entries: 0, people: 0, autoClosed: 0 };

  return prepared(
    "sum",
    shapeOf(filters),
    (where) => `
      SELECT COALESCE(SUM(e.seconds), 0) AS seconds,
             COUNT(*)                    AS entries,
             COUNT(DISTINCT e.userID)    AS people,
             COALESCE(SUM(e.autoClosed), 0) AS autoClosed
        FROM TaskEntries e${where}`
  ).get(paramsOf(filters));
};

/**
 * LEFT JOIN, nie JOIN — i to jest tu istotne, a nie kosmetyczne.
 *
 * Wpis wolno wystartować bez projektu (services/db.js: migrateEntryProjectOptional),
 * a getSummary liczy sumę po samym TaskEntries, bez złączenia. Przy zwykłym JOIN
 * ten podział zaniżałby się względem sumy ogólnej o czas nieprzypisany i nic by
 * tego na ekranie nie zdradziło. Wiersz zbiorczy wychodzi z id = NULL — grupują
 * się w nim wszystkie wpisy bez projektu; front podpisuje go "(bez projektu)".
 */
export const getByProject = (filters) => {
  if (noScope(filters)) return [];

  return prepared(
    "proj",
    shapeOf(filters),
    (where) => `
      SELECT p.id, p.name, p.client, p.color,
             SUM(e.seconds)           AS seconds,
             COUNT(*)                 AS entries,
             COUNT(DISTINCT e.userID) AS people
        FROM TaskEntries e
        LEFT JOIN Projects p ON p.id = e.projectID${where}
       GROUP BY p.id
       ORDER BY seconds DESC`
  ).all(paramsOf(filters));
};

const stmtAttendanceCache = new Map();

/**
 * Obecność z modułu kart czasu (Times) w tym samym oknie.
 *
 * Times.totalWorkTime jest TEKSTEM "HH:mm:ss" (spadek po Airtable), więc sumy
 * nie da się policzyć w SQL bez parsowania — wiersze zliczamy w JS przez
 * parseHmsToSeconds. Przy skali tej firmy to kilkaset wierszy na miesiąc.
 *
 * Times.data trzyma pełne ISO, stąd substr(...,1,10) — dokładnie tak samo
 * filtruje services/getTimesReport.js.
 *
 * Z filtrów bierze tylko te, które mają w kartach czasu odpowiednik: sekcję,
 * osobę i zakres dat. Projekt, próg minut i szukana fraza opisują POJEDYNCZY
 * wpis zadania, a nie obecność — obecność zostaje pełna, więc przy takim filtrze
 * kolumna „Pokrycie” pokazuje udział wybranych zadań w całym czasie w pracy.
 */
const getAttendanceSeconds = ({ from, to, sections, userID }) => {
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
    acc[row.userID] = (acc[row.userID] || 0) + parseHmsToSeconds(row.totalWorkTime);
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
             SUM(e.seconds) AS reported,
             COUNT(*)       AS entries
        FROM TaskEntries e
        JOIN Users u ON u.id = e.userID${where}
       GROUP BY u.id
       ORDER BY u.surname COLLATE NOCASE, u.name COLLATE NOCASE`
  ).all(paramsOf(filters));

  const attendance = getAttendanceSeconds(filters);

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

// Zapytanie o szczegółową listę wpisów. Jedno miejsce dla obu wołających:
// getEntries (materializuje tablicę) i iterateAllEntries (czyta leniwie).
const detailStatement = (filters, scope) =>
  prepared(
    `list-${scope}`,
    shapeOf(filters),
    (where) => `
      SELECT e.id, e.data, e.startedAt, e.endedAt, e.seconds, e.description,
             e.autoClosed, e.editedByName, e.section, e.userID, e.projectID,
             u.name, u.surname,
             -- Sekcja KONTA, nie wpisu: przy poprawianiu wpisu o tym, które
             -- projekty wolno wybrać, decyduje dzisiejsza sekcja pracownika
             -- (pages/api/entries/[id].js), a ta może być inna niż ta zapisana
             -- w starym wpisie — ludzie przechodzą między działami.
             u.section AS userSection,
             p.name AS projectName, p.client AS projectClient, p.color AS projectColor,
             p.isActive AS projectIsActive
        FROM TaskEntries e
        JOIN Users u    ON u.id = e.userID
        LEFT JOIN Projects p ON p.id = e.projectID${where}
       ORDER BY e.data DESC, e.startedAt DESC${LIMIT_CLAUSE[scope] ?? LIMIT_CLAUSE.view}`
  );

/**
 * @param {"view"|"all"} scope "view" tnie do DETAIL_LIMIT (ekran),
 *                             "all" zwraca komplet (eksport CSV).
 * @param {{summary?: {entries: number}}} opts summary — gotowy wynik getSummary
 *   dla TYCH SAMYCH filtrów, jeśli wołający już go ma.
 *
 * Panel kierownika (pages/zadania/zarzadzaj.js) liczy podsumowanie osobno, do
 * własnego propsa, a potem wołał getEntries, które liczyło je po raz drugi —
 * to samo zapytanie agregujące dwa razy na jedno wejście na stronę.
 */
export const getEntries = (filters, scope = "view", { summary } = {}) => {
  if (noScope(filters)) return { rows: [], total: 0, limit: DETAIL_LIMIT };

  const total = (summary ?? getSummary(filters)).entries;

  const rows = detailStatement(filters, scope).all(paramsOf(filters));

  return {
    rows: rows.map((r) => ({
      ...r,
      autoClosed: Boolean(r.autoClosed),
      projectIsActive: Boolean(r.projectIsActive),
    })),
    total,
    limit: DETAIL_LIMIT,
  };
};

/**
 * To samo co getEntries(filters, "all"), ale LENIWIE — wiersz po wierszu.
 *
 * Do eksportu CSV, który nie ma górnego ograniczenia liczby wpisów. Wariant
 * tablicowy materializuje w pamięci komplet wierszy PLUS gotowy string pliku;
 * przy szerokim zakresie dat to najgrubsza alokacja w aplikacji, a kontener ma
 * 1 GB bez swapu. `stmt.iterate()` czyta z bazy tyle, ile akurat konsumuje
 * wołający (utils/csv.js: streamCsv).
 *
 * UWAGA: iterator trzyma otwarty kursor na bazie, więc trzeba go przejść do
 * końca (pętla for..of to robi). Zapytanie jest identyczne jak w getEntries —
 * ten sam cache przygotowanych statementów, ten sam ORDER BY.
 */
export function* iterateAllEntries(filters) {
  if (noScope(filters)) return;

  const stmt = detailStatement(filters, "all");
  for (const r of stmt.iterate(paramsOf(filters))) {
    yield { ...r, autoClosed: Boolean(r.autoClosed), projectIsActive: Boolean(r.projectIsActive) };
  }
}
