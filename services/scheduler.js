import { tickNightly } from "./nightlyJob";
import { tickWeeklyUndertime } from "./weeklyUndertimeJob";
import { logError, logInfo } from "./log";

// JEDEN budzik dla wszystkich zadań okresowych.
//
// Na Mikrusie nie ma crona, a osobny proces przy tej samej bazie SQLite to
// dokładnie ta przyczyna, która 21.08.2026 położyła aplikację (services/db.js).
// Zostaje timer WEWNĄTRZ procesu Next — tego samego, którego pilnuje pm2.
//
// Timer nie jest jednak niczym więcej niż budzikiem: o tym, CZY jest co robić,
// rozstrzyga zapadka w tabeli JobRuns, osobna dla każdego zadania. Dlatego
// tyknięcie co minutę jest tanie i dlatego drugie zadanie NIE potrzebuje
// drugiego timera — potrzebuje tylko własnego wiersza w JobRuns.
//
// Zadania trzymamy w jednym miejscu, bo każdy setInterval w tej aplikacji musi
// pamiętać o tych samych trzech pułapkach (guard na globalThis, pominięcie fazy
// builda, unref) i drugi taki blok byłby drugim miejscem, w którym da się je
// przeoczyć.

const TICK_MS = 60_000;

const globalForScheduler = globalThis;

// Kolejność ma znaczenie tylko o tyle, że przy pierwszym tyknięciu po północy
// z wtorku obie zapadki mogą wypaść naraz — wtedy najpierw idą maile o kartach.
const JOBS = [
  ["nightly", tickNightly],
  ["niedogodziny", tickWeeklyUndertime],
];

const tickAll = (phase) => {
  for (const [name, tick] of JOBS) {
    try {
      tick();
    } catch (error) {
      // Wyjątek w callbacku setInterval kończy proces. Ta gałąź jest ostatnią
      // linią obrony przed tym, żeby sprzątanie kart położyło całą aplikację —
      // i pilnuje przy okazji, żeby wywrotka jednego zadania nie zabrała drugiego.
      logError("scheduler", error, { job: name, phase });
    }
  }
};

/**
 * Podpięcie budzika. Wołane z services/db.js — ten moduł wchodzi do każdego
 * bundla serwerowego i nigdy do klienta, a rejestracja jest idempotentna
 * (flaga na globalThis, jak w services/runtime.js).
 */
export const installScheduler = () => {
  if (globalForScheduler.__punktualnikSchedulerReady) return;
  globalForScheduler.__punktualnikSchedulerReady = true;

  // `next build` otwiera tę samą bazę (komentarz przy busy_timeout w db.js),
  // a jego workery odziedziczyłyby zapadki razem z prawem do wysyłki. Build
  // uruchomiony akurat po 3:00 rozesłałby powiadomienia zamiast serwera —
  // formalnie raz, ale z procesu, który za chwilę znika. Budujemy w ciszy.
  if (process.env.NEXT_PHASE === "phase-production-build") {
    return;
  }

  // Pierwsze sprawdzenie od razu przy starcie — to ono nadrabia dobę (albo
  // tydzień), w której proces nie żył.
  tickAll("install");

  const handle = setInterval(() => tickAll("tick"), TICK_MS);

  // Budzik nie może być powodem, dla którego proces nie chce się zamknąć.
  handle.unref();

  logInfo("scheduler", "budzik uruchomiony", { tickMs: TICK_MS, zadania: JOBS.length });
};

export default installScheduler;
