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

    CREATE INDEX IF NOT EXISTS idx_times_user_data    ON Times(userID, data);
    CREATE INDEX IF NOT EXISTS idx_times_section_data ON Times(section, data);
    CREATE INDEX IF NOT EXISTS idx_users_section      ON Users(section);
  `);

  return db;
};

const db = globalForDb.__punktualnikDb || createDb();
if (process.env.NODE_ENV !== "production") {
  globalForDb.__punktualnikDb = db;
}

export default db;
