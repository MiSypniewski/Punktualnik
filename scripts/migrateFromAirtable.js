#!/usr/bin/env node
/**
 * Jednorazowa migracja kont użytkowników z Airtable do lokalnej bazy SQLite.
 *
 * Przenosi WYŁĄCZNIE tabelę `Users` z bazy wskazanej w AIRTABLE_BASE.
 * Historia `Times` NIE jest migrowana (świadoma decyzja — startuje pusta).
 *
 * Czyta przez REST API Airtable (globalny fetch z Node >= 18/20), więc nie
 * wymaga pakietu `airtable` ani żadnej nowej zależności w package.json.
 *
 * Użycie (na Mikrusie po SSH, z katalogu aplikacji):
 *   node scripts/migrateFromAirtable.js --dry-run   # podgląd, bez zapisu
 *   node scripts/migrateFromAirtable.js             # właściwa migracja
 *
 * Wymaga w .env.local: AIRTABLE_API_KEY, AIRTABLE_BASE
 * (oraz opcjonalnie SQLITE_PATH — rozwiązywane jak w services/db.js).
 *
 * Bezpieczeństwo: jeśli tabela Users w SQLite NIE jest pusta, skrypt
 * przerywa działanie (ochrona przed zdublowaniem przy ponownym uruchomieniu).
 */

const path = require("path");
const fs = require("fs");

require("@next/env").loadEnvConfig(process.cwd(), false, { info() {}, error: console.error });

const DRY_RUN = process.argv.slice(2).includes("--dry-run");

const API_KEY = process.env.AIRTABLE_API_KEY;
const BASE = process.env.AIRTABLE_BASE;
const TABLE = "Users";

// Ta sama domyślna ścieżka co w services/db.js i scripts/admin.js — musi być zgodna.
const dbPath = process.env.SQLITE_PATH || path.join(process.cwd(), "data", "punktualnik.sqlite");

const die = (msg) => {
  console.error(`Błąd: ${msg}`);
  process.exit(1);
};

if (!API_KEY) die("brak AIRTABLE_API_KEY w środowisku (.env.local).");
if (!BASE) die("brak AIRTABLE_BASE w środowisku (.env.local).");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Pełna paginacja przez REST API Airtable (firstPage() brałby tylko 100 rekordów).
const fetchAllUsers = async () => {
  const records = [];
  let offset;
  do {
    const url = new URL(`https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TABLE)}`);
    url.searchParams.set("pageSize", "100");
    if (offset) url.searchParams.set("offset", offset);

    const res = await fetch(url, { headers: { Authorization: `Bearer ${API_KEY}` } });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      die(`Airtable HTTP ${res.status} ${res.statusText}. ${body}`);
    }
    const json = await res.json();
    records.push(...json.records);
    offset = json.offset;
    if (offset) await sleep(250); // limit Airtable ~5 req/s
  } while (offset);
  return records;
};

// isActive bywa zapisane jako true / "1" / 1 — normalizujemy do 0/1.
const toActive = (v) =>
  v === true || v === 1 || v === "1" || v === "true" ? 1 : 0;

const main = async () => {
  const Database = require("better-sqlite3");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

  // Lustrzane wobec services/db.js — gdyby aplikacja nie była jeszcze uruchomiona.
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
  `);

  const existing = db.prepare("SELECT COUNT(*) AS n FROM Users").get().n;
  if (existing > 0 && !DRY_RUN) {
    die(
      `tabela Users nie jest pusta (${existing} rekordów). ` +
        `Migracja przerwana, żeby nie zdublować danych. ` +
        `Użyj --dry-run do podglądu albo wyczyść bazę przed migracją.`
    );
  }

  console.log(`Baza SQLite: ${dbPath}`);
  console.log(`Airtable base: ${BASE}, tabela: ${TABLE}`);
  console.log(DRY_RUN ? "Tryb: DRY-RUN (bez zapisu)\n" : "Tryb: ZAPIS\n");

  const records = await fetchAllUsers();
  console.log(`Pobrano z Airtable: ${records.length} rekordów Users.\n`);

  const insert = db.prepare(`
    INSERT INTO Users (id, name, surname, section, location, email, passwordHash, passwordSalt, role, isActive)
    VALUES (@id, @name, @surname, @section, @location, @email, @passwordHash, @passwordSalt, @role, @isActive)
  `);

  const skipped = [];
  let inserted = 0;
  const seenEmails = new Set();

  const run = db.transaction(() => {
    for (const rec of records) {
      const f = rec.fields || {};
      const label = f.email || f.ID || rec.id;

      const required = ["name", "surname", "section", "location", "email", "passwordHash", "passwordSalt"];
      const missing = required.filter((k) => f[k] === undefined || f[k] === null || f[k] === "");
      if (missing.length) {
        skipped.push(`${label}: brak pól [${missing.join(", ")}]`);
        continue;
      }
      if (seenEmails.has(f.email)) {
        skipped.push(`${label}: zdublowany e-mail w danych Airtable`);
        continue;
      }
      seenEmails.add(f.email);

      const row = {
        id: Number.isInteger(Number(f.ID)) && Number(f.ID) > 0 ? Number(f.ID) : null,
        name: String(f.name),
        surname: String(f.surname),
        section: String(f.section),
        location: String(f.location),
        email: String(f.email),
        passwordHash: String(f.passwordHash),
        passwordSalt: String(f.passwordSalt),
        role: f.role ? String(f.role) : "user",
        isActive: toActive(f.isActive),
      };

      if (DRY_RUN) {
        inserted++;
        continue;
      }
      try {
        insert.run(row);
        inserted++;
      } catch (e) {
        skipped.push(`${label}: ${e.message}`);
      }
    }
  });

  run();

  console.log(`${DRY_RUN ? "Do wstawienia" : "Wstawiono"}: ${inserted}`);
  console.log(`Pominięto: ${skipped.length}`);
  if (skipped.length) {
    console.log("\nPominięte rekordy:");
    skipped.forEach((s) => console.log(`  - ${s}`));
  }

  if (!DRY_RUN) {
    const active = db.prepare("SELECT COUNT(*) AS n FROM Users WHERE isActive = 1").get().n;
    console.log(`\nW bazie: ${inserted} kont, w tym aktywnych: ${active}.`);
    console.log("Sprawdź: node scripts/admin.js list");
  }

  db.close();
};

main().catch((e) => die(e.stack || String(e)));
