import path from "path";
import fs from "fs";
import Database from "better-sqlite3";
import { installRuntimeGuards } from "./runtime";
import { logInfo, logError } from "./log";

// Lokalna baza SQLite. Ścieżkę można nadpisać zmienną SQLITE_PATH
// (przydatne na Mikrusie, np. na wolumenie trwałym poza katalogiem aplikacji).
const dbPath = process.env.SQLITE_PATH || path.join(process.cwd(), "data", "punktualnik.sqlite");

// Jedno połączenie na proces — trzymane na `globalThis`, NIE w zmiennej modułu.
//
// To nie jest tylko wygoda dla trybu dev (gdzie Next przeładowuje moduły). Next 12
// buduje DWA niezależne runtime'y webpacka: jeden dla stron (`webpack-runtime.js`),
// drugi dla tras API (`webpack-api-runtime.js`). Mają rozłączne rejestry modułów,
// więc ten plik wykonuje się w procesie dwa razy — sprawdzone: `grep -l __punktualnikDb
// .next/server/chunks` daje dwa chunki, a `lsof` na działającym procesie pokazywał
// dwa uchwyty do pliku bazy. Zmienna modułowa jest w każdym z nich osobna.
//
// Dwa połączenia wystarczą: `better-sqlite3` jest synchroniczne, więc kolizja o blokadę
// zapisu między nimi zamraża CAŁY proces na `busy_timeout` — i to nie tylko dla
// piszącego, ale dla wszystkich, także dla czystych odczytów. Zmierzone na gałęzi
// sprzed poprawki: cudza blokada trzymana 6 s wydłużyła KAŻDE żądanie do 5,7 s,
// łącznie z /api/entries/timer, który niczego nie zapisuje.
//
// Tak właśnie 21.08.2026 aplikacja przestała odbierać połączenia (Cloudflare 522),
// mimo że proces żył — pm2 nie odnotował ani jednego restartu.
const globalForDb = globalThis;

// Ile czekamy na cudzą blokadę zapisu. Wartość jest EKSPORTOWANA, bo
// services/taskEntries.js skraca ją na czas sprzątania i musi mieć do czego wrócić.
// To górny próg zamrożenia całego procesu na jedną kolizję — patrz komentarz przy
// pragmie w createDb.
export const DEFAULT_BUSY_MS = 3000;

// Jednorazowe przeniesienie sekcji, które przed powstaniem tabeli Sections żyły
// wyłącznie jako tekst w Users.section i ManagerSections.section (przypisanie
// kierownika musi przeżyć migrację, inaczej po restarcie przestałby kogokolwiek
// widzieć). Etykietą zostaje sam slug — do poprawienia komendą `section-label`.
//
// Warunek "tabela jest pusta" jest tu istotny: bez niego wyłączona sekcja
// (isActive = 0) wracałaby jako aktywna przy każdym restarcie aplikacji.
// Sekcji nigdy nie kasujemy, więc pusta tabela oznacza wyłącznie "jeszcze nie
// migrowano", a nie "skasowano wszystkie".
//
// Lustrzane wobec scripts/admin.js — skrypt jest CommonJS i nie zaimportuje tego
// modułu, a bywa uruchamiany na bazie, której aplikacja jeszcze nie otwierała.
const backfillSections = (db) => {
  if (db.prepare(`SELECT COUNT(*) AS n FROM Sections`).get().n > 0) return;

  db.exec(`
    INSERT OR IGNORE INTO Sections (slug, label)
    SELECT slug, slug FROM (
      SELECT DISTINCT TRIM(section) AS slug FROM Users          WHERE TRIM(section) <> ''
      UNION
      SELECT DISTINCT TRIM(section) AS slug FROM ManagerSections WHERE TRIM(section) <> ''
    );
  `);
};

// Przejście TaskEntries.minutes → TaskEntries.seconds.
//
// CREATE TABLE IF NOT EXISTS nie rusza tabeli, która już istnieje, więc bazy
// założone przed tą zmianą (testowe i deweloperskie) potrzebują ALTER-a. Wymiar
// przeliczamy z samych znaczników, a nie z minut — startedAt/endedAt od początku
// mają sekundy, więc odtworzenie jest DOKŁADNE i wpisy krótsze niż minuta
// przestają mieć wymiar 0.
//
// Idempotentne: sterowane obecnością kolumn, więc kolejne restarty nie robią nic.
const migrateEntrySeconds = (db) => {
  const columns = db.prepare(`PRAGMA table_info(TaskEntries)`).all().map((c) => c.name);

  if (!columns.includes("seconds")) {
    db.exec(`ALTER TABLE TaskEntries ADD COLUMN seconds INTEGER`);
    db.exec(`
      UPDATE TaskEntries
         SET seconds = CAST(ROUND((julianday(endedAt) - julianday(startedAt)) * 86400) AS INTEGER)
       WHERE endedAt IS NOT NULL`);
  }

  // DROP COLUMN, a nie "zostawmy, nikomu nie przeszkadza": kolumna, której nikt
  // nie przelicza, po tygodniu kłamie i przy czytaniu bazy z konsoli podsuwa
  // fałszywą odpowiedź. SQLite umie ją usunąć od 3.35 (mamy 3.53).
  if (columns.includes("minutes")) {
    db.exec(`ALTER TABLE TaskEntries DROP COLUMN minutes`);
  }
};

// DDL indeksów TaskEntries wyciągnięte z głównego db.exec, bo potrzebują go DWA
// miejsca: zakładanie bazy i migracja migrateEntryProjectOptional. Ta druga
// przebudowuje tabelę, a DROP TABLE zabiera indeksy ze sobą — i akurat tutaj
// dwie odręczne kopie tej listy byłyby groźne, bo brak idx_entries_running nie
// objawiłby się niczym poza dwoma równoległymi timerami u jednej osoby.
const ENTRY_INDEXES = `
    CREATE INDEX IF NOT EXISTS idx_entries_user_data     ON TaskEntries(userID, data);
    CREATE INDEX IF NOT EXISTS idx_entries_project_data  ON TaskEntries(projectID, data);
    CREATE INDEX IF NOT EXISTS idx_entries_section_data  ON TaskEntries(section, data);

    -- "Najwyżej jeden biegnący timer na osobę" pilnowane przez BAZĘ, a nie przez
    -- kod: dwie otwarte zakładki nie wystartują dwóch liczników, bo drugi INSERT
    -- odbije się o ten indeks (SQLITE_CONSTRAINT → 409 already_running).
    -- Indeks częściowy, więc kosztuje tyle, ile jest aktualnie biegnących wpisów.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_entries_running
      ON TaskEntries(userID) WHERE endedAt IS NULL;
`;

// Kolumny TaskEntries wymienione z nazwy — przepisanie tabeli nie może zależeć
// od ich kolejności w schemacie.
const ENTRY_COLUMNS = `id, userID, projectID, description, data, startedAt, endedAt,
       seconds, section, autoClosed, createdAt, editedAt, editedBy, editedByName`;

/**
 * TaskEntries.projectID przestaje być NOT NULL.
 *
 * Timer wolno teraz uruchomić jednym kliknięciem, bez wskazywania projektu —
 * projekt i opis uzupełnia się w trakcie, a zamknięcie wpisu wymaga obu
 * (services/taskEntries.js: assertComplete). Wcześniej <select> podstawiał
 * pierwszy projekt z brzegu, więc kto nie spojrzał w pole, ten po cichu
 * raportował czas na cudzy projekt.
 *
 * SQLite nie ma ALTER COLUMN, więc zdjęcie NOT NULL to przepisanie całej tabeli
 * — procedura z dokumentacji ("Making Other Kinds Of Table Schema Changes").
 * Klucz obcy zostaje: w SQLite NULL nigdy nie łamie FK.
 *
 * Idempotentna i sterowana STANEM SCHEMATU, nie numerem wersji — jak
 * migrateEntrySeconds wyżej. Musi lecieć PO niej, bo tamta dokłada kolumnę
 * seconds i usuwa minutes, a ta przepisuje listę kolumn dosłownie.
 */
const migrateEntryProjectOptional = (db) => {
  const projectID = db.prepare(`PRAGMA table_info(TaskEntries)`).all().find((c) => c.name === "projectID");
  if (!projectID || projectID.notnull === 0) return;

  // PRAGMA foreign_keys jest w transakcji ignorowana, więc musi paść przed nią.
  db.pragma("foreign_keys = OFF");
  try {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE TaskEntries_new (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          userID       INTEGER NOT NULL,
          projectID    INTEGER,
          description  TEXT    NOT NULL DEFAULT '',
          data         TEXT    NOT NULL,
          startedAt    TEXT    NOT NULL,
          endedAt      TEXT,
          seconds      INTEGER,
          section      TEXT    NOT NULL,
          autoClosed   INTEGER NOT NULL DEFAULT 0,
          createdAt    TEXT    NOT NULL,
          editedAt     TEXT,
          editedBy     INTEGER,
          editedByName TEXT,
          FOREIGN KEY (userID)    REFERENCES Users(id),
          FOREIGN KEY (projectID) REFERENCES Projects(id)
        );

        INSERT INTO TaskEntries_new (${ENTRY_COLUMNS})
             SELECT ${ENTRY_COLUMNS} FROM TaskEntries;

        DROP TABLE TaskEntries;
        ALTER TABLE TaskEntries_new RENAME TO TaskEntries;
        ${ENTRY_INDEXES}
      `);
    })();

    const broken = db.pragma("foreign_key_check");
    if (broken.length > 0) {
      throw new Error(`TaskEntries: przebudowa zostawiła ${broken.length} osieroconych wierszy.`);
    }
  } finally {
    db.pragma("foreign_keys = ON");
  }
};

/**
 * Times dostaje kolumnę autoClosed i podpis korekty.
 *
 * autoClosed — kartę odbitą rano, przy której nikt nie dotknął kafelka na
 * wyjściu, domyka o 3:00 zadanie nocne (services/closeOpenCards.js). Bez tej
 * flagi domknięty wpis wyglądałby identycznie jak odbity ręcznie, a to dwie
 * różne rzeczy: pierwszy jest ZGADNIĘTY i czeka na potwierdzenie kierownika.
 *
 * editedAt/editedBy/editedByName — podpis pod korektą, dokładnie jak
 * w TaskEntries. Times nie ma statusów ani historii, więc bez podpisu po
 * miesiącu nie da się odróżnić odbicia pracownika od poprawki kierownika.
 *
 * Idempotentna i sterowana STANEM SCHEMATU, jak migracje TaskEntries wyżej.
 */
const migrateTimesAudit = (db) => {
  const columns = db.prepare(`PRAGMA table_info(Times)`).all().map((c) => c.name);

  // ALTER TABLE ADD COLUMN z NOT NULL DEFAULT jest w SQLite dozwolone i wypełnia
  // istniejące wiersze wartością domyślną — stare karty dostają autoClosed = 0.
  if (!columns.includes("autoClosed")) {
    db.exec(`ALTER TABLE Times ADD COLUMN autoClosed INTEGER NOT NULL DEFAULT 0`);
  }
  if (!columns.includes("editedAt")) {
    db.exec(`ALTER TABLE Times ADD COLUMN editedAt TEXT`);
  }
  if (!columns.includes("editedBy")) {
    db.exec(`ALTER TABLE Times ADD COLUMN editedBy INTEGER`);
  }
  if (!columns.includes("editedByName")) {
    db.exec(`ALTER TABLE Times ADD COLUMN editedByName TEXT`);
  }
};

/**
 * Users dostaje kolumnę resumeTiles (liczba kafelków "Wznów": 0 = ukryte,
 * poza tym 4..20).
 *
 * CREATE TABLE IF NOT EXISTS nie rusza tabeli, która już istnieje, więc bazy
 * sprzed tej zmiany — deweloperska i produkcyjna — potrzebują ALTER-a. NOT NULL
 * z wartością domyślną jest w SQLite dozwolone przy ADD COLUMN i wypełnia
 * istniejące wiersze: każdy dostaje sześć kafelków, czyli dokładnie to, co
 * widział przed zmianą (stała RESUME_TILES w pages/zadania/index.js).
 *
 * Idempotentna i sterowana STANEM SCHEMATU, jak migracje wyżej.
 */
const migrateUserResumeTiles = (db) => {
  const columns = db.prepare(`PRAGMA table_info(Users)`).all().map((c) => c.name);

  if (!columns.includes("resumeTiles")) {
    db.exec(`ALTER TABLE Users ADD COLUMN resumeTiles INTEGER NOT NULL DEFAULT 6`);
  }
};

const createDb = () => {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  // MUSI być pierwsze: gdy bazę otwiera kilka procesów naraz (workery `next build`,
  // build obok działającej aplikacji), inne połączenia czekają na zwolnienie locka
  // zamiast od razu rzucać SQLITE_BUSY na PRAGMA journal_mode/CREATE TABLE.
  //
  // 3 s, nie 10: czekanie jest SYNCHRONICZNE, więc ta liczba to górny próg zamrożenia
  // całego serwera HTTP na jedną kolizję. Realnym konkurentem jest już tylko
  // `scripts/admin.js` odpalany ręcznie obok aplikacji (w procesie mamy jedno
  // połączenie), a jego zapisy trwają milisekundy — 3 s to i tak gruby zapas.
  db.pragma(`busy_timeout = ${DEFAULT_BUSY_MS}`);
  db.pragma("journal_mode = WAL");
  // W trybie WAL NORMAL jest bezpieczne: przetrwa pad aplikacji i zabicie procesu,
  // traci najwyżej ostatnie transakcje przy nagłej utracie zasilania maszyny.
  // W zamian znika fsync przy każdym commicie — na współdzielonym dysku Mikrusa
  // to najdroższa część zwykłego odbicia karty.
  db.pragma("synchronous = NORMAL");
  // Bez tego WAL rósł w nieskończoność (436 KB przy bazie 114 KB): domyślny próg
  // 1000 stron jest dla tak małej bazy nieosiągalny, więc checkpoint nigdy nie ruszał.
  db.pragma("wal_autocheckpoint = 400");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS Users (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      name         TEXT    NOT NULL,
      surname      TEXT    NOT NULL,
      section      TEXT    NOT NULL,
      location     TEXT    NOT NULL,
      email        TEXT    NOT NULL UNIQUE,
      passwordHash TEXT    NOT NULL,
      passwordSalt TEXT    NOT NULL,
      role         TEXT    NOT NULL DEFAULT 'user',
      isActive     INTEGER NOT NULL DEFAULT 0,
      -- Ile kafelków "Wznów" widzi pracownik na /zadania: 0 znaczy "wcale",
      -- poza tym 4..20. Ustawienie WIDOKU w tabeli danych osobowych —
      -- świadomie, w odróżnieniu od przełącznika grupowania listy, który siedzi
      -- w localStorage. Powód jest ten sam co przy ResumeTiles niżej: liczba,
      -- zero i przypięcia są jednym ustawieniem, a rozdzielenie ich na dwa
      -- magazyny dałoby panel z dwiema różnymi prawdami. Zerem sekcję się
      -- CHOWA, a nie kasuje — przypięcia zostają w ResumeTiles nietknięte.
      -- Zakresu pilnuje services/resumeTiles.js.
      resumeTiles  INTEGER NOT NULL DEFAULT 6
    );

    -- Słownik sekcji (działów). Do sierpnia 2026 sekcja nie miała własnej tabeli
    -- — była gołym tekstem w Users.section, więc sekcja "istniała" dopiero wtedy,
    -- gdy ktoś ją miał, a lista do wyboru przy rejestracji była zaszyta w kodzie.
    --
    -- slug jest kluczem technicznym i JEDNOCZEŚNIE segmentem adresu /time/<slug>
    -- oraz wartością w Users.section, Times.section i ManagerSections.section.
    -- Dlatego jest niezmienny — do zmiany jest wyłącznie label. Sekcji się nie
    -- kasuje (Times trzyma sekcję historycznie), tylko wyłącza: isActive = 0
    -- znika z formularza rejestracji, ale nie rusza danych ani przypisań.
    CREATE TABLE IF NOT EXISTS Sections (
      slug     TEXT    PRIMARY KEY,
      label    TEXT    NOT NULL,
      isActive INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS Times (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      userID        INTEGER NOT NULL,
      name          TEXT,
      surname       TEXT,
      section       TEXT,
      location      TEXT,
      data          TEXT,
      startTime     TEXT,
      endTime       TEXT,
      totalWorkTime TEXT,
      status        TEXT,
      overTime      INTEGER DEFAULT 0
    );

    -- Wnioski o nadgodziny. Saldo pracownika = suma zatwierdzonych wierszy,
    -- gdzie 'early_leave' liczy się na minus (patrz services/overtimeKinds.js).
    -- Świadomie BEZ denormalizacji imienia/nazwiska (inaczej niż w Times, gdzie
    -- została po Airtable) — nazwiska bierzemy JOIN-em, więc zmiana danych
    -- konta propaguje się na całą historię.
    CREATE TABLE IF NOT EXISTS Overtime (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      userID        INTEGER NOT NULL,
      kind          TEXT    NOT NULL,
      data          TEXT    NOT NULL,
      minutes       INTEGER NOT NULL,
      reason        TEXT,
      status        TEXT    NOT NULL DEFAULT 'pending',
      createdAt     TEXT    NOT NULL,
      decidedAt     TEXT,
      decidedBy     INTEGER,
      decidedByName TEXT,
      decisionNote  TEXT,
      FOREIGN KEY (userID) REFERENCES Users(id)
    );

    -- Nieobecności: urlopy, zwolnienia, opieka. Obieg jak przy nadgodzinach
    -- (pending → approved/rejected, anulowanie przez pracownika), ale wniosek
    -- dotyczy ZAKRESU dni, nie jednego dnia.
    --
    -- createdBy/createdByName nie mają odpowiednika w Overtime i to jest
    -- różnica celowa: tam autorem zawsze jest pracownik, a tutaj wpis potrafi
    -- założyć kierownik (L4 ze zwolnienia, urlop zgłoszony telefonicznie).
    -- Bez tego po miesiącu nie da się odróżnić wniosku pracownika od notatki
    -- kierownika. Imię jest denormalizowane z tego samego powodu co
    -- decidedByName: podpis pod historycznym wpisem ma zostać taki, jaki był.
    --
    -- workDays jest REDUNDANTNE wobec pary dat i kalendarza świąt — trzymamy je
    -- z tego samego powodu co TaskEntries.seconds: salda je sumują, a liczenie
    -- kalendarza w każdym zapytaniu byłoby wolne i rozjechałoby się po zmianie
    -- listy świąt. Liczy je JEDNO miejsce, przy zapisie (services/createAbsence.js).
    --
    -- year wynika z dateFrom i istnieje po to, żeby pula urlopowa dała się
    -- rozliczyć rocznie jednym warunkiem. Wniosek przechodzący przez sylwestra
    -- jest odrzucany, więc rok jest zawsze jednoznaczny.
    CREATE TABLE IF NOT EXISTS Absences (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      userID        INTEGER NOT NULL,
      kind          TEXT    NOT NULL,
      dateFrom      TEXT    NOT NULL,
      dateTo        TEXT    NOT NULL,
      year          INTEGER NOT NULL,
      workDays      INTEGER NOT NULL,
      reason        TEXT,
      status        TEXT    NOT NULL DEFAULT 'pending',
      createdAt     TEXT    NOT NULL,
      createdBy     INTEGER,
      createdByName TEXT,
      decidedAt     TEXT,
      decidedBy     INTEGER,
      decidedByName TEXT,
      decisionNote  TEXT,
      FOREIGN KEY (userID) REFERENCES Users(id)
    );

    -- Przydziały dni urlopu. Pula pracownika na dany rok = suma tych wierszy;
    -- wykorzystanie odejmują zatwierdzone Absences rodzajów z usesPool.
    --
    -- Osobna tabela, a nie kolumna w Users, bo liczba dni ZMIENIA SIĘ w czasie
    -- i ma historię: 26 dni na start roku, 4 dni zaległe dopisane w lutym,
    -- korekta in minus po sprostowaniu wymiaru etatu. Kolumna zapamiętałaby
    -- wyłącznie ostatnią wartość i nikt by nie wiedział, skąd się wzięła.
    -- days bywa UJEMNE i to jest poprawne — tak wygląda korekta.
    CREATE TABLE IF NOT EXISTS LeaveAllowance (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      userID        INTEGER NOT NULL,
      year          INTEGER NOT NULL,
      days          INTEGER NOT NULL,
      note          TEXT,
      createdAt     TEXT    NOT NULL,
      createdBy     INTEGER,
      createdByName TEXT,
      FOREIGN KEY (userID) REFERENCES Users(id)
    );

    -- Które sekcje obsługuje dany kierownik. Przypisanie jest JAWNE i niezależne
    -- od Users.section kierownika: kierownik siedzący w sekcji "dyrekcja" może
    -- obsługiwać "spedycja" i "cns", a jedną sekcję może obsługiwać kilka osób.
    -- Brak wierszy = kierownik nie widzi nikogo (bezpieczna wartość domyślna).
    CREATE TABLE IF NOT EXISTS ManagerSections (
      managerID INTEGER NOT NULL,
      section   TEXT    NOT NULL,
      PRIMARY KEY (managerID, section),
      FOREIGN KEY (managerID) REFERENCES Users(id)
    );

    -- Słownik projektów dla modułu zadań. Projektu się NIE kasuje, tylko
    -- archiwizuje (isActive = 0): TaskEntries trzymają projectID historycznie,
    -- więc skasowanie osierociłoby wpisy sprzed lat. Ta sama zasada co przy
    -- sekcjach, ale kluczem jest tu id, a nie slug — nazwa projektu bywa
    -- długa i zmienna, a w odróżnieniu od sekcji nie trafia do adresu URL.
    CREATE TABLE IF NOT EXISTS Projects (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      name      TEXT    NOT NULL,
      client    TEXT,
      color     TEXT,
      isActive  INTEGER NOT NULL DEFAULT 1,
      createdAt TEXT    NOT NULL,
      createdBy INTEGER,
      FOREIGN KEY (createdBy) REFERENCES Users(id)
    );

    -- Które sekcje widzą dany projekt. Budowa jak ManagerSections, ale
    -- z ODWROTNĄ wartością domyślną: brak wierszy = projekt ogólnofirmowy,
    -- widoczny dla wszystkich. U kierowników pusto znaczy "nie widzi nikogo",
    -- bo tam chodzi o cudze dane osobowe; tutaj chodzi o samą nazwę projektu,
    -- a "projekt niewidoczny dla nikogo" byłby pułapką przy zakładaniu.
    -- Formularz preselekcjonuje sekcje kierownika, więc projekt globalny
    -- powstaje wyłącznie świadomie.
    CREATE TABLE IF NOT EXISTS ProjectSections (
      projectID INTEGER NOT NULL,
      section   TEXT    NOT NULL,
      PRIMARY KEY (projectID, section),
      FOREIGN KEY (projectID) REFERENCES Projects(id)
    );

    -- Wpisy czasu: "ile czasu i na czym zeszło". To DRUGA, niezależna oś
    -- ewidencji obok Times — Times mówi, że ktoś BYŁ w pracy (odbicie na
    -- kiosku), TaskEntries mówi, CZYM się zajmował. Celowo bez walidacji
    -- krzyżowej: zapomniana karta nie może blokować raportowania zadań.
    -- Zestawienie obu wielkości jest wyłącznie informacyjne, w dashboardzie.
    --
    -- Nazwa jest umyślnie daleko od Times, żeby przy czytaniu zapytania nie
    -- było wątpliwości, o którą oś chodzi.
    --
    -- startedAt/endedAt: 'YYYY-MM-DD HH:mm:ss', czas lokalny BEZ offsetu strefy
    -- (Times trzyma ISO z '+02:00'). Ta niespójność jest świadoma i opisana
    -- w services/workday.js — bez jednolitego kształtu leksykograficzne
    -- porównanie zakresów w SQL przestaje wykrywać kolizje.
    --
    -- seconds jest redundantne wobec pary startedAt/endedAt. Trzymamy je, bo
    -- raporty sumują tę kolumnę i liczenie różnicy dat na tekście w SQLite
    -- byłoby wolne i kruche. Warunek: przeliczane WYŁĄCZNIE w services/taskEntries.js.
    --
    -- SEKUNDY, nie minuty: zadanie potrafi trwać pół minuty ("odbiłem maila",
    -- "podpis na dokumencie"), a przy zaokrąglaniu do minut taki wpis miał wymiar
    -- 0 i nie dawał się nawet poprawić — edycja odsyłała godziny bez sekund,
    -- więc walidacja "koniec musi się różnić od początku" odrzucała własny wpis.
    CREATE TABLE IF NOT EXISTS TaskEntries (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      userID       INTEGER NOT NULL,
      -- projectID BEZ NOT NULL: timer wolno odpalić jednym kliknięciem, jeszcze
      -- nie wiedząc, na co czas pójdzie. Kompletu (projekt + opis) pilnuje
      -- dopiero zamknięcie wpisu — services/taskEntries.js: assertComplete.
      -- Bazy sprzed tej zmiany przerabia migrateEntryProjectOptional.
      projectID    INTEGER,
      description  TEXT    NOT NULL DEFAULT '',
      data         TEXT    NOT NULL,
      startedAt    TEXT    NOT NULL,
      endedAt      TEXT,
      seconds      INTEGER,
      section      TEXT    NOT NULL,
      autoClosed   INTEGER NOT NULL DEFAULT 0,
      createdAt    TEXT    NOT NULL,
      editedAt     TEXT,
      editedBy     INTEGER,
      editedByName TEXT,
      FOREIGN KEY (userID)    REFERENCES Users(id),
      FOREIGN KEY (projectID) REFERENCES Projects(id)
    );

    -- Przypięte kafelki "Wznów" na /zadania. Kafelek to para projekt + opis,
    -- czyli dokładnie to, co podsuwa services/entrySuggestions.js — z jedną
    -- różnicą: tamto wylicza się z historii i zmienia razem z nią, a to
    -- pracownik ustawił sobie sam i ma stać.
    --
    -- Dlatego w BAZIE, a nie w localStorage jak przełącznik grupowania listy:
    -- to nie jest ustawienie widoku, tylko TREŚĆ. Ma jechać za człowiekiem
    -- z komputera na telefon i przeżyć wyczyszczenie przeglądarki. Przy okazji
    -- serwer zna ją w chwili renderu, więc nie ma mrugnięcia po hydratacji.
    --
    -- position jest GĘSTE (0..n-1) i przepisywane w całości przy każdym zapisie
    -- (services/resumeTiles.js) — nie ma dziur do interpretowania ani wierszy
    -- osieroconych po zmniejszeniu liczby kafelków.
    --
    -- projectID jest OBOWIĄZKOWY, w odróżnieniu od TaskEntries: tam timer wolno
    -- odpalić, jeszcze nie wiedząc na co, a kafelek istnieje wyłącznie po to,
    -- żeby wystartować GOTOWĄ parę jednym kliknięciem.
    CREATE TABLE IF NOT EXISTS ResumeTiles (
      userID      INTEGER NOT NULL,
      position    INTEGER NOT NULL,
      projectID   INTEGER NOT NULL,
      description TEXT    NOT NULL,
      PRIMARY KEY (userID, position),
      FOREIGN KEY (userID)    REFERENCES Users(id),
      FOREIGN KEY (projectID) REFERENCES Projects(id)
    );

    -- Zapadki zadań okresowych (services/scheduler.js), po jednym wierszu na zadanie.
    --
    -- Na Mikrusie nie ma crona, a odpalanie zadania z timera w procesie ma jedną
    -- wadę: proces bywa restartowany (deploy, pm2, OOM). Bez zapadki restart
    -- o 3:05 wysłałby komplet powiadomień DRUGI raz. Trzymamy więc datę okresu,
    -- dla którego zadanie już poszło — jedno porównanie rozstrzyga, czy jest co robić.
    --
    -- Kolumna lastDay znaczy tyle, ile zadanie w niej zapisze: dla nocnego to doba robocza
    -- (services/nightlyJob.js), dla tygodniowego data ostatniego wtorku
    -- (services/weeklyUndertimeJob.js). Kolumna zostaje jedna, bo w obu przypadkach
    -- porównanie jest to samo — "czy zapisana data jest starsza od bieżącego okresu".
    --
    -- W bazie, a nie w pamięci procesu, właśnie dlatego, że chodzi o przeżycie restartu.
    CREATE TABLE IF NOT EXISTS JobRuns (
      job     TEXT PRIMARY KEY,
      lastDay TEXT NOT NULL,
      ranAt   TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_times_user_data    ON Times(userID, data);
    CREATE INDEX IF NOT EXISTS idx_times_section_data ON Times(section, data);

    -- Indeks NA WYRAŻENIU, nie na kolumnie — i to jest tu sedno.
    --
    -- Times.data trzyma pełne ISO ze strefą (2026-05-18T03:00:00+02:00), więc
    -- raporty filtrują po substr(data,1,10). Wywołanie funkcji na kolumnie
    -- unieważnia zwykły indeks: SQLite nie ma jak porównać zakresu i czyta całą
    -- tabelę. Ten indeks przechowuje dokładnie to wyrażenie, którego szuka
    -- services/getTimesReport.js i services/entryStats.js, więc oba wracają
    -- na wyszukiwanie po zakresie.
    CREATE INDEX IF NOT EXISTS idx_times_datepart ON Times(substr(data,1,10));
    CREATE INDEX IF NOT EXISTS idx_users_section      ON Users(section);
    CREATE INDEX IF NOT EXISTS idx_overtime_user      ON Overtime(userID, data);
    CREATE INDEX IF NOT EXISTS idx_overtime_status    ON Overtime(status);

    CREATE INDEX IF NOT EXISTS idx_absences_user      ON Absences(userID, dateFrom, dateTo);
    CREATE INDEX IF NOT EXISTS idx_absences_status    ON Absences(status);
    CREATE INDEX IF NOT EXISTS idx_absences_user_year ON Absences(userID, year);
    -- Pytanie kiosku: "kto z sekcji jest nieobecny DZISIAJ". Zakres dat bez
    -- userID z przodu, bo pytamy o wszystkich naraz.
    CREATE INDEX IF NOT EXISTS idx_absences_range     ON Absences(dateFrom, dateTo);
    CREATE INDEX IF NOT EXISTS idx_allowance_user_year ON LeaveAllowance(userID, year);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_name  ON Projects(name COLLATE NOCASE);
    ${ENTRY_INDEXES}
  `);

  backfillSections(db);
  migrateEntrySeconds(db);
  migrateEntryProjectOptional(db);
  migrateTimesAudit(db);
  migrateUserResumeTiles(db);

  // Ten wpis ma być w logu DOKŁADNIE RAZ na uruchomienie procesu. Więcej niż
  // jeden oznacza, że singleton na globalThis przestał działać i wróciliśmy do
  // stanu, który 21.08.2026 położył aplikację — patrz komentarz przy globalForDb.
  logInfo("db", "połączenie otwarte", { path: dbPath });

  return db;
};

// Zapis na globalu bezwarunkowo — także w produkcji. Wcześniej stał tu warunek
// `NODE_ENV !== "production"`, przez który na serwerze singleton w ogóle nie działał
// i każda trasa otwierała własne połączenie. Patrz komentarz przy `globalForDb`.
// Dozór nad procesem podpinamy tutaj, bo ten moduł wchodzi do każdego bundla
// serwerowego i nigdy do klienta. Rejestracja jest idempotentna.
installRuntimeGuards();

const db = globalForDb.__punktualnikDb || createDb();
globalForDb.__punktualnikDb = db;

// Budzik zadań okresowych: nocnego (domykanie zapomnianych kart i timerów)
// i tygodniowego (przypomnienie o niedogodzinach). Oba w services/scheduler.js.
//
// Import DYNAMICZNY i dopiero TUTAJ, po przypisaniu `db` — to nie jest ozdobnik.
// services/scheduler.js ciągnie za sobą moduły zadań, a przez nie closeOpenCards,
// taskEntries i getUndertimeUsers, które przygotowują swoje zapytania na poziomie
// modułu. Statyczny import na górze pliku wykonałby je, ZANIM `db` w tym pliku
// w ogóle powstanie, i aplikacja wywracałaby się przy starcie na ReferenceError.
// Dynamiczny import rozwiązuje się w kolejnym mikrotasku, czyli po zakończeniu
// tego modułu.
import("./scheduler")
  .then(({ installScheduler }) => installScheduler())
  .catch((error) => logError("db", error, { phase: "scheduler-install" }));

export default db;
