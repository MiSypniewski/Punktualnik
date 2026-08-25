// Wspólne ustawienia widoków, które same dociągają dane z serwera.
//
// Ten plik NIE importuje niczego z services/ — wchodzi do bundla przeglądarki,
// a tamte moduły ciągną za sobą better-sqlite3 (ta sama zasada co
// w services/overtimeKinds.js).

/**
 * Co ile widok "na żywo" odpytuje serwer.
 *
 * Jedna wartość dla sekcji "Teraz w toku" (components/liveBoard.js) i dla
 * tablicy kiosku (pages/time/[id].js): oba pokazują STAN NA TERAZ tej samej
 * sekcji, więc rozjazd częstotliwości znaczyłby, że dwa ekrany w tym samym
 * pomieszczeniu pokazują dane z różnych chwil i nie wiadomo, który kłamie.
 *
 * 45 sekund, a nie sekunda: każde zapytanie do SQLite jest synchroniczne
 * (better-sqlite3 nie ma innego trybu), więc częstotliwość odpytywania jest
 * tu wprost kosztem dla WSZYSTKICH żądań — patrz rozdział README
 * "Kiedy aplikacja muli".
 */
export const LIVE_POLL_MS = 45_000;

/**
 * Fetcher dla SWR, który traktuje odpowiedź 4xx/5xx jako BŁĄD.
 *
 * Świadomie nie używamy jsonFetcher z utils/index.js — tamten nie sprawdza
 * res.ok, więc 401 albo 403 wróciłoby do SWR jako poprawne dane ({error: ...})
 * i widok wyzerowałby się bez żadnego śladu. Rzucony wyjątek zostawia
 * na ekranie ostatni znany stan, a SWR sam ponowi próbę.
 */
export const fetchLive = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};
