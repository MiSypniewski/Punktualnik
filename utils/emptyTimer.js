// Progi "pustego" timera — biegnącego bez opisu I bez projektu.
//
// Jedno miejsce dla serwera (services/emptyTimerJob.js: mail do kierownika
// i zamknięcie wpisu) i dla przeglądarki (components/emptyTimerNudge.js: baner
// i powiadomienie). Rozjazd tych liczb znaczyłby, że baner obiecuje zamknięcie
// o innej godzinie, niż zrobi to budzik.
//
// Ten plik NIE importuje niczego z services/ — wchodzi do bundla przeglądarki
// (ta sama zasada co w utils/live.js).

/** Pierwsze przypomnienie dla pracownika, tylko w aplikacji. */
export const EMPTY_REMIND_MIN = 15;

/** Drugie przypomnienie w aplikacji i mail: pracownik + kierownicy sekcji. */
export const EMPTY_MANAGER_MIN = 20;

/** Zamknięcie wpisu na start + tyle minut, w projekcie systemowym. */
export const EMPTY_CLOSE_MIN = 30;

/** Opis wpisywany przy zamknięciu. */
export const EMPTY_DESCRIPTION = "brak opisanej czynności";

/** Nazwa projektu systemowego, na który trafiają takie wpisy. */
export const EMPTY_PROJECT_NAME = "do usunięcia";

/** Czy wpis jest "pusty" — ta sama reguła co warunek w SQL budzika. */
export const isEmptyTimer = (entry) =>
  Boolean(entry) && !entry.projectID && !String(entry.description ?? "").trim();

/**
 * Który próg przypomnienia obowiązuje biegnący timer z /api/entries/timer:
 * 0 — żaden, 1 — po EMPTY_REMIND_MIN, 2 — po EMPTY_MANAGER_MIN (kierownik wie).
 * Wspólne dla banera (components/emptyTimerNudge.js) i migającej karty
 * (components/timerTitle.js), żeby oba zaczynały w tej samej sekundzie.
 */
export const emptyStageAt = (running, seconds) => {
  if (!running?.empty) return 0;
  if (seconds >= EMPTY_MANAGER_MIN * 60) return 2;
  if (seconds >= EMPTY_REMIND_MIN * 60) return 1;
  return 0;
};
