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
 * Górna długość frazy szukanej po nazwie zadania (raport zadań).
 *
 * Siedzi TUTAJ, a nie w services/entryStats.js, bo potrzebują jej zarówno
 * serwer, jak i formularz w przeglądarce — a import z services/ wciągnąłby
 * do bundla klienta better-sqlite3. Sam opis zadania ma limit 200 znaków;
 * fraza jest jego FRAGMENTEM, więc krótszy limit niczego nie odcina,
 * a chroni zapytanie przed kilobajtem tekstu z wklejenia.
 */
export const TASK_QUERY_MAX = 100;

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
 * Sekundy → "2h 15min 07s". Wymiar wpisu w module zadań.
 *
 * Osobna funkcja obok formatMinutes, a nie jej rozszerzenie: nadgodziny są
 * ewidencjonowane w minutach i doklejanie im "00s" byłoby fałszywą precyzją.
 * Tutaj sekundy są prawdziwą treścią — zadanie potrafi trwać pół minuty
 * i "0h 0min" wyglądałoby jak zgubiony wpis.
 *
 * Sekundy zawsze dwucyfrowo, żeby kolumna z tabular-nums nie skakała.
 * @param {number} seconds
 * @param {{withSign?: boolean}} [opts] withSign wymusza "+" przy wartościach dodatnich
 */
export const formatDuration = (seconds, { withSign = false } = {}) => {
  const total = Math.trunc(Number(seconds) || 0);
  const abs = Math.abs(total);
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  const s = abs % 60;

  const sign = total < 0 ? "-" : withSign && total > 0 ? "+" : "";
  return `${sign}${h}h ${m}min ${String(s).padStart(2, "0")}s`;
};

/**
 * Sekundy → "1:21:35". Zapis dla paska karty przeglądarki (components/timerTitle.js).
 *
 * Osobny format obok formatDuration, bo tytuł karty jest ucinany po kilkunastu
 * znakach: "1h 21min 35s · Przyjęcie sklepu" nie zmieściłoby ani zegara, ani opisu.
 * Godziny bez wiodącego zera (tak wygląda zegar), minuty i sekundy zawsze
 * dwucyfrowo — inaczej "1:5:7" nie czyta się jako czas.
 * @param {number} seconds
 */
export const formatClock = (seconds) => {
  const total = Math.max(0, Math.trunc(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;

  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
};

/**
 * "07:45:30" → 27930. Odwrotność formatDuration dla zapisu używanego w Times.
 *
 * Times.totalWorkTime jest TEKSTEM (spadek po Airtable), więc żeby zestawić
 * obecność z czasem zaraportowanym w zadaniach, trzeba go najpierw sprowadzić
 * do liczby. Sekundy bierzemy w całości — wpisy zadań też są liczone co do
 * sekundy, a odrzucanie ich po jednej stronie zestawienia zaniżałoby pokrycie.
 *
 * Zwraca 0 dla pustych i niepoprawnych wartości — brak odbitej karty to zero
 * obecności, nie błąd.
 */
export const parseHmsToSeconds = (hms) => {
  const parts = String(hms ?? "").trim().split(":");
  if (parts.length < 2) return 0;

  const [h, m, s = 0] = parts.map((p) => Number(p));
  if (!Number.isFinite(h) || !Number.isFinite(m) || !Number.isFinite(s)) return 0;

  return h * 3600 + m * 60 + s;
};

// Znaczniki TaskEntries mają kształt 'YYYY-MM-DD HH:mm:ss' (services/workday.js),
// więc godzinę wycinamy pozycyjnie. Obie funkcje siedzą TUTAJ, bo potrzebują ich
// i strony, i endpoint eksportu — wcześniej hhmm było skopiowane w czterech plikach.

/** Znacznik → 'HH:mm' (do wyświetlania i do <input type="time">). */
export const hhmm = (ts) => String(ts ?? "").slice(11, 16);

/** Znacznik → 'HH:mm:ss'. */
export const timePart = (ts) => String(ts ?? "").slice(11, 19);

/**
 * Godzina do wysłania z formularza edycji wpisu.
 *
 * Pola <input type="time"> pokazują "HH:mm", bo tak się o godzinach mówi i nikt
 * nie chce klikać sekund przy poprawianiu literówki w opisie. Ale wpis potrafi
 * zaczynać się o 13:12:11 — gdyby nietknięte pole odesłało samo "13:12",
 * poprawienie opisu skróciłoby 30-sekundowy wpis do zera i odbiło się o walidację
 * "koniec musi się różnić od początku". Dlatego pole nietknięte oddaje ORYGINALNY
 * znacznik z sekundami, a dopiero ręczna zmiana godziny zeruje sekundy — co jest
 * dokładnie tym, czego oczekuje ktoś, kto wpisuje "9:15".
 *
 * @param {string} value wartość z pola ("HH:mm")
 * @param {string} stamp znacznik z bazy ('YYYY-MM-DD HH:mm:ss')
 */
export const keepSeconds = (value, stamp) => (value === hhmm(stamp) ? timePart(stamp) : value);
