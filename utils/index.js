import dayjs from "dayjs";
import "dayjs/locale/pl";
const AdvancedFormat = require("dayjs/plugin/advancedFormat");
const isSameOrBefore = require("dayjs/plugin/isSameOrBefore");
const duration = require("dayjs/plugin/duration");
dayjs.extend(AdvancedFormat);
dayjs.extend(isSameOrBefore);
dayjs.extend(duration);
dayjs.locale("pl");

export const Timer = (stop) => {
  if (dayjs().isSameOrBefore(stop, "seconds")) {
    const tmp = dayjs.duration(dayjs(stop).diff(dayjs()));
    return {
      overtime: false,
      time: tmp.format(`HH:mm:ss`),
    };
  } else {
    const tmp = dayjs.duration(dayjs(dayjs()).diff(stop));
    return {
      overtime: true,
      time: tmp.format(`HH:mm:ss`),
    };
  }
};

export const DifferenceTime = (start, stop) => {
  const workTime = dayjs(stop).diff(dayjs(start), "hours");
  const tmp = dayjs.duration(dayjs(stop).diff(dayjs(start)));
  if (workTime < 8) {
    return {
      overtime: false,
      time: tmp.format(`HH:mm:ss`),
    };
  } else {
    return {
      overtime: true,
      time: tmp.format(`HH:mm:ss`),
    };
  }
};

export const jsonFetcher = (url) => fetch(url).then((res) => res.json());

/**
 * Minuty → "2h 30min". Używane w module nadgodzin, gdzie saldo bywa ujemne,
 * więc znak wychodzi przed liczbę, a nie w środku ("-2h 30min", nie "-2h -30min").
 * @param {number} minutes
 * @param {{withSign?: boolean}} [opts] withSign wymusza "+" przy wartościach dodatnich
 */
export const formatMinutes = (minutes, { withSign = false } = {}) => {
  const total = Number(minutes) || 0;
  const abs = Math.abs(total);
  const h = Math.floor(abs / 60);
  const m = abs % 60;

  const sign = total < 0 ? "-" : withSign && total > 0 ? "+" : "";
  return `${sign}${h}h ${m}min`;
};

/**
 * "07:45:00" → 465. Odwrotność formatMinutes dla zapisu używanego w Times.
 *
 * Times.totalWorkTime jest TEKSTEM (spadek po Airtable), więc żeby zestawić
 * obecność z czasem zaraportowanym w zadaniach, trzeba go najpierw sprowadzić
 * do minut. Sekundy są odrzucane w dół — przy zestawieniu godzin pracy różnica
 * poniżej minuty nie ma znaczenia, a zaokrąglanie w górę potrafiłoby sztucznie
 * podbić sumę miesiąca o kilkanaście minut.
 *
 * Zwraca 0 dla pustych i niepoprawnych wartości — brak odbitej karty to zero
 * obecności, nie błąd.
 */
export const parseHmsToMinutes = (hms) => {
  const parts = String(hms ?? "").trim().split(":");
  if (parts.length < 2) return 0;

  const [h, m] = parts.map((p) => Number(p));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;

  return h * 60 + m;
};
