import db, { DEFAULT_BUSY_MS } from "./db";
import { now as appNow } from "./workday";
import { closeEmptyEntries, hasEmptyDue, takeEmptyForManager } from "./taskEntries";
import { notifyEmptyTimer } from "./notifyMail";
import { logError, logInfo, logWarn } from "./log";

// Pusty timer — biegnący bez opisu I bez projektu (progi w utils/emptyTimer.js).
//
//  - po 15 min przypomina przeglądarka (components/emptyTimerNudge.js), serwer nic nie robi;
//  - po 20 min: mail do pracownika z kopią do kierowników sekcji;
//  - po 30 min: wpis zamknięty na start + 30 min w projekcie systemowym "do usunięcia".
//
// Tyka co minutę na wspólnym budziku (services/scheduler.js). Zapadki w JobRuns
// tu nie ma i nie jest potrzebna: stan siedzi w samym wpisie (TaskEntries.emptyStage),
// bo dotyczy pojedynczego timera, a nie okresu.
//
// Najpierw zamykamy, potem wybieramy adresatów maila — wpis, który po przestoju
// procesu ma już 30 minut, zostaje tylko zamknięty, bez spóźnionego ostrzeżenia
// "zostanie zamknięty" (ta sama reguła co w zadaniu nocnym: nie nadrabiamy
// powiadomień, które nie mają już czego naprawić).

// Zapis wykonywany co minutę, na który nikt nie czeka — jak sprzątanie
// w services/taskEntries.js (sweepStaleEntries). Kolizja o blokadę nie może
// zamrozić procesu na pełne 3 s; przebieg przepada, następny spróbuje za minutę.
const BUSY_MS = 250;

export const tickEmptyTimers = (moment = appNow()) => {
  // Zwykle nie ma nic do roboty — wtedy kończymy na jednym odczycie, bez
  // przestawiania busy_timeout i bez brania blokady zapisu.
  if (!hasEmptyDue(moment)) return false;

  let closed = 0;
  let toNotify = [];

  db.pragma(`busy_timeout = ${BUSY_MS}`);
  try {
    closed = closeEmptyEntries(moment);
    toNotify = takeEmptyForManager(moment);
  } catch (error) {
    if (error.code === "SQLITE_BUSY") {
      logWarn("pusty-timer", "przebieg pominięty (baza zajęta)", { code: error.code });
      return false;
    }
    throw error;
  } finally {
    db.pragma(`busy_timeout = ${DEFAULT_BUSY_MS}`);
  }

  if (closed === 0 && toNotify.length === 0) return false;

  logInfo("pusty-timer", "przebieg", { zamkniete: closed, powiadomienia: toNotify.length });

  // Bez await, jak w services/nightlyJob.js: tick leci z setInterval, a stan jest
  // już zapisany, więc kolejne tyknięcie tych wpisów nie wybierze. Sekwencyjnie,
  // bo skrzynka OVH ma jedno połączenie w puli.
  (async () => {
    for (const entry of toNotify) {
      await notifyEmptyTimer(entry);
    }
  })().catch((error) => logError("pusty-timer", error, { phase: "mail" }));

  return true;
};

export default tickEmptyTimers;
