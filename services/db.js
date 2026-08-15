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

    CREATE INDEX IF NOT EXISTS idx_times_user_data    ON Times(userID, data);
    CREATE INDEX IF NOT EXISTS idx_times_section_data ON Times(section, data);
    CREATE INDEX IF NOT EXISTS idx_users_section      ON Users(section);
    CREATE INDEX IF NOT EXISTS idx_overtime_user      ON Overtime(userID, data);
    CREATE INDEX IF NOT EXISTS idx_overtime_status    ON Overtime(status);
  `);

  backfillSections(db);

  return db;
};

const db = globalForDb.__punktualnikDb || createDb();
if (process.env.NODE_ENV !== "production") {
  globalForDb.__punktualnikDb = db;
}

export default db;
