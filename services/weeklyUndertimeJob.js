import db from "./db";
import { now as appNow, workDayStart } from "./workday";
import getUndertimeUsers from "./getUndertimeUsers";
import { notifyUndertimeReminder } from "./notifyMail";
import { logError, logInfo } from "./log";

// Cotygodniowe przypomnienie o niedogodzinach.
//
// Saldo nadgodzin bywa ujemne i nikt się o tym nie dowiaduje, dopóki sam nie
// zajrzy na /nadgodziny. Im dłużej minus leży, tym gorzej się go nadrabia, więc
// raz w tygodniu pracownik dostaje wiadomość, a komplet kierowników jego sekcji
// kopię (services/notifyMail.js).
//
// Budzik jest wspólny z zadaniem nocnym (services/scheduler.js) — powód opisany
// jest tam. Tutaj zostaje sama odpowiedź na pytanie „czy jest co robić i dla kogo”.

const JOB = "niedogodziny";

// Wtorek. dayjs liczy od niedzieli = 0.
const TUESDAY = 2;

/**
 * Próg wysyłki w MINUTACH, ujemny — cała ewidencja nadgodzin jest w minutach
 * (Overtime.minutes), godziny pojawiają się dopiero przy formatowaniu.
 * Warunek jest `<=`, więc saldo równe -4h już kwalifikuje do wysyłki.
 */
export const UNDERTIME_ALERT_MINUTES = -4 * 60;

const stmtLatch = db.prepare(`SELECT lastDay FROM JobRuns WHERE job = ?`);
const stmtSetLatch = db.prepare(`
  INSERT INTO JobRuns (job, lastDay, ranAt) VALUES (@job, @lastDay, @ranAt)
  ON CONFLICT(job) DO UPDATE SET lastDay = @lastDay, ranAt = @ranAt`);

const setLatch = (day) =>
  stmtSetLatch.run({ job: JOB, lastDay: day, ranAt: appNow().format() });

/**
 * Ostatni wtorek 3:00 nie później niż `moment`, jako 'YYYY-MM-DD'.
 *
 * Ta jedna funkcja zastępuje sprawdzanie „czy dziś jest wtorek”: wartość zmienia
 * się dokładnie raz w tygodniu, więc porównanie z zapadką rozstrzyga naraz dwie
 * rzeczy — czy w tym tygodniu już poszło i czy jest co nadrobić po przestoju.
 *
 * Liczone dobą roboczą (workDayStart), więc wtorek zaczyna się o 3:00, a nie
 * o północy: przebieg o 3:00 we wtorek celuje w ten sam tydzień co przebieg
 * o 23:00 tego samego dnia.
 */
const lastTuesday = (moment) => {
  const d = workDayStart(moment);
  return d.subtract((d.day() - TUESDAY + 7) % 7, "day").format("YYYY-MM-DD");
};

/**
 * Jeden przebieg: kto jest pod progiem, temu jedna wiadomość.
 *
 * Sekwencyjnie, nie Promise.all — z tego samego powodu co w nightlyJob.js: pula
 * SMTP ma jedno połączenie (services/mailer.js), a sendMail nigdy nie rzuca,
 * więc jedna nieudana wiadomość nie zabiera ze sobą reszty.
 */
const runOnce = async (target) => {
  const people = getUndertimeUsers(UNDERTIME_ALERT_MINUTES);

  logInfo(JOB, "przypomnienie o niedogodzinach", {
    tydzien: target,
    prog: UNDERTIME_ALERT_MINUTES,
    powiadomienia: people.length,
  });

  for (const person of people) {
    await notifyUndertimeReminder(person);
  }
};

/**
 * Czy jest co robić — i jeśli tak, zrób to raz. Wzorzec jak w nightlyJob.js,
 * łącznie z zapadką stawianą PRZED przebiegiem.
 *
 * Jedna różnica jest świadoma: tutaj nadrabianie jest POŻĄDANE. Proces, który
 * wstaje w czwartek, wysyła przypomnienie za miniony wtorek, bo saldo nadal jest
 * ujemne i wiadomość niczego nie straciła. Zadanie nocne odwrotnie — tam mail
 * o karcie sprzed trzech tygodni nie ma już czego naprawić.
 */
export const tickWeeklyUndertime = (moment = appNow()) => {
  const target = lastTuesday(moment);
  const latch = stmtLatch.get(JOB);

  // Pierwsze uruchomienie na tej bazie: zapadka BEZ wysyłki. Wdrożenie nie ma
  // prawa rozesłać przypomnień w losowy dzień tygodnia — pierwsze pójdą
  // w najbliższy wtorek.
  if (!latch) {
    setLatch(target);
    logInfo(JOB, "zapadka założona, pierwsza wysyłka w kolejny wtorek", { tydzien: target });
    return false;
  }

  if (latch.lastDay >= target) return false;

  setLatch(target);

  runOnce(target).catch((error) => logError(JOB, error, { tydzien: target }));
  return true;
};

export default tickWeeklyUndertime;
