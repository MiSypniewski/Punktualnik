import dayjs from "dayjs";
import utcPlugin from "dayjs/plugin/utc";
import timezonePlugin from "dayjs/plugin/timezone";

dayjs.extend(utcPlugin);
dayjs.extend(timezonePlugin);

// Strefa czasowa APLIKACJI — nie procesu, nie systemu.
//
// Kontener na Mikrusie chodzi w UTC, a ludzie i ich przeglądarki w Europe/Warsaw.
// Ponieważ znaczniki zapisujemy BEZ offsetu (patrz TS_FORMAT niżej), serwer
// stemplujący je czasem UTC dawał wpisy przesunięte o dwie godziny: przeglądarka
// odczytywała "12:56" jako czas lokalny i timer startował z 2h na liczniku.
//
// Strefę wymuszamy TUTAJ, a NIE przez TZ całego procesu — i to jest świadoma
// decyzja. Globalne TZ naprawiłoby ten moduł, ale zmieniłoby zachowanie kart
// czasu: services/getTime.js dopasowuje dzisiejszą kartę porównaniem DOSŁOWNYM
// (`data = ?`) na ciągu ISO razem z offsetem. Serwer w UTC zapisuje i odczytuje
// "+00:00" spójnie, więc karty działają; przestawienie strefy procesu sprawiłoby,
// że zacząłby generować "+02:00" i karty zapisane tego samego dnia przestałyby
// się dopasowywać. Wymuszenie strefy w tym module nie dotyka tamtej ścieżki.
export const APP_TZ = process.env.APP_TZ || "Europe/Warsaw";

/**
 * "Teraz" w strefie aplikacji, niezależnie od strefy procesu.
 * Każde miejsce po stronie serwera, które potrzebuje bieżącego czasu, MUSI
 * wołać tę funkcję zamiast gołego dayjs().
 */
export const now = () => dayjs().tz(APP_TZ);

// Doba robocza zaczyna się o 3:00, nie o północy — i ta granica nie jest tu nowa:
// pages/time/[id].js przypina `data` w Times do godziny 3:00 z dokładnie tego samego
// powodu. Zmiana kończąca się o 1:00 należy do dnia, w którym się zaczęła, a nie do
// kalendarzowego "jutra"; przy okazji 3:00 omija godzinę zmiany czasu (2:00–3:00),
// której w niektóre noce po prostu nie ma albo jest dwa razy.
//
// Ten plik jest JEDYNYM źródłem prawdy o dobie roboczej dla modułu zadań. Jeśli
// granica kiedyś się zmieni, zmienia się tylko tutaj.
export const WORKDAY_START_HOUR = 3;

// Znaczniki czasu w TaskEntries trzymamy jako 'YYYY-MM-DD HH:mm:ss' — czas lokalny
// BEZ offsetu strefy, inaczej niż Times (tam ISO z '+02:00', spadek po Airtable).
// Powód jest konkretny: wykrywanie nakładających się wpisów to porównanie
// leksykograficzne w SQL (startedAt < @end AND endedAt > @start), a ono jest
// poprawne wyłącznie wtedy, gdy wszystkie wartości mają identyczny kształt.
export const TS_FORMAT = "YYYY-MM-DD HH:mm:ss";

/** Dowolny moment → znacznik w formacie kolumn startedAt/endedAt. */
export const toStamp = (moment) => dayjs(moment).format(TS_FORMAT);

// Parametr nazywa się `moment`, a nie `now` — inaczej przesłaniałby funkcję
// now() i domyślna wartość rzucałaby ReferenceError.

/** Początek doby roboczej, do której należy podany moment. */
export const workDayStart = (moment = now()) => {
  const d = dayjs(moment);
  const base = d.hour() < WORKDAY_START_HOUR ? d.subtract(1, "day") : d;
  return base.hour(WORKDAY_START_HOUR).minute(0).second(0).millisecond(0);
};

/** Doba robocza jako 'YYYY-MM-DD' — wartość kolumny TaskEntries.data. */
export const workDay = (moment = now()) => workDayStart(moment).format("YYYY-MM-DD");

/**
 * Najstarszy dzień, który pracownik może jeszcze edytować.
 * Okno to "dziś i wczoraj" liczone doba roboczą, więc o 1:00 w nocy nadal
 * edytowalny jest dzień, który dla kalendarza skończył się godzinę temu.
 */
export const minEditableDay = (moment = now()) =>
  workDayStart(moment).subtract(1, "day").format("YYYY-MM-DD");

/** Czy wpis z tego dnia mieści się w oknie edycji pracownika (kierownika nie dotyczy). */
export const isEditableDay = (data, moment = now()) => {
  const day = String(data ?? "").slice(0, 10);
  return day >= minEditableDay(moment) && day <= workDay(moment);
};
