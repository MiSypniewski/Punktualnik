import dayjs from "dayjs";
import db from "./db";
import { now as appNow, appTime, workDay } from "./workday";
import { getRunningEntries } from "./liveBoard";
import getAbsences from "./getAbsences";
import getOvertimeRequests from "./getOvertimeRequests";
import { getLeaveBalances } from "./leaveBalance";
import getOvertimeBalances from "./getOvertimeBalances";
import { WORKDAY_HOURS, parseHmsToSeconds } from "../utils";

// Dzień zespołu w jednym miejscu — komplet danych ekranu /urlopy/stan.
//
// Ekran spina trzy osie ewidencji, które dotąd żyły osobno: Times (kto był
// w pracy i o której), Absences (kogo nie ma) i Overtime (kto ma zgodę na
// wcześniejsze wyjście albo zostanie dłużej). Czwarta, TaskEntries, wchodzi
// tylko informacyjnie i tylko dla dnia dzisiejszego.
//
// Serwis NICZEGO NIE ZAPISUJE i tak ma zostać. Jest wołany cyklicznie
// (co LIVE_POLL_MS z każdej otwartej karty kierownika), a zapis w ścieżce
// odczytu to dokładnie ta przyczyna, która położyła serwer 21.08.2026:
// better-sqlite3 jest synchroniczne, więc kolizja o blokadę zapisu zamraża
// wszystkich naraz. Żadnego sweepStaleEntries() tutaj.
//
// Wzorzec zapytań przepisany z services/liveBoard.js: statementy przygotowane
// raz, cache w Map po LICZBIE sekcji (SQLite nie ma parametru "lista"), nazwy
// sekcji zawsze przez binding, pusty zasięg zwraca pustkę bez odpytania bazy.

// Po której godzinie brak odbitej karty przestaje znaczyć "jeszcze nie
// przyszedł" i zaczyna znaczyć "nie ma go, a miał być". Rozstrzygamy to NA
// SERWERZE, mimo że to informacja do pokazania: zegar przeglądarki bywa
// przestawiony, a od tej granicy zależy, czy wiersz zapala się na czerwono.
const LATE_PUNCH_HOUR = 9;

// Rodzaje wniosków nadgodzinowych, które przesuwają godzinę wyjścia Z FIRMY.
//
// Lista jest tu WYPISANA, a nie wyliczona ze znaku w services/overtimeKinds.js,
// i to jest świadome: `extra_work` ("praca poza godzinami, np. wieczorem
// w domu") ma znak dodatni jak `stay_longer`, ale obecności na miejscu nie
// wydłuża. Wyliczenie po znaku przesuwałoby belkę na osi o czas przepracowany
// w domu. Nowy rodzaj wniosku trafia tutaj wtedy i tylko wtedy, gdy zmienia
// godzinę wyjścia z firmy.
const SHIFT_KINDS = ["stay_longer", "early_leave"];

const placeholders = (count) => Array.from({ length: count }, (_, i) => `@sec${i}`).join(", ");

const caches = { people: new Map(), cards: new Map(), absences: new Map(), shifts: new Map() };

const cached = (bag, count, sql) => {
  if (!bag.has(count)) bag.set(count, db.prepare(sql(placeholders(count))));
  return bag.get(count);
};

// --- skład zespołu ---------------------------------------------------------
//
// Zawężenie po `Users.section`, czyli po sekcji BIEŻĄCEJ, a nie po sekcji
// zapisanej we wpisie. Ta sama decyzja i to samo uzasadnienie co
// w services/liveBoard.js: `token.section` jest zapiekany w JWT przy logowaniu,
// więc pracownik przeniesiony do innego działu zapisuje nowe karty ze STARĄ
// sekcją aż do przelogowania. Przy zawężeniu po sekcji wpisu ta sama osoba
// wisiałaby na liście dwóch kierowników naraz, a u właściwego nie miałaby karty.
// Ten ekran odpowiada na pytanie "kto DZIŚ należy do mojego zespołu".
//
// Rola i aktywność konta wg tego samego kryterium co kafelki sekcji
// (services/getUsers.js): `editor` to wspólne konto kiosku, nie człowiek.
const stmtPeople = (count) =>
  cached(
    caches.people,
    count,
    (ph) => `
      SELECT u.id AS userID, u.name, u.surname, u.section, u.location
        FROM Users u
       WHERE u.isActive = 1
         AND u.role IN ('user', 'manager')
         AND u.section IN (${ph})
       ORDER BY u.surname COLLATE NOCASE, u.name COLLATE NOCASE`
  );

// --- karty czasu tego dnia -------------------------------------------------
//
// Dopasowanie przez `substr(data, 1, 10) = @day`, a NIE przez dosłowne
// `data = ?`, którym posługuje się services/getSectionTime.js. Tamto porównanie
// zestawia pełne ISO z offsetem ("2026-08-26T03:00:00+02:00") i działa tylko
// dlatego, że kiosk pyta zawsze o dziś i zawsze tym samym offsetem. Ten ekran
// pyta o DOWOLNĄ datę — także o dzień po zmianie czasu, w którym offset był
// inny — więc jedyne poprawne porównanie jest na wyciętej dacie. Jest pod nie
// indeks wyrażeniowy `idx_times_datepart`, założony dokładnie w tym celu.
const stmtCards = (count) =>
  cached(
    caches.cards,
    count,
    (ph) => `
      SELECT t.id AS cardID, t.userID, t.startTime, t.endTime, t.totalWorkTime,
             t.status, t.autoClosed, t.editedByName
        FROM Times t
        JOIN Users u ON u.id = t.userID
       WHERE substr(t.data, 1, 10) = @day
         AND u.section IN (${ph})`
  );

// --- nieobecności obejmujące ten dzień -------------------------------------
//
// Bierzemy `approved` I `pending`, inaczej niż kiosk (services/getAbsencesForDay.js
// pyta tylko o zatwierdzone). Kiosk pokazuje STAN, a ten ekran służy do
// planowania dnia: kierownik musi wiedzieć, że ktoś może nie przyjść, jeszcze
// zanim sam to rozstrzygnie. Ta sama reguła, którą stosował segment
// "Dziś nieobecni" w panelu wniosków.
//
// Trafia w idx_absences_range (dateFrom, dateTo).
const stmtAbsences = (count) =>
  cached(
    caches.absences,
    count,
    (ph) => `
      SELECT a.userID, a.kind, a.dateFrom, a.dateTo, a.status
        FROM Absences a
        JOIN Users u ON u.id = a.userID
       WHERE a.status IN ('approved', 'pending')
         AND a.dateFrom <= @day
         AND a.dateTo >= @day
         AND u.section IN (${ph})
       ORDER BY (a.status = 'approved') DESC, a.id`
  );

// --- zgody przesuwające wyjście --------------------------------------------
//
// Tylko `approved`: wniosek oczekujący nie jest jeszcze zgodą, a planowane
// wyjście ma mówić o tym, co ustalone. Lista rodzajów pochodzi z SHIFT_KINDS,
// więc interpolacja jest tu bezpieczna — klucze są stałą z tego pliku.
const SHIFT_KIND_LIST = SHIFT_KINDS.map((k) => `'${k}'`).join(", ");

const stmtShifts = (count) =>
  cached(
    caches.shifts,
    count,
    (ph) => `
      SELECT o.userID, o.kind, SUM(o.minutes) AS minutes
        FROM Overtime o
        JOIN Users u ON u.id = o.userID
       WHERE o.status = 'approved'
         AND o.data = @day
         AND o.kind IN (${SHIFT_KIND_LIST})
         AND u.section IN (${ph})
       GROUP BY o.userID, o.kind`
  );

// --- pomocnicze ------------------------------------------------------------

/** Karta z odbitym wejściem. Status `wait` znaczy "wiersz jest, dotknięcia nie było". */
const hasPunch = (card) => Boolean(card && card.startTime && card.status !== "wait");

const isOpen = (card) => card.status === "workInProgress" || card.status === "overTime";

/**
 * 'HH:mm' → minuty od północy. Osią czasu rządzi geometria, a nie znaczniki,
 * więc pozycję belki liczymy TU, z godziny już przeliczonej na strefę
 * aplikacji (appTime). Gdyby przeglądarka dostała surowy znacznik i liczyła
 * sama, komputer kierownika w innej strefie przesunąłby cały wykres.
 */
const toMinutes = (hm) => {
  const [h, m] = String(hm ?? "").split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
};

/**
 * Koniec przed początkiem znaczy zmianę przechodzącą przez północ (22:00–01:00),
 * a nie błąd — doba robocza zaczyna się o 3:00, więc taka karta jest poprawna.
 * Dla osi czasu doliczamy dobę, żeby belka szła w prawo, a nie zawijała się.
 */
const spanEnd = (startMin, endMin) =>
  startMin !== null && endMin !== null && endMin < startMin ? endMin + 24 * 60 : endMin;

/**
 * @param {string[]} sections zasięg z services/scope.js
 * @param {string} day 'YYYY-MM-DD'
 */
const readDay = (sections, day) => {
  const count = sections.length;
  const params = {};
  sections.forEach((s, i) => {
    params[`sec${i}`] = String(s);
  });
  const withDay = { ...params, day };

  // Wszystkie odczyty w JEDNEJ transakcji: między zapytaniem o karty
  // i o nieobecności ktoś mógłby odbić wejście albo kierownik zatwierdzić
  // urlop, a wtedy ta sama osoba wyszłaby na ekranie jako nieobecna bez karty
  // i jako pracująca naraz. W better-sqlite3 transakcja jest synchroniczna
  // i praktycznie darmowa.
  const read = db.transaction(() => ({
    people: stmtPeople(count).all(params),
    cards: stmtCards(count).all(withDay),
    absences: stmtAbsences(count).all(withDay),
    shifts: stmtShifts(count).all(withDay),
  }));

  return read();
};

/**
 * Komplet danych ekranu "Aktualny stan".
 *
 * @param {{day: string, sections: string[]}} args
 *   `day` — doba robocza 'YYYY-MM-DD' (walidację robi wołający);
 *   `sections` — zasięg z services/scope.js. Pusta tablica = nikt, nigdy
 *   "wszystko": kierownik bez przypisań w ManagerSections nie widzi nikogo.
 */
export const getDayBoard = ({ day, sections }) => {
  const list = Array.isArray(sections) ? sections : [];
  const nowMoment = appNow();
  const today = workDay(nowMoment);
  const isToday = day === today;
  const isFuture = day > today;
  const generatedAt = nowMoment.format();
  const nowMin = nowMoment.hour() * 60 + nowMoment.minute();

  const empty = {
    day,
    today,
    isToday,
    isFuture,
    nowMin,
    generatedAt,
    people: [],
    counts: { working: 0, done: 0, absent: 0, noCard: 0, pending: 0 },
    pending: { absences: [], overtime: [] },
    leaveLeft: {},
  };

  if (list.length === 0) return empty;

  const { people, cards, absences, shifts } = readDay(list, day);

  const cardByUser = new Map(cards.map((c) => [c.userID, c]));

  // Pierwsza z listy wygrywa, a lista jest posortowana zatwierdzonymi do przodu
  // — nakładające się nieobecności jednej osoby są blokowane przy zapisie
  // (services/createAbsence.js, kod `overlap`), ale kontrola patrzy tylko na
  // `pending` i `approved` tego samego pracownika, więc równoległy wniosek
  // oczekujący obok zatwierdzonego jest możliwy. Wtedy faktem jest zatwierdzony.
  const absenceByUser = new Map();
  absences.forEach((a) => {
    if (!absenceByUser.has(a.userID)) absenceByUser.set(a.userID, a);
  });

  const shiftByUser = new Map();
  shifts.forEach((s) => {
    const entry = shiftByUser.get(s.userID) || { earlyLeaveMin: 0, stayLongerMin: 0 };
    if (s.kind === "early_leave") entry.earlyLeaveMin += s.minutes;
    if (s.kind === "stay_longer") entry.stayLongerMin += s.minutes;
    shiftByUser.set(s.userID, entry);
  });

  // Biegnące timery tylko dla dziś — "teraz robi" nie ma sensu dla wczoraj,
  // a dla jutra nie istnieje. Poza dzisiejszym dniem oszczędza to zapytanie
  // przy każdym wejściu na stronę.
  const runningByUser = new Map();
  if (isToday) {
    getRunningEntries(list).forEach((r) => runningByUser.set(r.userID, r));
  }

  // Salda: jedna wartość na osobę, do drobnego podpisu przy nazwisku. Saldo
  // nadgodzin to stan NARASTAJĄCY, bez własnej daty — nie ma nic wspólnego
  // z wnioskiem o wcześniejsze wyjście z tego dnia i nie wolno go mieszać
  // z godzinami.
  const balanceByUser = new Map(getOvertimeBalances(list).map((r) => [r.id, r.balance]));

  const counts = { working: 0, done: 0, absent: 0, noCard: 0, pending: 0 };

  const rows = people.map((person) => {
    const rawCard = cardByUser.get(person.userID);
    const card = hasPunch(rawCard) ? rawCard : null;
    const absence = absenceByUser.get(person.userID) || null;
    const approvedAbsence = absence && absence.status === "approved";
    const { earlyLeaveMin = 0, stayLongerMin = 0 } = shiftByUser.get(person.userID) || {};
    const shiftMin = stayLongerMin - earlyLeaveMin;

    let state;
    if (card) state = approvedAbsence ? "absent_present" : isOpen(card) ? "working" : "done";
    else if (approvedAbsence) state = "absent";
    else if (absence) state = "pending_absence";
    else state = "no_card";

    // Planowane wyjście: start + 8 h ± zatwierdzone zgody. To PROGNOZA, nie plan
    // z grafiku — aplikacja nie wie, o której kto ma zaczynać ani kończyć, więc
    // jedyne, od czego da się liczyć, jest faktyczne odbicie wejścia.
    //
    // Świadomie NIE bierzemy tu Times.endTime, choć na karcie otwartej ono już
    // stoi: components/card.js wpisuje przy odbiciu wejścia "start + 8 h"
    // i nie zna wniosków o wcześniejsze wyjście, więc dla kogoś z podpisaną
    // zgodą kłamałoby o godzinę.
    const open = Boolean(card) && isOpen(card);
    const plannedStamp =
      open && card.startTime
        ? dayjs(card.startTime).add(WORKDAY_HOURS, "hour").add(shiftMin, "minute").format()
        : null;

    const startHm = card ? appTime(card.startTime) : "";
    const endHm = open ? appTime(plannedStamp) : card && card.endTime ? appTime(card.endTime) : "";

    const startMin = card ? toMinutes(startHm) : null;
    const endMin = spanEnd(startMin, endHm ? toMinutes(endHm) : null);

    // Wymiar: karta zamknięta ma go w bazie jako tekst, karta otwarta jeszcze
    // nie — dla niej liczymy sekundy na serwerze, żeby przeglądarka miała od
    // czego tykać, nie znając offsetu znaczników.
    const workedSec = open
      ? Math.max(0, nowMoment.diff(dayjs(card.startTime), "second"))
      : card
      ? parseHmsToSeconds(card.totalWorkTime)
      : 0;

    // `pending_absence` wpada do "nie odbili" razem z `no_card` i to jest
    // poprawne: wniosek oczekujący nie jest nieobecnością, a karty tak czy
    // inaczej nie ma. Sam wiersz nosi chip "wniosek oczekuje", więc kierownik
    // widzi różnicę — kafel liczy tylko ludzi, których dziś brakuje.
    if (state === "working" || state === "absent_present") counts.working += 1;
    else if (state === "done") counts.done += 1;
    else if (state === "absent") counts.absent += 1;
    else counts.noCard += 1;

    return {
      ...person,
      state,
      cardID: card ? card.cardID : null,
      startHm,
      endHm,
      startMin,
      endMin,
      endIsPlanned: open,
      workedSec,
      full: workedSec >= WORKDAY_HOURS * 3600,
      autoClosed: Boolean(card && card.autoClosed),
      editedByName: card ? card.editedByName : null,
      absence: absence
        ? { kind: absence.kind, dateFrom: absence.dateFrom, dateTo: absence.dateTo, status: absence.status }
        : null,
      earlyLeaveMin,
      stayLongerMin,
      balanceMin: balanceByUser.get(person.userID) ?? 0,
      // Brak karty przestaje być "jeszcze nie przyszedł" po LATE_PUNCH_HOUR,
      // a dla dnia minionego jest tym od razu. Dla przyszłego nie jest niczym.
      latePunch: state === "no_card" && !isFuture && (!isToday || nowMoment.hour() >= LATE_PUNCH_HOUR),
      running: runningByUser.get(person.userID) || null,
    };
  });

  const pendingAbsences = getAbsences({ status: "pending", sections: list });
  const pendingOvertime = getOvertimeRequests({ status: "pending", sections: list });
  counts.pending = pendingAbsences.length + pendingOvertime.length;

  // Pozostałe dni z puli — do ostrzeżenia "po zatwierdzeniu zostanie −3 dni".
  //
  // Klucz jest parą `rok:userID`, a nie samym userID, bo pula rozlicza się na
  // ROK KALENDARZOWY (Absences.year z daty początkowej) i w grudniu na liście
  // stoją obok siebie wnioski z dwóch salad. Pytamy o tyle roczników, ile ich
  // realnie na liście — zwykle jeden.
  const years = [...new Set(pendingAbsences.map((a) => a.year))];
  const leaveLeft = {};
  years.forEach((year) => {
    getLeaveBalances(list, year).forEach((r) => {
      leaveLeft[`${year}:${r.id}`] = r.left;
    });
  });

  return {
    ...empty,
    people: rows,
    counts,
    pending: { absences: pendingAbsences, overtime: pendingOvertime },
    leaveLeft,
  };
};

export default getDayBoard;
