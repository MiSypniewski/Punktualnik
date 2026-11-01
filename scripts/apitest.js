#!/usr/bin/env node
// Test API kluczy na ŻYWEJ aplikacji i KOPII bazy. Bez zależności poza better-sqlite3.
//
// Skrypt pisze do bazy i kasuje wpisy kont testowych, więc odmawia pracy, jeśli adres
// nie jest lokalny. Aplikację trzeba uruchomić na tej samej kopii, z wyłączoną pocztą:
//
//   cp data/punktualnik.sqlite /tmp/apitest.sqlite
//   SQLITE_PATH=/tmp/apitest.sqlite TZ=UTC email_login= email_password= GCHAT_WEBHOOK_URL= npm run dev
//   APITEST_DB=/tmp/apitest.sqlite node scripts/apitest.js
//
// Konta jan@, anna@, michal@, ewa@ i kiosk@test.pl muszą mieć hasło z APITEST_PASSWORD
// (domyślnie Test1234!x). Licznik limitów żyje w procesie, więc każdy przebieg wymaga
// restartu aplikacji.

const { execFileSync } = require("child_process");
const Database = require("better-sqlite3");

const BASE = process.env.APITEST_URL || "http://localhost:3000";
const DB_PATH = process.env.APITEST_DB;
const PASSWORD = process.env.APITEST_PASSWORD || "Test1234!x";

if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE) || !DB_PATH || DB_PATH.includes("/prod/")) {
  console.error("Odmowa: wymagany lokalny APITEST_URL i APITEST_DB wskazujący kopię bazy.");
  process.exit(2);
}

const db = new Database(DB_PATH);
const results = { ok: 0, failed: [] };

const check = (name, condition, detail) => {
  if (condition) {
    results.ok += 1;
    console.log(`  ok    ${name}`);
  } else {
    results.failed.push(name);
    console.log(`  BŁĄD  ${name}${detail === undefined ? "" : ` -> ${JSON.stringify(detail)}`}`);
  }
};

const call = async (method, path, { key, cookie, body, headers = {}, raw } = {}) => {
  const response = await fetch(`${BASE}${path}`, {
    method,
    redirect: "manual",
    headers: {
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: response.status, json, text, headers: response.headers };
};

const expectStatus = async (name, want, method, path, options) => {
  const res = await call(method, path, options);
  check(`${name} (${want})`, res.status === want, { got: res.status, body: res.json ?? res.text.slice(0, 120) });
  return res;
};

const login = async (email) => {
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
  const { csrfToken } = await csrfRes.json();
  const csrfCookie = csrfRes.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");

  const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: csrfCookie },
    body: new URLSearchParams({ csrfToken, email, password: PASSWORD, json: "true" }),
  });
  const cookies = res.headers.getSetCookie().map((c) => c.split(";")[0]);
  const session = cookies.find((c) => c.includes("session-token="));
  if (!session) throw new Error(`Logowanie ${email} nieudane. Sprawdź hasło konta.`);
  return `${csrfCookie}; ${session}`;
};

const ALL = ["read", "timer", "entries:write", "entries:delete"];

const newKey = async (cookie, name, scopes = ALL) => {
  const res = await call("POST", "/api/keys", { cookie, body: { name, scopes, days: 30, password: PASSWORD } });
  if (res.status !== 201) throw new Error(`Klucz ${name}: ${res.status} ${res.text}`);
  return { token: res.json.token, id: res.json.key.id };
};

const admin = (...args) =>
  execFileSync("node", ["scripts/admin.js", ...args], {
    env: { ...process.env, SQLITE_PATH: DB_PATH },
    encoding: "utf8",
  });

const userId = (email) => db.prepare("SELECT id FROM Users WHERE email = ?").get(email).id;

(async () => {
  const jan = await login("jan@test.pl");
  const anna = await login("anna@test.pl");
  const michal = await login("michal@test.pl");
  const ewa = await login("ewa@test.pl");
  const kiosk = await login("kiosk@test.pl");

  const janID = userId("jan@test.pl");
  const annaID = userId("anna@test.pl");
  const michalID = userId("michal@test.pl");
  db.prepare("DELETE FROM TaskEntries WHERE userID IN (?, ?, ?)").run(janID, annaID, michalID);
  db.prepare("DELETE FROM ApiKeys").run();

  console.log("\nTworzenie kluczy");
  await expectStatus("kiosk nie tworzy klucza", 403, "POST", "/api/keys", {
    cookie: kiosk,
    body: { name: "k", scopes: ["read"], password: PASSWORD },
  });
  await expectStatus("bez sesji", 401, "GET", "/api/keys");
  await expectStatus("złe hasło", 403, "POST", "/api/keys", {
    cookie: jan,
    body: { name: "x", scopes: ["read"], password: "zle-haslo-123" },
  });
  await expectStatus("nieznane uprawnienie", 422, "POST", "/api/keys", {
    cookie: jan,
    body: { name: "x", scopes: ["admin"], password: PASSWORD },
  });
  await expectStatus("ważność spoza listy", 422, "POST", "/api/keys", {
    cookie: jan,
    body: { name: "x", scopes: ["read"], days: 9999, password: PASSWORD },
  });

  const janKey = await newKey(jan, "jan-all");
  check("klucz ma format pnk_", /^pnk_[\w-]{43}$/.test(janKey.token));
  const row = db.prepare("SELECT * FROM ApiKeys WHERE id = ?").get(janKey.id);
  check("w bazie nie ma klucza jawnie", !JSON.stringify(row).includes(janKey.token));

  const list = await call("GET", "/api/keys", { cookie: jan });
  check("lista bez skrótu i klucza", !list.text.includes("tokenHash") && !list.text.includes(janKey.token));

  const fill = [];
  for (let i = 0; i < 4; i += 1) fill.push(await newKey(jan, `fill-${i}`, ["read"]));
  await expectStatus("szósty aktywny klucz", 422, "POST", "/api/keys", {
    cookie: jan,
    body: { name: "za-duzo", scopes: ["read"], password: PASSWORD },
  });
  for (const k of fill) await call("DELETE", `/api/keys/${k.id}`, { cookie: jan });

  console.log("\nIzolacja");
  await expectStatus("bez nagłówka", 401, "GET", "/api/v1/me");
  await expectStatus("zły format", 401, "GET", "/api/v1/me", { key: "pnk_krotki" });
  await expectStatus("nieznany klucz", 401, "GET", "/api/v1/me", { key: `pnk_${"a".repeat(43)}` });
  await expectStatus("klucz w adresie nie działa", 401, "GET", `/api/v1/me?api_key=${janKey.token}&token=${janKey.token}`);
  await expectStatus("sama sesja na v1", 401, "GET", "/api/v1/me", { cookie: jan });
  await expectStatus("klucz działa", 200, "GET", "/api/v1/me", { key: janKey.token });

  for (const path of ["/api/entries/timer", "/api/entries/running", "/api/time/board", "/api/absences", "/api/overtime", "/api/report/zadania", "/api/health", "/api/keys", "/api/projects", "/api/pending"]) {
    await expectStatus(`klucz na starej trasie ${path}`, 401, "GET", path, { key: janKey.token });
  }
  await expectStatus("klucz nie tworzy klucza", 401, "POST", "/api/keys", {
    key: janKey.token,
    body: { name: "z", scopes: ["read"], password: PASSWORD },
  });
  await expectStatus("klucz nie odwołuje klucza", 401, "DELETE", `/api/keys/${janKey.id}`, { key: janKey.token });
  await expectStatus("klucz nie zmienia hasła", 401, "PUT", "/api/users", {
    key: janKey.token,
    body: { oldPassword: PASSWORD, newPassword: "NoweHaslo123!" },
  });

  const cors = await call("GET", "/api/v1/me", { key: janKey.token, headers: { Origin: "https://evil.example" } });
  check("brak CORS", !cors.headers.get("access-control-allow-origin"));
  check("no-store", cors.headers.get("cache-control") === "no-store");

  console.log("\nUprawnienia");
  const readOnly = await newKey(jan, "tylko-odczyt", ["read"]);
  const timerOnly = await newKey(jan, "tylko-timer", ["timer"]);
  await expectStatus("odczyt nie startuje timera", 403, "POST", "/api/v1/timer/start", { key: readOnly.token, body: {} });
  await expectStatus("odczyt nie zatrzymuje", 403, "POST", "/api/v1/timer/stop", { key: readOnly.token, body: {} });
  await expectStatus("odczyt nie zmienia timera", 403, "PATCH", "/api/v1/timer", { key: readOnly.token, body: { description: "x" } });
  await expectStatus("odczyt nie dopisuje", 403, "POST", "/api/v1/entries", { key: readOnly.token, body: {} });
  await expectStatus("timer nie czyta wpisów", 403, "GET", "/api/v1/entries", { key: timerOnly.token });
  await expectStatus("timer nie czyta projektów", 403, "GET", "/api/v1/projects", { key: timerOnly.token });
  await expectStatus("timer nie dopisuje", 403, "POST", "/api/v1/entries", { key: timerOnly.token, body: {} });
  await expectStatus("timer nie kasuje", 403, "DELETE", "/api/v1/entries/1", { key: timerOnly.token });
  await expectStatus("zła metoda", 405, "DELETE", "/api/v1/timer", { key: janKey.token });

  console.log("\nTimer");
  const projects = (await call("GET", "/api/v1/projects", { key: janKey.token })).json.projects;
  check("są projekty", projects.length > 0);
  check("bez projektu systemowego", !projects.some((p) => p.name === "do usunięcia"));
  const project = projects[0];

  const systemProject = db.prepare("SELECT id FROM Projects WHERE isSystem = 1").get();
  const outside = db
    .prepare("INSERT INTO Projects (name, client, color, isActive, createdAt, createdBy) VALUES (?, '', 'indigo', 1, datetime('now'), ?)")
    .run(`Poza zasięgiem ${Date.now()}`, michalID).lastInsertRowid;
  db.prepare("INSERT INTO ProjectSections (projectID, section) VALUES (?, 'nieistniejaca-sekcja')").run(outside);

  await expectStatus("stop bez timera", 409, "POST", "/api/v1/timer/stop", { key: janKey.token, body: {} });
  await expectStatus("zmiana bez timera", 409, "PATCH", "/api/v1/timer", { key: janKey.token, body: { description: "x" } });
  await expectStatus("start na projekcie systemowym", 403, "POST", "/api/v1/timer/start", { key: janKey.token, body: { projectID: systemProject.id } });
  await expectStatus("start poza sekcją", 403, "POST", "/api/v1/timer/start", { key: janKey.token, body: { projectID: outside } });
  await expectStatus("start na nieistniejącym", 404, "POST", "/api/v1/timer/start", { key: janKey.token, body: { projectID: 999999 } });
  await expectStatus("body tekstowe", 415, "POST", "/api/v1/timer/start", { key: janKey.token, raw: "projectID=1", headers: { "Content-Type": "text/plain" } });
  await expectStatus("za duże body", 413, "POST", "/api/v1/timer/start", { key: janKey.token, body: { description: "x".repeat(20000) } });

  const started = await expectStatus("start", 201, "POST", "/api/v1/timer/start", {
    key: janKey.token,
    body: { projectID: project.id, description: "pierwszy opis" },
  });
  const today = started.json.entry.data;
  const runningID = started.json.entry.id;
  check("odpowiedź nie zdradza origin i apiKeyID", !("origin" in started.json.entry) && !("apiKeyID" in started.json.entry));
  check("wpis ma apiKeyID w bazie", db.prepare("SELECT apiKeyID FROM TaskEntries WHERE id = ?").get(runningID).apiKeyID === janKey.id);

  await expectStatus("drugi start", 409, "POST", "/api/v1/timer/start", { key: janKey.token, body: {} });

  const patched = await expectStatus("zmiana samego projektu", 200, "PATCH", "/api/v1/timer", {
    key: janKey.token,
    body: { projectID: project.id },
  });
  check("opis zostaje po zmianie projektu", patched.json.running.description === "pierwszy opis", patched.json);

  const patched2 = await expectStatus("zmiana samego opisu", 200, "PATCH", "/api/v1/timer", {
    key: janKey.token,
    body: { description: "drugi opis" },
  });
  check("projekt zostaje po zmianie opisu", patched2.json.running.projectID === project.id, patched2.json);

  await expectStatus("zbyt długi opis", 422, "PATCH", "/api/v1/timer", { key: janKey.token, body: { description: "x".repeat(201) } });
  await expectStatus("pusta zmiana", 400, "PATCH", "/api/v1/timer", { key: janKey.token, body: {} });
  await expectStatus("PUT na biegnącym", 409, "PUT", `/api/v1/entries/${runningID}`, {
    key: janKey.token,
    body: { projectID: project.id, description: "x", data: today, from: "08:00", to: "09:00" },
  });
  check("PUT nie zamknął timera", db.prepare("SELECT endedAt FROM TaskEntries WHERE id = ?").get(runningID).endedAt === null);

  const timerNow = await call("GET", "/api/v1/timer", { key: janKey.token });
  check("odczyt timera", timerNow.json.running?.id === runningID && timerNow.json.running.elapsedSec >= 0, timerNow.json);

  const stopped = await expectStatus("stop", 200, "POST", "/api/v1/timer/stop", { key: janKey.token, body: {} });
  check("wpis zamknięty", stopped.json.entry.running === false);
  const cat = db.prepare("SELECT origin, timeEdited FROM TaskEntries WHERE id = ?").get(runningID);
  check("start i stop z API zostają origin=timer", cat.origin === "timer" && cat.timeEdited === 0, cat);

  db.prepare("DELETE FROM TaskEntries WHERE id = ?").run(runningID);
  await call("POST", "/api/v1/timer/start", { key: janKey.token, body: {} });
  await expectStatus("stop pustego timera", 422, "POST", "/api/v1/timer/stop", { key: janKey.token, body: {} });
  db.prepare("DELETE FROM TaskEntries WHERE userID = ?").run(janID);

  console.log("\nWpisy");
  const entryBody = { projectID: project.id, description: "wpis ręczny", data: today, from: "04:00", to: "04:30" };
  const manual = await expectStatus("wpis ręczny", 201, "POST", "/api/v1/entries", { key: janKey.token, body: entryBody });
  const manualID = manual.json.entry.id;
  check("ręczny z API to origin=manual", db.prepare("SELECT origin FROM TaskEntries WHERE id = ?").get(manualID).origin === "manual");
  await expectStatus("nakładający się wpis", 409, "POST", "/api/v1/entries", { key: janKey.token, body: entryBody });
  await expectStatus("wpis bez opisu", 422, "POST", "/api/v1/entries", { key: janKey.token, body: { ...entryBody, description: "" } });
  await expectStatus("wpis w przyszłości", 422, "POST", "/api/v1/entries", { key: janKey.token, body: { ...entryBody, data: "2999-01-01" } });
  await expectStatus("wpis sprzed okna", 409, "POST", "/api/v1/entries", { key: janKey.token, body: { ...entryBody, data: "2020-01-01" } });
  await expectStatus("wpis poza sekcją", 403, "POST", "/api/v1/entries", { key: janKey.token, body: { ...entryBody, projectID: outside } });
  await expectStatus("wpis bez projektu", 400, "POST", "/api/v1/entries", { key: janKey.token, body: { ...entryBody, projectID: undefined } });
  await expectStatus("poprawa wpisu", 200, "PUT", `/api/v1/entries/${manualID}`, { key: janKey.token, body: { ...entryBody, description: "poprawiony" } });
  await expectStatus("odczyt wpisu", 200, "GET", `/api/v1/entries/${manualID}`, { key: janKey.token });

  const range = await call("GET", `/api/v1/entries?from=${today}&to=${today}`, { key: janKey.token });
  check("lista wpisów", range.status === 200 && range.json.entries.some((e) => e.id === manualID), range.json);
  await expectStatus("za długi zakres", 400, "GET", "/api/v1/entries?from=2026-01-01&to=2026-03-01", { key: janKey.token });
  await expectStatus("zła data", 400, "GET", "/api/v1/entries?from=abc", { key: janKey.token });
  await expectStatus("zły identyfikator", 404, "GET", "/api/v1/entries/abc", { key: janKey.token });

  console.log("\nCudze wpisy i kierownik");
  const annaKey = await newKey(anna, "anna-all");
  await expectStatus("cudzy odczyt", 404, "GET", `/api/v1/entries/${manualID}`, { key: annaKey.token });
  await expectStatus("cudza poprawa", 404, "PUT", `/api/v1/entries/${manualID}`, { key: annaKey.token, body: entryBody });
  await expectStatus("cudze kasowanie", 404, "DELETE", `/api/v1/entries/${manualID}`, { key: annaKey.token });
  await expectStatus("nieistniejący wpis", 404, "GET", "/api/v1/entries/99999999", { key: annaKey.token });
  await expectStatus("cudzy klucz nie do odwołania", 404, "DELETE", `/api/keys/${janKey.id}`, { cookie: anna });

  const michalKey = await newKey(michal, "kierownik");
  await expectStatus("kierownik: cudzy odczyt", 404, "GET", `/api/v1/entries/${manualID}`, { key: michalKey.token });
  await expectStatus("kierownik: cudza poprawa", 404, "PUT", `/api/v1/entries/${manualID}`, { key: michalKey.token, body: entryBody });
  await expectStatus("kierownik: cudze kasowanie", 404, "DELETE", `/api/v1/entries/${manualID}`, { key: michalKey.token });

  const before = await expectStatus("kierownik: targetUserID jest ignorowane", 201, "POST", "/api/v1/entries", {
    key: michalKey.token,
    body: { ...entryBody, targetUserID: janID },
  });
  check("wpis ląduje na kierowniku", db.prepare("SELECT userID FROM TaskEntries WHERE id = ?").get(before.json.entry.id).userID === michalID);

  await expectStatus("kierownik: własny wpis sprzed okna", 409, "POST", "/api/v1/entries", { key: michalKey.token, body: { ...entryBody, data: "2020-01-01" } });
  const old = db
    .prepare(
      `INSERT INTO TaskEntries (userID, projectID, description, data, startedAt, endedAt, seconds, section, createdAt, origin)
       VALUES (?, ?, 'stary', '2020-01-02', '2020-01-02 08:00:00', '2020-01-02 09:00:00', 3600, 'spedycja', '2020-01-02 09:00:00', 'timer')`
    )
    .run(michalID, project.id).lastInsertRowid;
  await expectStatus("kierownik: poprawa starego własnego", 409, "PUT", `/api/v1/entries/${old}`, { key: michalKey.token, body: { ...entryBody, data: "2020-01-02" } });
  await expectStatus("kierownik: kasowanie starego własnego", 409, "DELETE", `/api/v1/entries/${old}`, { key: michalKey.token });

  await expectStatus("kasowanie własnego", 200, "DELETE", `/api/v1/entries/${manualID}`, { key: janKey.token });
  await expectStatus("po skasowaniu", 404, "GET", `/api/v1/entries/${manualID}`, { key: janKey.token });

  console.log("\nPanel bez zmian");
  const panelStart = await expectStatus("start z panelu", 201, "POST", "/api/entries", {
    cookie: jan,
    body: { action: "start", projectID: project.id, description: "z panelu" },
  });
  check("wpis z panelu nie ma apiKeyID", db.prepare("SELECT apiKeyID FROM TaskEntries WHERE id = ?").get(panelStart.json.entry.id).apiKeyID === null);
  await expectStatus("stop z panelu", 200, "PUT", `/api/entries/${panelStart.json.entry.id}`, { cookie: jan, body: { action: "stop" } });
  const panelManual = await expectStatus("wpis ręczny z panelu", 201, "POST", "/api/entries", {
    cookie: jan,
    body: { action: "manual", projectID: project.id, description: "ręczny z panelu", data: today, from: "03:10", to: "03:20" },
  });
  check("ręczny z panelu nie ma apiKeyID", db.prepare("SELECT apiKeyID, origin FROM TaskEntries WHERE id = ?").get(panelManual.json.entry.id).apiKeyID === null);
  await expectStatus("panel kasuje wpis", 200, "DELETE", `/api/entries/${panelManual.json.entry.id}`, { cookie: jan, raw: "{}", headers: { "Content-Type": "application/json" } });

  console.log("\nZnacznik u kierownika");
  const viaApi = await call("POST", "/api/v1/entries", { key: annaKey.token, body: { ...entryBody, description: "znacznik", from: "05:00", to: "05:30" } });
  const report = await call("GET", `/api/report/zadania?from=${today}&to=${today}&tryb=wpisy&format=csv`, { cookie: michal });
  check("eksport odpowiada", report.status === 200, { status: report.status, head: report.text.slice(0, 120) });
  check("eksport ma kolumnę Przez API", report.text.includes("Przez API"), report.text.slice(0, 200));
  const apiRow = report.text.split("\n").find((line) => line.includes("znacznik"));
  check("wiersz z API oznaczony", Boolean(apiRow) && /[;,]tak[;,]/.test(apiRow.replace(/"/g, "")), apiRow);
  check("pracownik nie widzi znacznika", !(await call("GET", `/api/v1/entries/${viaApi.json.entry.id}`, { key: annaKey.token })).text.includes("viaApi"));

  console.log("\nUnieważnianie");
  const check401 = async (name, key) => expectStatus(name, 401, "GET", "/api/v1/me", { key });

  await expectStatus("przed odwołaniem", 200, "GET", "/api/v1/me", { key: readOnly.token });
  await expectStatus("odwołanie", 200, "DELETE", `/api/keys/${readOnly.id}`, { cookie: jan });
  await check401("po odwołaniu", readOnly.token);

  db.prepare("UPDATE ApiKeys SET expiresAt = '2020-01-01 00:00:00' WHERE id = ?").run(timerOnly.id);
  await check401("po wygaśnięciu", timerOnly.token);

  const annaSecond = await newKey(anna, "do-logout", ["read"]);
  await expectStatus("działa przed logout", 200, "GET", "/api/v1/me", { key: annaSecond.token });
  admin("logout", "anna@test.pl");
  await check401("po admin logout", annaSecond.token);
  await check401("drugi klucz też po logout", annaKey.token);
  const anna2 = await login("anna@test.pl");

  const annaThird = await newKey(anna2, "do-passwd", ["read"]);
  admin("passwd", "anna@test.pl", PASSWORD);
  await check401("po admin passwd", annaThird.token);
  const anna3 = await login("anna@test.pl");

  const annaFourth = await newKey(anna3, "do-zmiany-hasla", ["read"]);
  const changed = await call("PUT", "/api/users", { cookie: anna3, body: { oldPassword: PASSWORD, newPassword: PASSWORD } });
  check("zmiana hasła w aplikacji", changed.status === 200, changed.json);
  await check401("po zmianie hasła w aplikacji", annaFourth.token);
  const anna4 = await login("anna@test.pl");

  const annaFifth = await newKey(anna4, "do-deactivate", ["read"]);
  admin("deactivate", "anna@test.pl");
  await check401("po deactivate", annaFifth.token);
  admin("activate", "anna@test.pl");
  await check401("po reaktywacji nie wraca", annaFifth.token);
  const anna5 = await login("anna@test.pl");

  const annaSixth = await newKey(anna5, "do-roli", ["read"]);
  admin("role", "anna@test.pl", "editor");
  await check401("po zmianie roli na kiosk", annaSixth.token);
  admin("role", "anna@test.pl", "user");
  await expectStatus("po powrocie roli działa", 200, "GET", "/api/v1/me", { key: annaSixth.token });

  console.log("\nAdministracja");
  const listed = admin("api-keys", "jan@test.pl");
  check("api-keys wypisuje klucze bez sekretu", listed.includes("jan-all") && !listed.includes(janKey.token));
  admin("api-key-revoke", String(annaSixth.id));
  await check401("po api-key-revoke", annaSixth.token);

  console.log("\nStabilność");
  const ewaKey = await newKey(ewa, "limity", ["read", "timer"]);
  await call("GET", "/api/v1/me", { key: ewaKey.token });
  db.prepare("UPDATE ApiKeys SET lastUsedAt = NULL WHERE id = ?").run(ewaKey.id);
  for (let i = 0; i < 5; i += 1) await call("GET", "/api/v1/me", { key: ewaKey.token });
  check("lastUsedAt dławione", db.prepare("SELECT lastUsedAt FROM ApiKeys WHERE id = ?").get(ewaKey.id).lastUsedAt === null);

  let limited = null;
  for (let i = 0; i < 130 && !limited; i += 1) {
    const res = await call("GET", "/api/v1/me", { key: ewaKey.token });
    if (res.status === 429) limited = res;
  }
  check("limit odczytów daje 429", Boolean(limited));
  check("429 ma Retry-After", Boolean(limited?.headers.get("retry-after")));
  await expectStatus("limit dotyczy użytkownika, inny działa", 200, "GET", "/api/v1/me", { key: michalKey.token });

  let writesLimited = false;
  for (let i = 0; i < 35 && !writesLimited; i += 1) {
    const res = await call("PATCH", "/api/v1/timer", { key: ewaKey.token, body: { description: "x" } });
    if (res.status === 429) writesLimited = true;
  }
  check("limit zapisów daje 429", writesLimited);

  const ipHeaders = { "x-forwarded-for": "198.51.100.7" };
  let blocked = false;
  for (let i = 0; i < 65 && !blocked; i += 1) {
    const res = await call("GET", "/api/v1/me", { key: `pnk_${"b".repeat(43)}`, headers: ipHeaders });
    if (res.status === 429) blocked = true;
  }
  check("seria nieudanych prób daje 429", blocked);
  await expectStatus("poprawny klucz z tego adresu przechodzi", 200, "GET", "/api/v1/me", { key: michalKey.token, headers: ipHeaders });

  const wrong = [];
  for (let i = 0; i < 6; i += 1) {
    wrong.push((await call("POST", "/api/keys", { cookie: michal, body: { name: "x", scopes: ["read"], password: "zle-haslo-123" } })).status);
  }
  check("złe hasło blokuje po 5 próbach", wrong.slice(0, 5).every((s) => s === 403) && wrong[5] === 429, wrong);

  console.log("\nKasowanie konta z kluczami");
  const seedUser = (email) => {
    const id = db
      .prepare("INSERT INTO Users (email, name, surname, section, location, role, isActive, passwordHash, passwordSalt) VALUES (?, 'T', 'T', 'spedycja', 'x', 'user', 1, 'x', 'x')")
      .run(email).lastInsertRowid;
    db.prepare("INSERT INTO ApiKeys (userID, name, tokenHash, prefix, scopes, sessionVersion, createdAt, expiresAt) VALUES (?, 'x', ?, 'pnk_x', 'read', 0, '2026-01-01', '2030-01-01')").run(id, `hash-${email}`);
    return id;
  };

  const tmp = `apitest-${Date.now()}@test.pl`;
  const tmpID = seedUser(tmp);
  const del = admin("user-delete", tmp, "--force");
  check("user-delete radzi sobie z kluczami", !db.prepare("SELECT 1 FROM Users WHERE id = ?").get(tmpID) && !db.prepare("SELECT 1 FROM ApiKeys WHERE userID = ?").get(tmpID), del);

  const dup = `apitest-dup-${Date.now()}@test.pl`;
  const dupID = seedUser(dup);
  const merged = admin("user-delete", dup, "--scal-z", "ewa@test.pl");
  check(
    "scalenie kasuje klucze duplikatu i ich nie przenosi",
    !db.prepare("SELECT 1 FROM Users WHERE id = ?").get(dupID) &&
      !db.prepare("SELECT 1 FROM ApiKeys WHERE tokenHash = ?").get(`hash-${dup}`),
    merged
  );

  console.log(`\nWynik: ${results.ok} ok, ${results.failed.length} błędów`);
  if (results.failed.length) console.log(results.failed.map((f) => `  - ${f}`).join("\n"));
  process.exit(results.failed.length ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(2);
});
