#!/usr/bin/env node
/**
 * Panel admina z linii poleceń — zarządzanie użytkownikami w lokalnej bazie SQLite.
 *
 * Zastępuje to, co wcześniej robiło się ręcznie w UI Airtable
 * (aktywacja konta + nadanie roli editor). Działa też wtedy, gdy do aplikacji
 * nie da się jeszcze zalogować (bootstrap pierwszego konta).
 *
 * Użycie (na Mikrusie po SSH, z katalogu aplikacji):
 *   node scripts/admin.js list
 *   node scripts/admin.js pending
 *   node scripts/admin.js activate   <email|id>
 *   node scripts/admin.js deactivate <email|id>
 *   node scripts/admin.js role       <email|id> <user|editor>
 *   node scripts/admin.js section    <email|id> <nazwaSekcji>
 *   node scripts/admin.js passwd     <email|id> <noweHaslo>
 *
 * Skróty npm (pamiętaj o `--`):
 *   npm run admin -- pending
 *   npm run admin -- activate jan@example.pl
 */

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

// Ten sam mechanizm ładowania env co w Next.js — bierze .env.local, .env itd.,
// więc SQLITE_PATH jest rozwiązywane identycznie jak w działającej aplikacji.
require("@next/env").loadEnvConfig(process.cwd(), false, { info() {}, error: console.error });

// Ta sama domyślna ścieżka co w services/db.js — musi pozostać zgodna.
const dbPath = process.env.SQLITE_PATH || path.join(process.cwd(), "data", "punktualnik.sqlite");

const Database = require("better-sqlite3");
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
db.pragma("busy_timeout = 10000"); // pierwsze — czekaj na lock, nie rzucaj SQLITE_BUSY
db.pragma("journal_mode = WAL");

// Defensywnie — gdyby aplikacja nie była jeszcze nigdy uruchomiona.
// CREATE ... IF NOT EXISTS jest idempotentne i lustrzane wobec services/db.js.
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

const die = (msg) => {
  console.error(`Błąd: ${msg}`);
  process.exit(1);
};

// Argument numeryczny → szukamy po id, w przeciwnym razie po e-mailu.
const findUser = (selector) => {
  if (!selector) die("podaj e-mail lub id użytkownika.");
  const byId = /^\d+$/.test(selector);
  const user = byId
    ? db.prepare("SELECT * FROM Users WHERE id = ?").get(Number(selector))
    : db.prepare("SELECT * FROM Users WHERE email = ?").get(selector);
  if (!user) die(`nie znaleziono użytkownika: ${selector}`);
  return user;
};

const fmt = (u) =>
  `#${u.id}  ${u.name} ${u.surname}  <${u.email}>  sekcja=${u.section}  rola=${u.role}  ${
    u.isActive ? "AKTYWNY" : "nieaktywny"
  }`;

const printList = (rows) => {
  if (rows.length === 0) {
    console.log("(brak)");
    return;
  }
  rows.forEach((u) => console.log(fmt(u)));
  console.log(`\nRazem: ${rows.length}`);
};

const [cmd, selector, extra] = process.argv.slice(2);

switch (cmd) {
  case "list":
    printList(db.prepare("SELECT * FROM Users ORDER BY id").all());
    break;

  case "pending":
    printList(db.prepare("SELECT * FROM Users WHERE isActive = 0 ORDER BY id").all());
    break;

  case "activate": {
    const u = findUser(selector);
    db.prepare("UPDATE Users SET isActive = 1 WHERE id = ?").run(u.id);
    console.log("Aktywowano:");
    console.log(fmt(findUser(String(u.id))));
    break;
  }

  case "deactivate": {
    const u = findUser(selector);
    db.prepare("UPDATE Users SET isActive = 0 WHERE id = ?").run(u.id);
    console.log("Dezaktywowano:");
    console.log(fmt(findUser(String(u.id))));
    break;
  }

  case "role": {
    const u = findUser(selector);
    if (extra !== "user" && extra !== "editor") {
      die("rola musi być 'user' albo 'editor'.");
    }
    db.prepare("UPDATE Users SET role = ? WHERE id = ?").run(extra, u.id);
    console.log("Zmieniono rolę:");
    console.log(fmt(findUser(String(u.id))));
    break;
  }

  case "section": {
    const u = findUser(selector);
    if (!extra || !extra.trim()) die("podaj nazwę sekcji.");
    db.prepare("UPDATE Users SET section = ? WHERE id = ?").run(extra.trim(), u.id);
    console.log("Zmieniono sekcję:");
    console.log(fmt(findUser(String(u.id))));
    break;
  }

  case "passwd": {
    const u = findUser(selector);
    if (!extra) die("podaj nowe hasło.");
    // Te same parametry co w services/authorizeUser.js — inaczej logowanie nie zadziała.
    const passwordSalt = crypto.randomBytes(256).toString("hex");
    const passwordHash = crypto.pbkdf2Sync(extra, passwordSalt, 2137, 256, "sha512").toString("hex");
    db.prepare("UPDATE Users SET passwordHash = ?, passwordSalt = ? WHERE id = ?").run(
      passwordHash,
      passwordSalt,
      u.id
    );
    console.log(`Zmieniono hasło użytkownika #${u.id} <${u.email}>.`);
    break;
  }

  default:
    console.log(
      [
        "Panel admina (SQLite) — zarządzanie użytkownikami.",
        "",
        "Komendy:",
        "  list                       wypisz wszystkich użytkowników",
        "  pending                    wypisz tylko nieaktywnych (do aktywacji)",
        "  activate   <email|id>      aktywuj konto (isActive=1)",
        "  deactivate <email|id>      zablokuj konto (isActive=0)",
        "  role       <email|id> <user|editor>   zmień rolę",
        "  section    <email|id> <nazwaSekcji>   zmień sekcję",
        "  passwd     <email|id> <noweHaslo>     ustaw nowe hasło",
        "",
        `Baza: ${dbPath}`,
      ].join("\n")
    );
    if (cmd && cmd !== "help") process.exitCode = 1;
}

db.close();
