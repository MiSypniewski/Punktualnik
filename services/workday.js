import dayjs from "dayjs";

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

/** Początek doby roboczej, do której należy podany moment. */
export const workDayStart = (now = dayjs()) => {
  const d = dayjs(now);
  const base = d.hour() < WORKDAY_START_HOUR ? d.subtract(1, "day") : d;
  return base.hour(WORKDAY_START_HOUR).minute(0).second(0).millisecond(0);
};

/** Doba robocza jako 'YYYY-MM-DD' — wartość kolumny TaskEntries.data. */
export const workDay = (now = dayjs()) => workDayStart(now).format("YYYY-MM-DD");

/**
 * Najstarszy dzień, który pracownik może jeszcze edytować.
 * Okno to "dziś i wczoraj" liczone doba roboczą, więc o 1:00 w nocy nadal
 * edytowalny jest dzień, który dla kalendarza skończył się godzinę temu.
 */
export const minEditableDay = (now = dayjs()) => workDayStart(now).subtract(1, "day").format("YYYY-MM-DD");

/** Czy wpis z tego dnia mieści się w oknie edycji pracownika (kierownika nie dotyczy). */
export const isEditableDay = (data, now = dayjs()) => {
  const day = String(data ?? "").slice(0, 10);
  return day >= minEditableDay(now) && day <= workDay(now);
};
