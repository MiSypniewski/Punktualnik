#!/usr/bin/env node
// Uruchamia wszystkie przykłady z instrukcji API (utils/apiExamples.cjs) na lokalnej
// kopii bazy, w kolejności ze strony. Numery projektu i wpisu są w przykładach umowne,
// więc podmieniamy je na prawdziwe. Sposób uruchomienia jak w scripts/apitest.js.

const { execFileSync } = require("child_process");
const crypto = require("crypto");
const Database = require("better-sqlite3");
const { apiExamples } = require("../utils/apiExamples.cjs");

const BASE = process.env.APITEST_URL || "http://localhost:3000";
const DB_PATH = process.env.APITEST_DB;

if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE) || !DB_PATH || DB_PATH.includes("/prod/")) {
  console.error("Odmowa: wymagany lokalny APITEST_URL i APITEST_DB wskazujący kopię bazy.");
  process.exit(2);
}

(async () => {
  const db = new Database(DB_PATH);
  const user = db.prepare("SELECT id, sessionVersion FROM Users WHERE email = 'jan@test.pl'").get();
  db.prepare("DELETE FROM TaskEntries WHERE userID = ?").run(user.id);

  const token = `pnk_${crypto.randomBytes(32).toString("base64url")}`;
  db.prepare(
    "INSERT INTO ApiKeys (userID, name, tokenHash, prefix, scopes, sessionVersion, createdAt, expiresAt) VALUES (?, 'instrukcja', ?, ?, 'read,timer,entries:write,entries:delete', ?, '2026-01-01 00:00:00', '2099-01-01 00:00:00')"
  ).run(user.id, crypto.createHash("sha256").update(token).digest("hex"), token.slice(0, 12), user.sessionVersion);

  const headers = { Authorization: `Bearer ${token}` };
  const project = (await (await fetch(`${BASE}/api/v1/projects`, { headers })).json()).projects[0];
  const today = (await (await fetch(`${BASE}/api/v1/entries`, { headers })).json()).from;

  const examples = Object.values(apiExamples({ baseUrl: BASE, today })).map((example) => example.command);

  let entryID = null;
  let failed = 0;
  for (const raw of examples) {
    if (raw.startsWith("export ")) continue;
    const command = raw
      .replace(/"projectID":3/g, `"projectID":${project.id}`)
      .replace(/\/entries\/123/g, `/entries/${entryID}`)
      .replace(/^curl /, `curl -s -w "\\n%{http_code}" `);

    const output = execFileSync("bash", ["-c", command], {
      env: { ...process.env, PUNKTUALNIK_KEY: token },
      encoding: "utf8",
    });
    const lines = output.trim().split("\n");
    const status = Number(lines.pop());
    const body = lines.join("\n");
    const ok = status >= 200 && status < 300;
    if (!ok) failed += 1;

    if (raw.includes("/entries") && raw.includes("-X POST")) entryID = JSON.parse(body).entry.id;
    console.log(`${ok ? "ok  " : "BŁĄD"} ${status}  ${raw.split("\n").pop().trim().replace(BASE, "").slice(0, 60)}  ${raw.split(" ").slice(1, 3).join(" ").slice(0, 12)}${ok ? "" : ` -> ${body}`}`);
  }

  console.log(`\nPrzykładów: ${examples.length}, błędów: ${failed}`);
  process.exit(failed ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(2);
});
