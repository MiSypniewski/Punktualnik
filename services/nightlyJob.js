import db from "./db";
import { now as appNow, workDayStart } from "./workday";
import { closeOpenCards, getAutoClosedCards } from "./closeOpenCards";
import { closeStaleEntries, getAutoClosedEntries } from "./taskEntries";
import { notifyMissingPunchOut, notifyUnfinishedTask } from "./notifyMail";
import { logError, logInfo } from "./log";

// Zadanie uruchamiane raz na dobę, na granicy doby roboczej (3:00).
//
// Budzik jest wspólny dla wszystkich zadań okresowych i siedzi w
// services/scheduler.js — tam też jest powód, dla którego to timer w procesie
// Next, a nie cron. Tutaj zostaje sama odpowiedź na pytanie, CZY jest co robić:
// rozstrzyga ją zapadka w bazie (tabela JobRuns). Bez niej restart procesu
// o 3:05 wysłałby komplet powiadomień drugi raz, a restart o 2:59 — ani razu.

const JOB = "nightly";

const stmtLatch = db.prepare(`SELECT lastDay FROM JobRuns WHERE job = ?`);
const stmtSetLatch = db.prepare(`
  INSERT INTO JobRuns (job, lastDay, ranAt) VALUES (@job, @lastDay, @ranAt)
  ON CONFLICT(job) DO UPDATE SET lastDay = @lastDay, ranAt = @ranAt`);

const setLatch = (day) =>
  stmtSetLatch.run({ job: JOB, lastDay: day, ranAt: appNow().format() });

/**
 * Doba robocza, która właśnie się skończyła — czyli ta, o której zadanie mówi.
 * O 3:00 dzisiaj kończy się doba wczorajsza i to jej karty domykamy.
 */
const previousWorkDay = (moment) => workDayStart(moment).subtract(1, "day").format("YYYY-MM-DD");

/**
 * Jeden przebieg: domknięcie zapomnianych kart i timerów, potem powiadomienia.
 *
 * Kolejność jest istotna — najpierw domykamy, potem pytamy bazę, KOGO to
 * dotyczyło. Odwrotnie nie zadziała, a poleganie na zwrotkach funkcji domykających
 * pominęłoby wpisy zamknięte wcześniej, leniwie (services/taskEntries.js).
 */
const runOnce = async (day) => {
  const cards = closeOpenCards(day);
  const entries = closeStaleEntries();

  // Powiadamiamy o dobie, która właśnie się skończyła, i TYLKO o niej (`= day`,
  // nie `<=`). Domykanie nadrabia zaległości z wcześniejszych dni, wysyłka nie:
  // mail o karcie sprzed trzech tygodni nie ma już czego naprawić, a paczka
  // takich maili po dłuższym przestoju wyglądałaby jak awaria.
  const openCards = getAutoClosedCards(day);
  const openEntries = getAutoClosedEntries(day);

  logInfo("nightly", "domykanie zakończone", {
    day,
    kartyDomkniete: cards,
    zadaniaDomkniete: entries,
    powiadomieniaKarty: openCards.length,
    powiadomieniaZadania: openEntries.length,
  });

  // Sekwencyjnie, nie Promise.all: skrzynka OVH ma jedno połączenie w puli
  // (services/mailer.js), a kilkanaście równoległych wysyłek i tak ustawiłoby
  // się w kolejce — tyle że bez możliwości przerwania. sendMail nigdy nie rzuca,
  // więc jedna nieudana wiadomość nie zabiera ze sobą reszty.
  for (const card of openCards) {
    await notifyMissingPunchOut(card);
  }
  for (const entry of openEntries) {
    await notifyUnfinishedTask(entry);
  }
};

/**
 * Czy jest co robić — i jeśli tak, zrób to raz.
 *
 * Zapadka trzyma dobę roboczą, dla której zadanie już poszło. Gdy bieżąca doba
 * jest inna, granica 3:00 została przekroczona od ostatniego przebiegu.
 *
 * Proces wyłączony na całą noc NADRABIA zaległy przebieg przy starcie: mail
 * o ósmej rano jest gorszy od maila o trzeciej, ale bez porównania lepszy od
 * braku maila.
 */
export const tickNightly = (moment = appNow()) => {
  const today = workDayStart(moment).format("YYYY-MM-DD");
  const latch = stmtLatch.get(JOB);

  // Pierwsze uruchomienie na tej bazie: zapisujemy zapadkę BEZ wysyłki.
  // Inaczej wdrożenie oznaczałoby lawinę powiadomień o kartach otwartych od
  // miesięcy — czyli o wszystkim, czego ta funkcja jeszcze nigdy nie sprzątała.
  if (!latch) {
    setLatch(today);
    logInfo("nightly", "zapadka założona, pierwszy przebieg jutro", { day: today });
    return false;
  }

  if (latch.lastDay >= today) return false;

  // Zapadkę stawiamy PRZED przebiegiem. Gdyby przebieg się wywrócił w połowie
  // (np. po wysłaniu części maili), powtórka przy następnym tyknięciu wysłałaby
  // tamte maile ponownie. Lepiej stracić jedno powiadomienie niż zapętlić wysyłkę.
  setLatch(today);

  // Bez await: tick leci z setInterval, a wysyłka poczty potrafi trwać. Zapadka
  // jest już postawiona, więc kolejne tyknięcie i tak nic nie zrobi. Obietnicę
  // trzeba jednak DOMKNĄĆ catchem — nieobsłużone odrzucenie kończy proces.
  runOnce(previousWorkDay(moment)).catch((error) => logError("nightly", error, { day: today }));
  return true;
};
