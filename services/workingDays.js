import dayjs from "dayjs";

// Dni robocze i polskie święta ustawowo wolne od pracy.
//
// Ten plik NIE importuje ./db — formularz urlopowy liczy z niego długość wniosku
// jeszcze przed wysłaniem ("to wypada 5 dni roboczych"), więc musi wejść do
// bundla przeglądarki. Ta sama zasada co w absenceKinds.js.
//
// Świadomie bez zewnętrznej biblioteki: projekt ma tylko dayjs, a lista świąt
// wpisana ręcznie na kilka lat do przodu zestarzałaby się po cichu — pierwszy
// źle policzony urlop zauważyłby dopiero ktoś, komu zniknął dzień z puli.

// Święta o stałej dacie. Zapis 'MM-DD'.
const FIXED = [
  "01-01", // Nowy Rok
  "01-06", // Trzech Króli
  "05-01", // Święto Pracy
  "05-03", // Święto Konstytucji 3 Maja
  "08-15", // Wniebowzięcie NMP / Święto Wojska Polskiego
  "11-01", // Wszystkich Świętych
  "11-11", // Narodowe Święto Niepodległości
  "12-25", // Boże Narodzenie
  "12-26", // drugi dzień Bożego Narodzenia
];

/**
 * Niedziela wielkanocna w kalendarzu gregoriańskim — algorytm Meeusa/Butchera.
 * Same dzielenia całkowite, bez tablic i bez wyjątków dla konkretnych lat.
 *
 * @param {number} year
 * @returns {string} 'YYYY-MM-DD'
 */
const easterSunday = (year) => {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = marzec, 4 = kwiecień
  const day = ((h + l - 7 * m + 114) % 31) + 1;

  return dayjs(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`).format(
    "YYYY-MM-DD"
  );
};

// Liczenie jest tanie, ale pada dla każdego wniosku i każdego dnia zakresu —
// dwutygodniowy urlop to kilkanaście wywołań pod rząd na ten sam rok.
const cache = new Map();

/**
 * Wszystkie dni ustawowo wolne w danym roku.
 *
 * Wielkanoc i Zielone Świątki wypadają w niedzielę, więc dla liczenia dni
 * roboczych są nadmiarowe — zostają na liście, bo to jest lista ŚWIĄT, a nie
 * lista wyjątków od weekendu, i ktoś kiedyś zapyta o nią wprost.
 *
 * @param {number} year
 * @returns {Set<string>} daty 'YYYY-MM-DD'
 */
export const polishHolidays = (year) => {
  const cached = cache.get(year);
  if (cached) return cached;

  const easter = dayjs(easterSunday(year));
  const days = new Set([
    ...FIXED.map((md) => `${year}-${md}`),
    easter.format("YYYY-MM-DD"), // Niedziela Wielkanocna
    easter.add(1, "day").format("YYYY-MM-DD"), // Poniedziałek Wielkanocny
    easter.add(49, "day").format("YYYY-MM-DD"), // Zielone Świątki
    easter.add(60, "day").format("YYYY-MM-DD"), // Boże Ciało
  ]);

  cache.set(year, days);
  return days;
};

/**
 * Czy tego dnia się pracuje — czyli nie sobota, nie niedziela i nie święto.
 * @param {string|dayjs.Dayjs} date
 */
export const isWorkingDay = (date) => {
  const d = dayjs(date);
  const weekday = d.day(); // 0 = niedziela, 6 = sobota
  if (weekday === 0 || weekday === 6) return false;
  return !polishHolidays(d.year()).has(d.format("YYYY-MM-DD"));
};

/**
 * Ile dni roboczych obejmuje zakres — obie granice włącznie.
 *
 * To jest liczba, którą zdejmujemy z puli urlopu: wniosek piątek–poniedziałek
 * kosztuje dwa dni, nie cztery.
 *
 * @param {string} from 'YYYY-MM-DD'
 * @param {string} to   'YYYY-MM-DD'
 * @returns {number} 0, gdy zakres jest odwrócony albo mieści się w weekendzie
 */
export const countWorkingDays = (from, to) => {
  const start = dayjs(from);
  const end = dayjs(to);
  if (!start.isValid() || !end.isValid() || end.isBefore(start, "day")) return 0;

  let count = 0;
  for (let d = start; !d.isAfter(end, "day"); d = d.add(1, "day")) {
    if (isWorkingDay(d)) count += 1;
  }
  return count;
};
