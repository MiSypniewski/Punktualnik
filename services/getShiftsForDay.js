import db from "./db";
import { SHIFT_KINDS } from "./overtimeKinds";

// Zatwierdzone zgody przesuwające wyjście danego dnia — wyłącznie dla kiosku.
//
// Lustro services/getAbsencesForDay.js: kafelek odlicza do planowanego wyjścia
// (utils/index.js: plannedExit), a nie do sztywnej ósemki, więc musi znać
// "zostaję dłużej" i "wcześniejsze wyjście" z tej doby. Ekran kierownika
// (services/dayBoard.js) pyta o to samo, tylko dla wielu sekcji naraz.
//
// Tylko `approved`: wniosek oczekujący nie jest jeszcze zgodą, a kafelek ma
// odliczać do tego, co ustalone. Zawężenie po Users.section, jak nieobecności
// — kiosk pokazuje ludzi, którzy DZIŚ należą do sekcji.
//
// Wyłącznie ODCZYT: tablica jest odpytywana co LIVE_POLL_MS z każdego kiosku.
//
// Interpolacja listy rodzajów jest bezpieczna — to stała z kodu.
const stmt = db.prepare(`
  SELECT o.userID, o.kind, SUM(o.minutes) AS minutes
    FROM Overtime o
    JOIN Users u ON u.id = o.userID
   WHERE u.section = @section
     AND o.status = 'approved'
     AND o.data = @day
     AND o.kind IN (${SHIFT_KINDS.map((k) => `'${k}'`).join(", ")})
   GROUP BY o.userID, o.kind`);

/**
 * @param {string} section slug sekcji
 * @param {string} day 'YYYY-MM-DD' — doba robocza, z services/workday.js
 * @returns {Record<number, {earlyLeaveMin: number, stayLongerMin: number}>}
 *   mapa po userID; osoby bez zgód w niej nie występują
 */
export const getShiftsForDay = (section, day) => {
  const byUser = {};
  stmt.all({ section, day }).forEach((r) => {
    const entry = byUser[r.userID] || { earlyLeaveMin: 0, stayLongerMin: 0 };
    if (r.kind === "early_leave") entry.earlyLeaveMin += r.minutes;
    if (r.kind === "stay_longer") entry.stayLongerMin += r.minutes;
    byUser[r.userID] = entry;
  });
  return byUser;
};

export default getShiftsForDay;
