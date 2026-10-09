import db from "./db";
import { now as appNow, workDayStart } from "./workday";
import { generateMonth, lastClosedMonth } from "./monthlyReport";
import { logInfo } from "./log";

// Miesięczne podsumowania pracowników — migawka zapisywana 1. dnia miesiąca
// za miesiąc, który właśnie się skończył.
//
// Budzik jest wspólny z pozostałymi zadaniami (services/scheduler.js) — powód
// opisany jest tam. Tutaj zostaje sama odpowiedź na pytanie „czy jest co robić”.

const JOB = "raport-miesieczny";

const stmtLatch = db.prepare(`SELECT lastDay FROM JobRuns WHERE job = ?`);
const stmtSetLatch = db.prepare(`
  INSERT INTO JobRuns (job, lastDay, ranAt) VALUES (@job, @lastDay, @ranAt)
  ON CONFLICT(job) DO UPDATE SET lastDay = @lastDay, ranAt = @ranAt`);

/**
 * Pierwszy dzień bieżącego miesiąca, jako 'YYYY-MM-DD'.
 *
 * Liczony dobą roboczą (workDayStart), więc miesiąc zaczyna się 1. dnia
 * o 3:00, a nie o północy: zmiana kończąca się o 1:00 w nocy należy jeszcze
 * do miesiąca poprzedniego i raport ma ją objąć.
 */
const monthStart = (moment) => workDayStart(moment).format("YYYY-MM-01");

/**
 * Czy jest co robić — i jeśli tak, zrób to raz. Wzorzec jak w nightlyJob.js,
 * łącznie z zapadką stawianą PRZED przebiegiem.
 *
 * Dwie różnice wobec zadań wysyłających pocztę, obie świadome:
 *
 *  - przy PIERWSZYM uruchomieniu na tej bazie raport powstaje od razu. Tamte
 *    zadania zakładają wtedy samą zapadkę, żeby wdrożenie nie rozesłało lawiny
 *    maili; tu nic nie wychodzi na zewnątrz, a pusty ekran przez miesiąc po
 *    wdrożeniu byłby jedynym skutkiem ostrożności;
 *  - przestój jest nadrabiany: proces, który wstaje 3. dnia miesiąca, liczy
 *    miesiąc poprzedni tak samo, jak policzyłby go 1. dnia.
 *
 * Przebieg jest synchroniczny (better-sqlite3) — cztery zapytania na cały
 * miesiąc i jedna transakcja zapisu, bez niczego, na co trzeba by czekać.
 */
export const tickMonthlyReport = (moment = appNow()) => {
  const target = monthStart(moment);
  const latch = stmtLatch.get(JOB);

  if (latch && latch.lastDay >= target) return false;

  stmtSetLatch.run({ job: JOB, lastDay: target, ranAt: appNow().format() });

  const month = lastClosedMonth(moment);
  const people = generateMonth(month);

  logInfo(JOB, "podsumowanie miesięczne zapisane", { miesiac: month, osoby: people });
  return true;
};

export default tickMonthlyReport;
