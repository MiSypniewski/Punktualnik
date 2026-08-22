#!/usr/bin/env node
/* eslint-disable no-console */

// Test obciążeniowy: N równoległych "przeglądarek" bijących w uruchomioną aplikację.
//
// Powstał po awarii z 21.08.2026, żeby twierdzenie "teraz jest szybciej" dało się
// sprawdzić liczbą, a nie wrażeniem. Mierzy p50/p95/max czasu odpowiedzi — przy
// jednym procesie Node z synchroniczną bazą liczy się WŁAŚNIE ogon rozkładu:
// średnia potrafi wyglądać znakomicie, podczas gdy co dziesiąty użytkownik czeka
// kilka sekund.
//
// Zero zależności, wbudowany fetch (Node 18+).
//
// Użycie:
//   node scripts/loadtest.js --url http://localhost:3000 --users 12 --rounds 5
//
// Bez ciasteczka sesji trafi w przekierowania i 401 — i to też jest sensowny test
// (mierzy koszt getToken i SSR do momentu odmowy). Żeby zmierzyć realne strony,
// podaj ciastko zalogowanej sesji:
//   node scripts/loadtest.js --cookie "next-auth.session-token=..."
// (skopiuj je z DevTools → Application → Cookies).

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const BASE = String(arg("url", "http://localhost:3000")).replace(/\/$/, "");
const USERS = Number(arg("users", 12));
const ROUNDS = Number(arg("rounds", 5));
const COOKIE = arg("cookie", "");

// Ścieżki dobrane tak, żeby odwzorować realny ruch: najcięższy SSR panelu
// kierownika, strona pracownika i dwa endpointy odpytywane cyklicznie przez
// każdą otwartą kartę.
const PATHS = ["/zadania/zarzadzaj", "/zadania", "/api/entries/timer", "/api/entries/running"];

const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length * p) / 100))];

const stats = new Map(PATHS.map((p) => [p, []]));
const statuses = new Map();

const hit = async (path) => {
  const started = process.hrtime.bigint();
  let status = 0;
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: COOKIE ? { cookie: COOKIE } : {},
      redirect: "manual",
    });
    status = res.status;
    // Odpowiedź trzeba wyczytać do końca, inaczej mierzymy sam nagłówek.
    await res.arrayBuffer();
  } catch (err) {
    status = `ERR:${err.code || err.message}`;
  }
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  stats.get(path).push(ms);
  statuses.set(`${path} ${status}`, (statuses.get(`${path} ${status}`) ?? 0) + 1);
};

// Jeden "użytkownik" chodzi po stronach po kolei, tak jak człowiek — nie zalewa
// serwera równolegle sam z siebie. Równoległość bierze się z liczby użytkowników.
const user = async () => {
  for (let round = 0; round < ROUNDS; round++) {
    for (const path of PATHS) {
      await hit(path);
    }
  }
};

const main = async () => {
  console.log(`Cel: ${BASE}`);
  console.log(`Równoległych użytkowników: ${USERS}, rund na użytkownika: ${ROUNDS}`);
  console.log(COOKIE ? "Sesja: podana (mierzone realne strony)" : "Sesja: BRAK (mierzone 401/redirect)");
  console.log("");

  const startedAt = Date.now();
  await Promise.all(Array.from({ length: USERS }, () => user()));
  const totalMs = Date.now() - startedAt;

  const total = [...stats.values()].reduce((n, arr) => n + arr.length, 0);
  console.log(`Żądań: ${total} w ${(totalMs / 1000).toFixed(1)} s (${(total / (totalMs / 1000)).toFixed(1)}/s)`);
  console.log("");
  console.log("ścieżka                        n     p50      p95      max");
  console.log("─".repeat(64));

  for (const [path, times] of stats) {
    if (times.length === 0) continue;
    const sorted = [...times].sort((a, b) => a - b);
    const fmt = (n) => `${n.toFixed(0)} ms`.padStart(8);
    console.log(
      path.padEnd(30) +
        String(sorted.length).padStart(4) +
        fmt(percentile(sorted, 50)) +
        fmt(percentile(sorted, 95)) +
        fmt(sorted[sorted.length - 1])
    );
  }

  console.log("");
  console.log("Kody odpowiedzi:");
  for (const [key, count] of [...statuses].sort()) {
    console.log(`  ${key} × ${count}`);
  }

  // Wartość, o którą w tym teście chodzi. Cloudflare zrywa połączenie po ~15 s,
  // ale każdy skok powyżej sekundy oznacza, że proces stał i NIKT nie dostawał
  // odpowiedzi — także osoby, które akurat nic nie robiły.
  const worst = Math.max(...[...stats.values()].flat());
  console.log("");
  console.log(
    worst > 1000
      ? `UWAGA: najgorsza odpowiedź ${worst.toFixed(0)} ms — sprawdź /api/health i logi (grep eventloop).`
      : `Najgorsza odpowiedź: ${worst.toFixed(0)} ms.`
  );
};

main();
