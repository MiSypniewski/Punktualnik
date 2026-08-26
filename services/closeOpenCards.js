import dayjs from "dayjs";
import db from "./db";
import { logInfo } from "./log";

// Domykanie kart czasu zapomnianych na kiosku.
//
// components/card.js zapisuje status `workInProgress` w chwili odbicia wejścia
// i zmienia go na `finishWork` dopiero przy drugim dotknięciu kafelka. Jeśli
// nikt tego kafelka nie dotknie — a to się zdarza codziennie — wpis zostaje
// otwarty NA ZAWSZE: nie ma go w żadnym raporcie jako dniówki, a na tablicy
// wisi z licznikiem lecącym trzecią dobę.
//
// Odpowiednikiem w module zadań jest closeStaleEntries (services/taskEntries.js),
// ale reguła domknięcia jest tu INNA i to jest świadome. Tam wpis zamyka się na
// granicy doby roboczej, bo timer zadania mierzy czas faktycznie spędzony przy
// robocie i "do 3:00" jest najbliższą prawdą, jaką da się obronić. Tutaj karta
// mówi o dniówce, a dniówka trwająca 19 godzin jest oczywistym fałszem w
// eksporcie do kadr. Bierzemy więc godzinę, którą kiosk i tak wpisał przy
// wejściu: start + 8 h. To nadal ZGADYWANIE, stąd flaga autoClosed i znacznik
// "auto" na kafelku — wpis czeka na potwierdzenie kierownika.

// Ile trwa domyślna dniówka. Ta sama liczba, którą components/card.js podstawia
// jako endTime przy odbiciu wejścia i którą utils/DifferenceTime traktuje jako
// granicę nadgodzin.
const WORKDAY_HOURS = 8;

const stmtOpen = db.prepare(`
  SELECT id, userID, name, surname, section, data, startTime
    FROM Times
   WHERE status IN ('workInProgress', 'overTime')
     AND substr(data, 1, 10) <= @day`);

const stmtClose = db.prepare(`
  UPDATE Times
     SET endTime       = @endTime,
         totalWorkTime = @totalWorkTime,
         status        = 'finishWork',
         overTime      = 1,
         autoClosed    = 1
   WHERE id = @id AND status IN ('workInProgress', 'overTime')`);

/**
 * Domyka karty otwarte w dobie `day` i wcześniejszych.
 *
 * Warunek jest `<=`, a nie `=`, celowo: jeden nieudany przebieg (proces leżał,
 * baza była zajęta) nie może zostawić karty otwartej do końca świata.
 *
 * Godzinę zakończenia liczymy W JS, a nie w SQL. Times.startTime to pełne ISO
 * z offsetem strefy ("2026-08-26T07:12:00+02:00"), a SQLite-owe datetime()
 * przeliczyłoby to na UTC i zgubiło offset — kolumna rozjechałaby się formatem
 * z resztą tabeli, na której stoi dosłowne porównanie w services/getTime.js.
 *
 * @param {string} day doba robocza 'YYYY-MM-DD'
 * @returns {number} ile kart domknięto (zwykle 0)
 */
export const closeOpenCards = (day) => {
  const open = stmtOpen.all({ day });
  if (open.length === 0) return 0;

  const closeAll = db.transaction((rows) => {
    let changed = 0;
    for (const row of rows) {
      // Karta bez godziny wejścia nie ma od czego liczyć ośmiu godzin. Taki
      // wiersz zostawiamy, żeby nie wpisać do ewidencji liczby wziętej znikąd.
      if (!row.startTime) continue;

      changed += stmtClose.run({
        id: row.id,
        endTime: dayjs(row.startTime).add(WORKDAY_HOURS, "hour").format(),
        totalWorkTime: `0${WORKDAY_HOURS}:00:00`,
      }).changes;
    }
    return changed;
  });

  const changed = closeAll(open);
  if (changed > 0) {
    logInfo("closeOpenCards", "domknięto karty zapomniane na kiosku", { day, changed });
  }
  return changed;
};

/**
 * Karty domknięte automatycznie w podanej dobie — adresaci powiadomienia.
 * Pytamy BAZĘ o stan po fakcie, zamiast wierzyć zwrotce closeOpenCards:
 * dzięki temu powiadomienie idzie także wtedy, gdy kartę domknął wcześniejszy,
 * nieudany albo częściowy przebieg.
 */
const stmtAutoClosed = db.prepare(`
  SELECT t.id, t.userID, t.name, t.surname, t.section, t.data,
         t.startTime, t.endTime, t.totalWorkTime, u.email
    FROM Times t
    LEFT JOIN Users u ON u.id = t.userID
   WHERE t.autoClosed = 1 AND substr(t.data, 1, 10) = @day
   ORDER BY t.surname, t.name`);

export const getAutoClosedCards = (day) => stmtAutoClosed.all({ day });

export default closeOpenCards;
