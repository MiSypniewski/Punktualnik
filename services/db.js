import path from "path";
import fs from "fs";
import Database from "better-sqlite3";

// Lokalna baza SQLite. Ścieżkę można nadpisać zmienną SQLITE_PATH
// (przydatne na Mikrusie, np. na wolumenie trwałym poza katalogiem aplikacji).
const dbPath = process.env.SQLITE_PATH || path.join(process.cwd(), "data", "punktualnik.sqlite");

// W trybie dev Next.js przeładowuje moduły — trzymamy jedno połączenie na proces.
const globalForDb = globalThis;

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

  return db;
};

const db = globalForDb.__punktualnikDb || createDb();
if (process.env.NODE_ENV !== "production") {
  globalForDb.__punktualnikDb = db;
}

export default db;
