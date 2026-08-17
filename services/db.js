import path from "path";
import fs from "fs";
import Database from "better-sqlite3";

// Lokalna baza SQLite. Ścieżkę można nadpisać zmienną SQLITE_PATH
// (przydatne na Mikrusie, np. na wolumenie trwałym poza katalogiem aplikacji).
const dbPath = process.env.SQLITE_PATH || path.join(process.cwd(), "data", "punktualnik.sqlite");

// W trybie dev Next.js przeładowuje moduły — trzymamy jedno połączenie na proces.
const globalForDb = globalThis;

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

const createDb = () => {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  // MUSI być pierwsze: gdy bazę otwiera kilka procesów naraz (workery `next build`,
  // build obok działającej aplikacji), inne połączenia czekają na zwolnienie locka
  // zamiast od razu rzucać SQLITE_BUSY na PRAGMA journal_mode/CREATE TABLE.
  db.pragma("busy_timeout = 10000");
  db.pragma("journal_mode = WAL");
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
      isActive     INTEGER NOT NULL DEFAULT 0
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
      projectID    INTEGER NOT NULL,
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

    CREATE INDEX IF NOT EXISTS idx_times_user_data    ON Times(userID, data);
    CREATE INDEX IF NOT EXISTS idx_times_section_data ON Times(section, data);
    CREATE INDEX IF NOT EXISTS idx_users_section      ON Users(section);
    CREATE INDEX IF NOT EXISTS idx_overtime_user      ON Overtime(userID, data);
    CREATE INDEX IF NOT EXISTS idx_overtime_status    ON Overtime(status);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_name  ON Projects(name COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_entries_user_data     ON TaskEntries(userID, data);
    CREATE INDEX IF NOT EXISTS idx_entries_project_data  ON TaskEntries(projectID, data);
    CREATE INDEX IF NOT EXISTS idx_entries_section_data  ON TaskEntries(section, data);

    -- "Najwyżej jeden biegnący timer na osobę" pilnowane przez BAZĘ, a nie przez
    -- kod: dwie otwarte zakładki nie wystartują dwóch liczników, bo drugi INSERT
    -- odbije się o ten indeks (SQLITE_CONSTRAINT → 409 already_running).
    -- Indeks częściowy, więc kosztuje tyle, ile jest aktualnie biegnących wpisów.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_entries_running
      ON TaskEntries(userID) WHERE endedAt IS NULL;
  `);

  backfillSections(db);
  migrateEntrySeconds(db);

  return db;
};

const db = globalForDb.__punktualnikDb || createDb();
if (process.env.NODE_ENV !== "production") {
  globalForDb.__punktualnikDb = db;
}

export default db;
