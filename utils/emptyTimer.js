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
