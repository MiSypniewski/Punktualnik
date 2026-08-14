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
 *   node scripts/admin.js role       <email|id> <user|editor|manager>
 *   node scripts/admin.js section    <email|id> <nazwaSekcji>
 *   node scripts/admin.js sections   <email|id> [sekcja1,sekcja2]
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

  CREATE TABLE IF NOT EXISTS ManagerSections (
    managerID INTEGER NOT NULL,
    section   TEXT    NOT NULL,
    PRIMARY KEY (managerID, section),
    FOREIGN KEY (managerID) REFERENCES Users(id)
  );
`);

const ROLES = ["user", "editor", "manager"];

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

const sectionsOf = (managerID) =>
  db
    .prepare("SELECT section FROM ManagerSections WHERE managerID = ? ORDER BY section")
    .all(managerID)
    .map((r) => r.section);

const fmt = (u) => {
  // Dla kierownika sama rola nic nie mówi — liczy się, które sekcje obsługuje.
  const scope = u.role === "manager" ? `  obsługuje=[${sectionsOf(u.id).join(", ") || "BRAK"}]` : "";
  return `#${u.id}  ${u.name} ${u.surname}  <${u.email}>  sekcja=${u.section}  rola=${u.role}${scope}  ${
    u.isActive ? "AKTYWNY" : "nieaktywny"
  }`;
};

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
    // Lustrzane wobec ROLES w services/roles.js — ten skrypt jest CommonJS,
    // więc nie zaimportuje tamtego modułu (ESM). Zmiana tu = zmiana tam.
    if (!ROLES.includes(extra)) {
      die(`rola musi być jedną z: ${ROLES.join(", ")}.`);
    }
    db.prepare("UPDATE Users SET role = ? WHERE id = ?").run(extra, u.id);
    console.log("Zmieniono rolę:");
    console.log(fmt(findUser(String(u.id))));
    break;
  }

  // Które sekcje obsługuje kierownik. Bez drugiego argumentu — podgląd.
  // Lustrzane wobec services/managerSections.js (ten skrypt jest CommonJS).
  case "sections": {
    const u = findUser(selector);

    if (extra === undefined) {
      console.log(`#${u.id} ${u.name} ${u.surname} obsługuje: ${sectionsOf(u.id).join(", ") || "(brak)"}`);
      break;
    }

    if (u.role !== "manager") {
      die(`przypisania sekcji mają sens tylko dla roli 'manager' (ten użytkownik ma '${u.role}').`);
    }

    // "-" czyści przypisania; inaczej lista po przecinku.
    const wanted = extra === "-" ? [] : extra.split(",").map((s) => s.trim()).filter(Boolean);

    const known = db.prepare("SELECT DISTINCT section FROM Users ORDER BY section").all().map((r) => r.section);
    const unknown = wanted.filter((s) => !known.includes(s));
    if (unknown.length > 0) {
      // Sekcje to zwykły tekst w Users.section — literówka po cichu odcięłaby
      // kierownika od ludzi, więc lepiej się tu zatrzymać.
      die(`nieznane sekcje: ${unknown.join(", ")}. Istniejące: ${known.join(", ")}`);
    }

    const tx = db.transaction(() => {
      db.prepare("DELETE FROM ManagerSections WHERE managerID = ?").run(u.id);
      const ins = db.prepare("INSERT OR IGNORE INTO ManagerSections (managerID, section) VALUES (?, ?)");
      wanted.forEach((s) => ins.run(u.id, s));
    });
    tx();

    console.log("Zmieniono przypisania:");
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
        "  role       <email|id> <user|editor|manager>   zmień rolę",
        "  section    <email|id> <nazwaSekcji>   zmień sekcję użytkownika",
        "  sections   <email|id>                 pokaż sekcje obsługiwane przez kierownika",
        "  sections   <email|id> <a,b,c>         ustaw je ('-' czyści; kierownik bez sekcji nie widzi nikogo)",
        "  passwd     <email|id> <noweHaslo>     ustaw nowe hasło",
        "",
        `Baza: ${dbPath}`,
      ].join("\n")
    );
    if (cmd && cmd !== "help") process.exitCode = 1;
}

db.close();
