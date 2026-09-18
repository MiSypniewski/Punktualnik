import dayjs from "dayjs";
import db from "./db";
import { now as appNow, WORKDAY_START_HOUR } from "./workday";

// Wpisy zadań zespołu z jednego dnia — tor zadań pod belką obecności na osi
// czasu ekranu /urlopy/stan.
//
// Osobny serwis i osobny endpoint (/api/entries/day), a NIE piąte zapytanie
// w services/dayBoard.js, i to jest rozstrzygnięcie o koszcie: tor zadań jest
// opcjonalny (checkbox), a tablica dnia jest odpytywana co LIVE_POLL_MS z każdej
// otwartej karty kierownika. Doklejenie wszystkich wpisów dnia do tamtej
// odpowiedzi kosztowałoby zapytanie i kilkadziesiąt kilobajtów w każdym cyklu
// także wtedy, gdy nikt toru nie ogląda.
//
// Serwis NICZEGO NIE ZAPISUJE — z tego samego powodu co dayBoard.js. W
// szczególności żadnego sweepStaleEntries(): timer zapomniany wczoraj zostaje
// tu otwarty i rysujemy go jako domknięty automatycznie, bo dokładnie tak
// skończy przy najbliższym zapisie w module zadań.
//
// Zawężenie po `Users.section` (sekcja BIEŻĄCA), nie po `TaskEntries.section`
// — to samo pytanie "kto dziś należy do mojego zespołu" i to samo uzasadnienie
// co w services/dayBoard.js i services/liveBoard.js. Inaczej wiersz osoby
// przeniesionej miałby belkę obecności bez toru zadań.

const placeholders = (count) => Array.from({ length: count }, (_, i) => `@sec${i}`).join(", ");

const cache = new Map();

// Trafia w idx_entries_user_data (userID, data) przez złączenie z Users.
const stmtEntries = (count) => {
  if (!cache.has(count)) {
    cache.set(
      count,
      db.prepare(`
        SELECT e.id, e.userID, e.description, e.startedAt, e.endedAt, e.seconds,
               e.autoClosed, e.editedByName,
               p.name AS projectName, p.client AS projectClient, p.color AS projectColor
          FROM TaskEntries e
          JOIN Users u         ON u.id = e.userID
          LEFT JOIN Projects p ON p.id = e.projectID
         WHERE e.data = @day
           AND u.isActive = 1
           AND u.section IN (${placeholders(count)})
         ORDER BY e.userID, e.startedAt`)
    );
  }
  return cache.get(count);
};

/**
 * Znacznik TaskEntries ('YYYY-MM-DD HH:mm:ss', czas lokalny BEZ offsetu) →
 * minuty od północy dnia `day`. Wpis po północy (należy do doby roboczej, która
 * kończy się o 3:00) dostaje dobę więcej, żeby odcinek szedł w prawo — tak samo
 * jak belka karty w services/dayBoard.js (spanEnd).
 *
 * Liczone NA SERWERZE z tekstu, bez przeliczania stref: znacznik już jest
 * czasem aplikacji, a przeglądarka w innej strefie przesunęłaby cały tor.
 */
const toDayMinutes = (stamp, day) => {
  const text = String(stamp ?? "");
  const h = Number(text.slice(11, 13));
  const m = Number(text.slice(14, 16));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  const extraDays = dayjs(text.slice(0, 10)).diff(dayjs(day), "day");
  return extraDays * 24 * 60 + h * 60 + m;
};

/**
 * @param {{day: string, sections: string[]}} args
 *   `day` — doba robocza 'YYYY-MM-DD' (walidację robi wołający);
 *   `sections` — zasięg z services/scope.js; pusta tablica = nikt.
 */
export const getDayTasks = ({ day, sections }) => {
  const list = Array.isArray(sections) ? sections : [];
  const nowMoment = appNow();
  const generatedAt = nowMoment.format();
  if (list.length === 0) return { day, generatedAt, entries: [] };

  const params = { day };
  list.forEach((s, i) => {
    params[`sec${i}`] = String(s);
  });

  const nowStamp = nowMoment.format("YYYY-MM-DD HH:mm:ss");
  // Koniec doby roboczej `day` — tam domknie wpis zapomniany (closeStaleEntries).
  const dayEnd = dayjs(day).add(1, "day").hour(WORKDAY_START_HOUR).minute(0).second(0);
  const dayEndStamp = dayEnd.format("YYYY-MM-DD HH:mm:ss");

  const entries = stmtEntries(list.length)
    .all(params)
    .map((e) => {
      const open = e.endedAt === null;
      // Otwarty wpis sprzed bieżącej doby już się nie skończy sam — przy
      // najbliższym zapisie w module zadań dostanie koniec doby i flagę
      // autoClosed. Pokazujemy go od razu tak, jak będzie wyglądał.
      const stale = open && nowStamp >= dayEndStamp;
      const running = open && !stale;
      const endStamp = running ? nowStamp : stale ? dayEndStamp : e.endedAt;

      return {
        id: e.id,
        userID: e.userID,
        description: e.description,
        projectName: e.projectName,
        projectClient: e.projectClient,
        projectColor: e.projectColor,
        startHm: String(e.startedAt).slice(11, 16),
        // Wpis biegnący nie ma jeszcze końca — dymek pisze wtedy "trwa".
        endHm: running ? "" : String(endStamp).slice(11, 16),
        startMin: toDayMinutes(e.startedAt, day),
        endMin: toDayMinutes(endStamp, day),
        // Obie strony w tym samym "naiwnym" kształcie, jak elapsedSeconds
        // w services/liveBoard.js — różnica nie zależy od strefy procesu.
        seconds: open ? Math.max(0, dayjs(endStamp).diff(dayjs(e.startedAt), "second")) : e.seconds ?? 0,
        running,
        autoClosed: Boolean(e.autoClosed) || stale,
        editedByName: e.editedByName,
      };
    });

  return { day, generatedAt, entries };
};

export default getDayTasks;
