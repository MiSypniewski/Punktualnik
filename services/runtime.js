import { logError, logWarn, logInfo } from "./log";

// Dozór nad procesem: hooki na nieobsłużone błędy i pomiar opóźnienia pętli zdarzeń.
//
// Po co: 21.08.2026 aplikacja przestała odpowiadać (Cloudflare 522), a pm2 pokazywał
// `restarts: 0` — czyli proces żył, tylko jego pętla zdarzeń stała. Dokładnie tego
// nie widać w żadnym standardowym logu. Ten moduł sprawia, że następnym razem
// blokada zostawi wpis, zanim urośnie do awarii widocznej dla ludzi.
//
// Wołany z services/db.js, bo tamten moduł wchodzi do każdego bundla serwerowego
// i nigdy nie trafia do klienta. Rejestracja jest idempotentna (flaga na globalThis),
// bo bundli jest kilkanaście, a proces jeden.

const globalForRuntime = globalThis;

// Powyżej tego progu pętla stała na tyle długo, że użytkownik to poczuł.
// Cloudflare zrywa połączenie po ~15 s; 500 ms to sygnał wczesny, nie alarmowy.
const LAG_WARN_MS = 500;
const TICK_MS = 1000;

export const installRuntimeGuards = () => {
  if (globalForRuntime.__punktualnikRuntimeReady) return;
  globalForRuntime.__punktualnikRuntimeReady = true;

  // Bez tego nieobsłużony wyjątek w kodzie asynchronicznym kończy proces bez słowa
  // wyjaśnienia (albo — przy odrzuconej obietnicy — cicho znika).
  process.on("uncaughtException", (err) => {
    logError("process", err, { kind: "uncaughtException" });
  });
  process.on("unhandledRejection", (reason) => {
    logError("process", reason, { kind: "unhandledRejection" });
  });

  // Pomiar dryfu: timer ustawiony na TICK_MS, który obudził się później, mówi
  // wprost, ile milisekund pętla była zajęta czymś synchronicznym. Przy
  // better-sqlite3 (API synchroniczne) to jedyny sensowny wskaźnik zdrowia.
  let expected = Date.now() + TICK_MS;
  globalForRuntime.__punktualnikMaxLag = 0;

  const tick = () => {
    const now = Date.now();
    const lag = now - expected;
    expected = now + TICK_MS;

    if (lag > globalForRuntime.__punktualnikMaxLag) {
      globalForRuntime.__punktualnikMaxLag = lag;
    }
    if (lag > LAG_WARN_MS) {
      logWarn("eventloop", `pętla zdarzeń stała ${lag} ms`, {
        rss: `${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB`,
      });
    }
  };

  // unref: ten timer nie może być powodem, dla którego proces nie chce się zamknąć.
  const handle = setInterval(tick, TICK_MS);
  handle.unref();

  logInfo("process", "dozór uruchomiony", { pid: process.pid, node: process.version });
};

/** Największe zmierzone opóźnienie pętli od startu procesu (dla /api/health). */
export const maxEventLoopLag = () => globalForRuntime.__punktualnikMaxLag ?? 0;
