import Joi from "joi";
import dayjs from "dayjs";
import utcPlugin from "dayjs/plugin/utc";
import timezonePlugin from "dayjs/plugin/timezone";
import db from "./db";
import { APP_TZ, WORKDAY_START_HOUR } from "./workday";
import { DifferenceTime } from "../utils";
import { logInfo } from "./log";

dayjs.extend(utcPlugin);
dayjs.extend(timezonePlugin);

// Korekta kart czasu przez kierownika.
//
// Zapis do Times był dotąd zamknięty za canPunchCards, czyli dostępny wyłącznie
// kioskowi i wyłącznie na dzisiejszej karcie. Skutek: karta odbita o złej porze
// albo domknięta automatycznie (services/closeOpenCards.js) zostawała w bazie
// błędna na zawsze — pracownik jej nie sięgał, a jedyna osoba odpowiedzialna za
// poprawność ewidencji nie miała czym.
//
// ---------------------------------------------------------------------------
// DWA RÓŻNE CZASY W JEDNEJ TABELI — to jest tu najważniejszy szczegół.
//
// Times.data jest kotwicą doby i porównuje się je DOSŁOWNIE, całym ciągiem
// (services/getTime.js: `data = ?`, services/getSectionTime.js tak samo). Musi
// więc powstawać dokładnie tym samym wyrażeniem co u pozostałych: dayjs() w
// strefie PROCESU, przypięte do godziny 3:00. Na Mikrusie proces chodzi w UTC,
// więc kiosk zapisuje tam '...T03:00:00+00:00'; gdyby ta funkcja wygenerowała
// '+02:00', dopisana karta po prostu nie pokazałaby się na tablicy — zapytanie
// nie znalazłoby jej po `data`.
//
// Times.startTime i endTime nie są z niczym porównywane dosłownie: służą do
// odejmowania i do wyświetlenia. Te MUSZĄ powstać w strefie aplikacji
// (services/workday.js: APP_TZ), bo kierownik wpisuje godzinę ścienną. Proces
// w UTC opisałby "07:12" jako '+00:00' i pracownik zobaczyłby na tablicy 09:12.
// Kiosk trafia w to samo przypadkiem — components/card.js liczy znaczniki
// w PRZEGLĄDARCE, a ta stoi w Warszawie.
// ---------------------------------------------------------------------------

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const schema = Joi.object({
  start: Joi.string().pattern(TIME_RE).required(),
  end: Joi.string().pattern(TIME_RE).required(),
});

const daySchema = Joi.object({
  day: Joi.string().pattern(DAY_RE).required(),
  userID: Joi.number().integer().positive().required(),
});

const fail = (code, message) => {
  const error = new Error(message);
  error.code = code;
  throw error;
};

/**
 * Kod błędu → status HTTP. Siedzi tutaj, przy miejscu, które te kody rzuca:
 * obie trasy panelu mapują je tak samo, a dwie odręczne kopie tej tablicy
 * rozjechałyby się przy pierwszym nowym kodzie.
 */
export const STATUS_FOR = {
  not_found: 404,
  card_exists: 409,
  invalid_time: 422,
  invalid_day: 422,
  bad_span: 422,
  bad_card: 422,
};

/** Kotwica doby — ta sama wartość, którą liczy kiosk i services/getTime.js. */
export const dayStamp = (day) =>
  dayjs(day).hour(WORKDAY_START_HOUR).minute(0).second(0).millisecond(0).format();

/**
 * "HH:mm" wpisane przez kierownika → znacznik ISO w strefie aplikacji.
 *
 * Godzina wcześniejsza niż 3:00 należy do NASTĘPNEGO dnia kalendarzowego, bo
 * doba robocza zaczyna się o 3:00 (services/workday.js). Dzięki temu zmiana
 * kończąca się o 1:00 daje się wpisać jako "22:00 – 01:00" i wychodzi z niej
 * trzygodzinna dniówka, a nie dwudziestojednogodzinna ujemna.
 */
const stampFor = (day, hhmm) => {
  const [hour] = hhmm.split(":").map(Number);
  const calendarDay = hour < WORKDAY_START_HOUR ? dayjs(day).add(1, "day").format("YYYY-MM-DD") : day;
  // Wejście w kształcie ISO bez offsetu — trzyargumentowe dayjs.tz(input, format, tz)
  // wymaga wtyczki customParseFormat, której ten projekt nie ładuje.
  return dayjs.tz(`${calendarDay}T${hhmm}:00`, APP_TZ).format();
};

/**
 * Wymiar dniówki liczony TĄ SAMĄ funkcją, której używa kiosk (utils/index.js).
 * utils/ nie dotyka bazy, więc wolno go zaimportować po stronie serwera —
 * a druga, własna implementacja rozjechałaby się z kafelkiem przy pierwszej
 * poprawce i nikt by tego nie zauważył poza kadrami.
 */
const measure = (startTime, endTime) => {
  const res = DifferenceTime(startTime, endTime);
  return { totalWorkTime: res.time, overTime: res.overtime };
};

/** Wspólna walidacja pary godzin dla korekty i dopisania karty. */
const resolveSpan = (day, body) => {
  const { value, error } = schema.validate(
    { start: body?.start, end: body?.end },
    { abortEarly: true, convert: false }
  );
  if (error) fail("invalid_time", "Godziny podaj w formacie HH:MM.");

  const startTime = stampFor(day, value.start);
  const endTime = stampFor(day, value.end);

  if (!dayjs(endTime).isAfter(dayjs(startTime))) {
    fail("bad_span", "Godzina wyjścia musi być późniejsza niż godzina wejścia.");
  }

  return { startTime, endTime, ...measure(startTime, endTime) };
};

// --- odczyt pojedynczej karty ----------------------------------------------

const stmtCard = db.prepare(`SELECT * FROM Times WHERE id = ?`);

/** @returns {object|undefined} wiersz Times razem z sekcją właściciela */
export const getCard = (id) => {
  const row = stmtCard.get(Number(id));
  return row ? { ...row, overTime: Boolean(row.overTime), autoClosed: Boolean(row.autoClosed) } : undefined;
};

// --- korekta ---------------------------------------------------------------

const stmtCorrect = db.prepare(`
  UPDATE Times
     SET startTime     = @startTime,
         endTime       = @endTime,
         totalWorkTime = @totalWorkTime,
         overTime      = @overTime,
         status        = 'finishWork',
         autoClosed    = 0,
         editedAt      = @editedAt,
         editedBy      = @editedBy,
         editedByName  = @editedByName
   WHERE id = @id`);

/**
 * Poprawa godzin istniejącej karty.
 *
 * autoClosed ZDEJMUJEMY. Flaga znaczy "tę liczbę wpisał system, bo nikt nie
 * odbił wyjścia" — a korekta kierownika jest dokładnie tym potwierdzeniem,
 * o które prosiła. Ta sama zasada rządzi wpisami zadań (services/taskEntries.js).
 *
 * Status zawsze 'finishWork': karta, którą ktoś właśnie opisał od wejścia do
 * wyjścia, jest z definicji zamknięta. Zostawienie 'workInProgress' kazałoby
 * kafelkowi wznowić licznik od poprawionej godziny.
 */
export const correctCard = ({ id, start, end, actor }) => {
  const card = getCard(id);
  if (!card) fail("not_found", "Nie ma takiej karty.");

  const day = String(card.data ?? "").slice(0, 10);
  if (!DAY_RE.test(day)) fail("bad_card", "Karta nie ma poprawnej daty.");

  const span = resolveSpan(day, { start, end });

  stmtCorrect.run({
    id: Number(id),
    ...span,
    overTime: span.overTime ? 1 : 0,
    editedAt: dayjs().tz(APP_TZ).format(),
    editedBy: Number(actor.userID),
    editedByName: actor.name,
  });

  return getCard(id);
};

// --- dopisanie brakującej karty --------------------------------------------

const stmtExists = db.prepare(`SELECT id FROM Times WHERE userID = ? AND data = ?`);

const stmtInsert = db.prepare(`
  INSERT INTO Times (userID, name, surname, section, location, data, startTime, endTime,
                     totalWorkTime, status, overTime, autoClosed, editedAt, editedBy, editedByName)
  VALUES (@userID, @name, @surname, @section, @location, @data, @startTime, @endTime,
          @totalWorkTime, 'finishWork', @overTime, 0, @editedAt, @editedBy, @editedByName)`);

/**
 * Karta za dzień, w którym pracownik w ogóle nie odbił wejścia.
 *
 * Imię, nazwisko, sekcja i lokalizacja są w Times ZDENORMALIZOWANE (spadek po
 * Airtable) i kopiujemy je z konta tak samo jak services/newDay.js — inaczej
 * wiersz wypadłby z eksportu, który filtruje po Times.section.
 *
 * Podpis (editedBy) stawiamy od razu przy zakładaniu: cała karta jest tu
 * wpisem kierownika, nie tylko jej poprawką.
 */
export const createCardForUser = ({ userID, day, start, end, owner, actor }) => {
  const { error } = daySchema.validate({ day, userID }, { abortEarly: true });
  if (error) fail("invalid_day", "Podaj poprawną datę dnia.");

  const data = dayStamp(day);
  if (stmtExists.get(Number(userID), data)) {
    fail("card_exists", "Ten pracownik ma już kartę na ten dzień — popraw istniejącą.");
  }

  const span = resolveSpan(day, { start, end });

  const info = stmtInsert.run({
    userID: Number(userID),
    name: owner.name,
    surname: owner.surname,
    section: owner.section,
    location: owner.location,
    data,
    ...span,
    overTime: span.overTime ? 1 : 0,
    editedAt: dayjs().tz(APP_TZ).format(),
    editedBy: Number(actor.userID),
    editedByName: actor.name,
  });

  return getCard(info.lastInsertRowid);
};

// --- usunięcie -------------------------------------------------------------

const stmtDelete = db.prepare(`DELETE FROM Times WHERE id = ?`);

/**
 * Twarde usunięcie. Times nie ma ani statusów, ani kolumny na notatkę, więc po
 * skasowanym wierszu nie zostaje w bazie NIC, o co można by potem zapytać —
 * ślad idzie do logu, dokładnie jak przy kasowaniu cudzego wpisu zadania
 * (pages/api/entries/[id].js).
 */
export const deleteCard = ({ id, card, actor, reason }) => {
  const removed = stmtDelete.run(Number(id)).changes > 0;

  if (removed) {
    logInfo("manageTime", "karta usunięta przez kierownika", {
      cardID: Number(id),
      ownerID: card.userID,
      data: String(card.data ?? "").slice(0, 10),
      totalWorkTime: card.totalWorkTime,
      by: actor.userID,
      reason: String(reason ?? "").trim().slice(0, 200) || "(bez powodu)",
    });
  }

  return removed;
};
