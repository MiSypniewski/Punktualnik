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
 *   node scripts/admin.js section    <email|id> <slugSekcji>
 *   node scripts/admin.js sections   <email|id> [sekcja1,sekcja2]
 *   node scripts/admin.js passwd     <email|id> <noweHaslo>
 *   node scripts/admin.js user-delete <email|id> [--force | --scal-z <email|id>]
 *   node scripts/admin.js section-list [--all]
 *   node scripts/admin.js section-add   <slug> [Etykieta]
 *   node scripts/admin.js section-label <slug> <Etykieta>
 *   node scripts/admin.js section-off / section-on <slug>
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

  CREATE TABLE IF NOT EXISTS Sections (
    slug     TEXT    PRIMARY KEY,
    label    TEXT    NOT NULL,
    isActive INTEGER NOT NULL DEFAULT 1
  );
`);

// Migracja sekcji sprzed tabeli Sections — lustrzana wobec services/db.js.
// Odpala się tylko przy pustej tabeli; sekcji nie kasujemy, więc pusto oznacza
// wyłącznie "jeszcze nie migrowano". Ten skrypt bywa uruchamiany na bazie,
// której aplikacja jeszcze nie otwierała, więc backfill musi być i tutaj.
if (db.prepare("SELECT COUNT(*) AS n FROM Sections").get().n === 0) {
  db.exec(`
    INSERT OR IGNORE INTO Sections (slug, label)
    SELECT slug, slug FROM (
      SELECT DISTINCT TRIM(section) AS slug FROM Users          WHERE TRIM(section) <> ''
      UNION
      SELECT DISTINCT TRIM(section) AS slug FROM ManagerSections WHERE TRIM(section) <> ''
    );
  `);
}

const ROLES = ["user", "editor", "manager"];

// Lustrzane wobec services/sections.js (ten skrypt jest CommonJS, nie zaimportuje ESM).
const SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;
const SLUG_MAX = 40;
const normalizeSlug = (value) => String(value ?? "").trim().toLowerCase();

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

const allSections = (activeOnly) =>
  db
    .prepare(
      `SELECT slug, label, isActive FROM Sections ${activeOnly ? "WHERE isActive = 1" : ""} ORDER BY label COLLATE NOCASE`
    )
    .all();

// COLLATE NOCASE: sekcje odziedziczone sprzed tabeli Sections zachowują oryginalną
// pisownię (np. 'Spedycja') i muszą taką zostać, żeby nie rozjechać się z danymi
// w Users/Times. Zwrócony slug jest zawsze tym zapisanym w bazie i to jego
// zapisujemy dalej. Lustrzane wobec services/sections.js.
const findSection = (slug) =>
  db.prepare("SELECT slug, label, isActive FROM Sections WHERE slug = ? COLLATE NOCASE").get(slug);

const printList = (rows) => {
  if (rows.length === 0) {
    console.log("(brak)");
    return;
  }
  rows.forEach((u) => console.log(fmt(u)));
  console.log(`\nRazem: ${rows.length}`);
};

// --- Kasowanie i scalanie kont ------------------------------------------
//
// Tabele z danymi NALEŻĄCYMI do konta. Kolejność jest kolejnością kasowania:
// dzieci przed rodzicem, bo wszystkie FK w tej bazie są bez ON DELETE (NO ACTION).
// Times jest ostatnie i jako jedyne nie ma FK w ogóle — kasujemy je jawnie, bo
// baza sama by o nim nie przypomniała.
const OWNED = [
  ["TaskEntries", "userID"],
  ["Absences", "userID"],
  ["LeaveAllowance", "userID"],
  ["Overtime", "userID"],
  ["ManagerSections", "managerID"],
  ["Times", "userID"],
];

// To samo przy scalaniu, ale bez Times (ma zdenormalizowane nazwisko, więc idzie
// osobnym UPDATE-em) i bez ManagerSections (klucz główny wymaga INSERT OR IGNORE).
const MOVE = [
  ["TaskEntries", "userID"],
  ["Absences", "userID"],
  ["LeaveAllowance", "userID"],
  ["Overtime", "userID"],
];

// Odwołania do konta w wierszach, które do NIEGO NIE należą: kto założył wniosek,
// kto go rozstrzygnął, kto poprawił kartę. Trzecia pozycja to kolumna właściciela
// wiersza — służy wyłącznie do liczenia, żeby raport nie wykazywał własnych wpisów
// konta drugi raz. Wszystkie te kolumny są nullable, więc da się je wyzerować.
const REFS = [
  ["Projects", "createdBy", null],
  ["Times", "editedBy", "userID"],
  ["TaskEntries", "editedBy", "userID"],
  ["Absences", "createdBy", "userID"],
  ["Absences", "decidedBy", "userID"],
  ["LeaveAllowance", "createdBy", "userID"],
  ["Overtime", "decidedBy", "userID"],
];

// Odmiana rzeczownika przez liczebnik: 1 wpis, 2 wpisy, 5 wpisów, 12 wpisów.
// Skrypt czyta kierownik, a nie programista — "1 wpisów" w komunikacie o kasowaniu
// danych wygląda na błąd skryptu, nie na drobiazg stylistyczny.
const odmien = (n, poj, mno, dop) => {
  const setki = n % 100;
  const dzies = n % 10;
  if (n === 1) return poj;
  if (dzies >= 2 && dzies <= 4 && (setki < 12 || setki > 14)) return mno;
  return dop;
};

// Ile w bazie jest wierszy wskazujących na nieistniejące konto. `foreign_key_check`
// nie obejmuje Times — ta tabela nigdy nie dostała klauzuli FOREIGN KEY — więc
// liczymy ją osobno.
const countOrphans = () => ({
  fk: db.pragma("foreign_key_check").length,
  times: db.prepare("SELECT COUNT(*) AS n FROM Times WHERE userID NOT IN (SELECT id FROM Users)").get().n,
});

// Baza mogła mieć sieroty już wcześniej — Times nigdy nie miało FK, a ten skrypt do
// dziś działał z foreign_keys=OFF — więc porównujemy stan przed i po zamiast żądać
// zera. Wyjątek rzucony stąd leci z wnętrza transakcji i cofa całą operację.
const assertIntact = (before) => {
  const now = countOrphans();
  const added = now.fk - before.fk + (now.times - before.times);
  if (added > 0) {
    throw new Error(`operacja zostawiłaby ${added} osieroconych wierszy — nic nie zapisano`);
  }
};

const argv = process.argv.slice(2);
const [cmd, selector, extra] = argv;
// Etykieta sekcji bywa wielowyrazowa, a bez cudzysłowów rozjedzie się na argumenty.
const tail = argv.slice(2).join(" ").trim();

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

  // --- Słownik sekcji (tabela Sections) ---------------------------------
  // Uwaga na nazewnictwo: `section` zmienia sekcję UŻYTKOWNIKA, `sections`
  // ustawia przypisania KIEROWNIKA, a `section-*` zarządza samym słownikiem.

  case "section-list": {
    const rows = allSections(selector !== "--all" ? true : false);
    if (rows.length === 0) {
      console.log("(brak sekcji — dodaj: section-add <slug> <Etykieta>)");
      break;
    }
    rows.forEach((s) => {
      const used = db.prepare("SELECT COUNT(*) AS n FROM Users WHERE section = ?").get(s.slug).n;
      console.log(
        `${s.slug.padEnd(20)} ${String(s.label).padEnd(24)} ${s.isActive ? "aktywna " : "WYŁĄCZONA"}  pracowników=${used}`
      );
    });
    console.log(`\nRazem: ${rows.length}${selector === "--all" ? "" : "  (z --all także wyłączone)"}`);
    break;
  }

  case "section-add": {
    const slug = normalizeSlug(selector);
    if (!slug) die("podaj slug sekcji, np. section-add magazyn Magazyn Centralny");
    if (!SLUG_PATTERN.test(slug) || slug.length > SLUG_MAX) {
      // Slug jest zarazem adresem strony kart (/time/<slug>) i wartością
      // w trzech kolumnach tekstowych — stąd wąski zestaw znaków.
      die(`slug może zawierać tylko małe litery, cyfry, '-' i '_' (max ${SLUG_MAX} znaków), np. 'magazyn_ch22'.`);
    }
    const clash = findSection(slug);
    if (clash) die(`sekcja '${clash.slug}' już istnieje (${clash.label}).`);

    const label = tail || slug;
    db.prepare("INSERT INTO Sections (slug, label, isActive) VALUES (?, ?, 1)").run(slug, label);
    console.log(`Dodano sekcję: ${slug} (${label})`);
    console.log("Możesz od razu przypisać kierownika: sections <email|id> " + slug);
    break;
  }

  case "section-label": {
    const slug = normalizeSlug(selector);
    const section = findSection(slug);
    if (!section) die(`nie znaleziono sekcji '${slug}'. Istniejące: ${allSections(false).map((s) => s.slug).join(", ")}`);
    if (!tail) die("podaj nową etykietę.");
    db.prepare("UPDATE Sections SET label = ? WHERE slug = ?").run(tail, section.slug);
    console.log(`Zmieniono etykietę: ${section.slug} — "${section.label}" → "${tail}"`);
    break;
  }

  case "section-off":
  case "section-on": {
    const slug = normalizeSlug(selector);
    const section = findSection(slug);
    if (!section) die(`nie znaleziono sekcji '${slug}'. Istniejące: ${allSections(false).map((s) => s.slug).join(", ")}`);

    const on = cmd === "section-on";
    db.prepare("UPDATE Sections SET isActive = ? WHERE slug = ?").run(on ? 1 : 0, section.slug);

    if (on) {
      console.log(`Włączono sekcję '${section.slug}' — jest znów do wyboru przy rejestracji.`);
    } else {
      // Świadomie NIE ruszamy Users/Times/ManagerSections: wyłączenie sekcji
      // to zdjęcie jej z formularza, a nie kasowanie ludzi ani historii.
      const used = db.prepare("SELECT COUNT(*) AS n FROM Users WHERE section = ?").get(section.slug).n;
      console.log(`Wyłączono sekcję '${section.slug}' — znika z rejestracji, dane i przypisania zostają.`);
      if (used > 0) console.log(`Uwaga: wciąż jest w niej ${used} pracownik(ów) — przenieś ich komendą 'section'.`);
    }
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
    const wanted = extra === "-" ? [] : extra.split(",").map(normalizeSlug).filter(Boolean);

    // Walidacja idzie po słowniku Sections, nie po tym, kto akurat gdzie siedzi
    // — dzięki temu można utworzyć pustą sekcję i z góry dać jej kierownika.
    // Wyłączone sekcje są tu dozwolone: kierownik musi widzieć ich historię.
    const known = allSections(false).map((s) => s.slug);
    const unknown = wanted.filter((s) => !findSection(s));
    if (unknown.length > 0) {
      die(
        `nieznane sekcje: ${unknown.join(", ")}. Istniejące: ${known.join(", ") || "(brak)"}. ` +
          `Nową dodasz komendą: section-add <slug> <Etykieta>`
      );
    }

    const tx = db.transaction(() => {
      db.prepare("DELETE FROM ManagerSections WHERE managerID = ?").run(u.id);
      const ins = db.prepare("INSERT OR IGNORE INTO ManagerSections (managerID, section) VALUES (?, ?)");
      // Zapisujemy slug w pisowni ze słownika — musi zgadzać się co do znaku
      // z Users.section, bo zasięg kierownika porównuje te wartości dosłownie.
      wanted.forEach((s) => ins.run(u.id, findSection(s).slug));
    });
    tx();

    console.log("Zmieniono przypisania:");
    console.log(fmt(findUser(String(u.id))));
    break;
  }

  case "section": {
    const u = findUser(selector);
    if (!extra || !extra.trim()) die("podaj slug sekcji.");

    // Wcześniej ta komenda przyjmowała dowolny tekst i literówka po cichu
    // tworzyła nową sekcję, wypychając pracownika poza widok kierownika.
    const slug = normalizeSlug(extra);
    const section = findSection(slug);
    if (!section) {
      const known = allSections(true).map((s) => s.slug);
      die(
        `nie znaleziono sekcji '${slug}'. Aktywne: ${known.join(", ") || "(brak)"}. ` +
          `Nową dodasz komendą: section-add ${slug} <Etykieta>`
      );
    }
    if (!section.isActive) die(`sekcja '${slug}' jest wyłączona — włącz ją komendą: section-on ${slug}`);

    // Zapis w pisowni ze słownika, nie w tej wpisanej w komendzie.
    db.prepare("UPDATE Users SET section = ? WHERE id = ?").run(section.slug, u.id);
    console.log("Zmieniono sekcję:");
    console.log(fmt(findUser(String(u.id))));
    break;
  }

  case "passwd": {
    const u = findUser(selector);
    if (!extra) die("podaj nowe hasło.");
    // Te same parametry co w services/password.js — inaczej logowanie nie zadziała.
    // Ten skrypt jest CommonJS-em odpalanym ręcznie, więc nie zaimportuje tamtego
    // modułu ESM i wariant `Sync` niczemu tu nie przeszkadza (żaden serwer nie czeka).
    // Przy zmianie parametrów po TAMTEJ stronie trzeba poprawić i tutaj.
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

  // --- Kasowanie konta ---------------------------------------------------
  //
  // Jedyna komenda w tym pliku, która USUWA dane, i jedyna, która włącza
  // `foreign_keys`. Reszcie admin.js domyślny OFF SQLite nie przeszkadza (same
  // UPDATE-y), ale tutaj bez tego `DELETE FROM Users` przechodzi gładko i po
  // cichu zostawia sieroty w sześciu tabelach — bez błędu, bez śladu.
  //
  // Bez flagi komenda niczego nie rusza, tylko liczy wiersze. `--force` jest więc
  // potwierdzeniem: nie ma pytania na stdin, bo to się odpala przez SSH.
  case "user-delete": {
    const u = findUser(selector);
    const flags = argv.slice(2);
    const force = flags.includes("--force");
    const mergeAt = flags.indexOf("--scal-z");
    const mergeSel = mergeAt === -1 ? null : flags[mergeAt + 1];

    if (mergeAt !== -1 && !mergeSel) die("--scal-z wymaga konta docelowego (e-mail lub id).");
    if (force && mergeSel) die("--force i --scal-z wykluczają się — wybierz jedno.");

    db.pragma("foreign_keys = ON");

    const owned = OWNED.map(([table, column]) => ({
      table,
      n: db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = ?`).get(u.id).n,
    }));
    const ownedTotal = owned.reduce((sum, r) => sum + r.n, 0);

    // Ślady liczymy z pominięciem wierszy SAMEGO konta (kierownik podpisuje też
    // własne korekty) — inaczej raport pokazywałby dwa razy to samo.
    const refs = REFS.map(([table, column, owner]) => ({
      label: `${table}.${column}`,
      n: db
        .prepare(
          `SELECT COUNT(*) AS n FROM ${table}
            WHERE ${column} = @id${owner ? ` AND ${owner} <> @id` : ""}`
        )
        .get({ id: u.id }).n,
    })).filter((r) => r.n > 0);

    console.log(fmt(u));
    console.log("\nWpisy należące do konta:");
    owned.forEach((r) => console.log(`  ${r.table.padEnd(16)} ${String(r.n).padStart(5)}`));
    if (refs.length > 0) {
      console.log("\nŚlady w CUDZYCH wpisach (podpisy pod korektą i decyzją):");
      refs.forEach((r) => console.log(`  ${r.label.padEnd(24)} ${String(r.n).padStart(5)}`));
    }

    if (!force && !mergeSel) {
      console.log(
        ownedTotal === 0
          ? "\nKonto nie ma własnych wpisów. Usuń je:  --force"
          : `\nKonto ma ${ownedTotal} ${odmien(ownedTotal, "wpis", "wpisy", "wpisów")}.` +
              " Skasuj konto razem z danymi:  --force" +
              "\nAlbo przepnij je na inne konto (scalenie duplikatu):  --scal-z <email|id>"
      );
      break;
    }

    // Konto docelowe i wszystkie przeszkody rozstrzygamy PRZED kopią bazy — inaczej
    // każda odrzucona próba scalenia zostawiałaby na dysku Mikrusa kolejny plik kopii.
    const target = mergeSel ? findUser(mergeSel) : null;

    if (target) {
      if (target.id === u.id) die("konto źródłowe i docelowe to ten sam użytkownik.");

      // idx_entries_running to UNIQUE indeks częściowy: jeden biegnący wpis na konto.
      // Gdy oba konta mają timer w biegu, UPDATE wywali się w środku transakcji —
      // lepiej powiedzieć to wprost, zanim cokolwiek ruszymy.
      const running = (id) =>
        db.prepare("SELECT COUNT(*) AS n FROM TaskEntries WHERE userID = ? AND endedAt IS NULL").get(id).n;
      if (running(u.id) > 0 && running(target.id) > 0) {
        die("oba konta mają biegnący wpis zadania — zamknij jeden z nich i powtórz.");
      }

      // LeaveAllowance nie ma UNIQUE na (userID, year), więc pule za ten sam rok
      // po prostu się zsumują. Bywa to poprawne (dwie decyzje kierownika), ale przy
      // duplikacie konta zwykle nie jest — stąd ostrzeżenie zamiast cichego scalenia.
      const clash = db
        .prepare(
          `SELECT year FROM LeaveAllowance
            WHERE userID = @source
              AND year IN (SELECT year FROM LeaveAllowance WHERE userID = @target)
            ORDER BY year`
        )
        .all({ source: u.id, target: target.id })
        .map((r) => r.year);
      if (clash.length > 0) {
        console.log(`\nUWAGA: pule urlopowe obu kont za ${clash.join(", ")} ZSUMUJĄ SIĘ.`);
      }
    }

    // VACUUM INTO, a nie kopia pliku: daje obraz spójny transakcyjnie także wtedy,
    // gdy aplikacja pisze w tle (WAL). db.backup() odpada — jest asynchroniczne,
    // a ten skrypt kończy się synchronicznym db.close().
    const backupPath = path.join(
      path.dirname(dbPath),
      `backup-przed-usunieciem-${u.id}-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite`
    );
    db.prepare("VACUUM INTO ?").run(backupPath);
    console.log(`\nKopia bazy przed operacją: ${backupPath}`);

    // Stan sprzed operacji — patrz assertIntact().
    const orphansBefore = countOrphans();

    if (target) {
      db.transaction(() => {
        // Imię i nazwisko w Times są zdenormalizowane (pozostałość po Airtable),
        // więc po przepięciu muszą mówić o koncie docelowym. Sekcja i lokalizacja
        // zostają HISTORYCZNE — Times świadomie trzyma stan z dnia odbicia.
        db.prepare(
          "UPDATE Times SET userID = @target, name = @name, surname = @surname WHERE userID = @source"
        ).run({ source: u.id, target: target.id, name: target.name, surname: target.surname });

        MOVE.forEach(([table, column]) => {
          db.prepare(`UPDATE ${table} SET ${column} = @target WHERE ${column} = @source`).run({
            source: u.id,
            target: target.id,
          });
        });

        // PK (managerID, section) nie zniesie przepięcia na konto, które tę samą
        // sekcję już obsługuje — stąd INSERT OR IGNORE zamiast UPDATE.
        db.prepare(
          `INSERT OR IGNORE INTO ManagerSections (managerID, section)
                SELECT @target, section FROM ManagerSections WHERE managerID = @source`
        ).run({ source: u.id, target: target.id });
        db.prepare("DELETE FROM ManagerSections WHERE managerID = ?").run(u.id);

        // Podpisy pod cudzymi wpisami wskazują na TĘ SAMĄ osobę, więc idą na konto
        // docelowe, a nie do NULL-a jak przy zwykłym kasowaniu.
        REFS.forEach(([table, column]) => {
          db.prepare(`UPDATE ${table} SET ${column} = @target WHERE ${column} = @source`).run({
            source: u.id,
            target: target.id,
          });
        });

        db.prepare("DELETE FROM Users WHERE id = ?").run(u.id);
        assertIntact(orphansBefore);
      })();

      console.log(
        `\nPrzepięto ${ownedTotal} ${odmien(ownedTotal, "wpis", "wpisy", "wpisów")} ` +
          `na konto #${target.id} i usunięto duplikat.`
      );
      console.log(fmt(findUser(String(target.id))));
      break;
    }

    const removed = db.transaction(() => {
      const counts = OWNED.map(([table, column]) => ({
        table,
        n: db.prepare(`DELETE FROM ${table} WHERE ${column} = ?`).run(u.id).changes,
      }));

      // Wiersze własne już nie istnieją, więc zerujemy wyłącznie CUDZE podpisy.
      // Kolumny *ByName zostają: bez nich z audytu zniknęłoby nazwisko osoby, która
      // zatwierdziła cudzy wniosek, a to nie to samo co usunięcie jej konta.
      REFS.forEach(([table, column]) => {
        db.prepare(`UPDATE ${table} SET ${column} = NULL WHERE ${column} = ?`).run(u.id);
      });

      db.prepare("DELETE FROM Users WHERE id = ?").run(u.id);
      assertIntact(orphansBefore);
      return counts;
    })();

    console.log("\nUsunięto konto i jego wpisy:");
    removed.filter((r) => r.n > 0).forEach((r) => console.log(`  ${r.table.padEnd(16)} -${r.n}`));
    const total = removed.reduce((sum, r) => sum + r.n, 0);
    console.log(`Razem: ${total} ${odmien(total, "wiersz", "wiersze", "wierszy")}.`);
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
        "  section    <email|id> <slug>          zmień sekcję użytkownika",
        "  sections   <email|id>                 pokaż sekcje obsługiwane przez kierownika",
        "  sections   <email|id> <a,b,c>         ustaw je ('-' czyści; kierownik bez sekcji nie widzi nikogo)",
        "  passwd     <email|id> <noweHaslo>     ustaw nowe hasło",
        "",
        "Usuwanie konta (jedyna komenda, która kasuje dane):",
        "  user-delete <email|id>                policz wpisy konta i nic nie rób",
        "  user-delete <email|id> --force        usuń konto RAZEM ze wszystkimi jego wpisami",
        "  user-delete <email|id> --scal-z <email|id>",
        "                                        przepnij wpisy na inne konto i usuń duplikat",
        "  (przed zapisem powstaje kopia bazy w katalogu data/)",
        "",
        "Słownik sekcji (działów):",
        "  section-list [--all]                  wypisz sekcje (--all także wyłączone)",
        "  section-add   <slug> [Etykieta]       dodaj sekcję (slug: małe litery, cyfry, '-', '_')",
        "  section-label <slug> <Etykieta>       zmień nazwę wyświetlaną (slug jest niezmienny)",
        "  section-off   <slug>                  zdejmij z formularza rejestracji (dane zostają)",
        "  section-on    <slug>                  przywróć do wyboru",
        "",
        `Baza: ${dbPath}`,
      ].join("\n")
    );
    if (cmd && cmd !== "help") process.exitCode = 1;
}

db.close();
