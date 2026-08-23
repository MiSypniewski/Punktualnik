import db from "./db";

// Kto z sekcji jest nieobecny danego dnia — wyłącznie dla kiosku.
//
// Liczą się tylko nieobecności ZATWIERDZONE: wniosek czekający na decyzję nie
// jest jeszcze faktem, a karta w kiosku ma pokazywać stan, nie zamiary.
//
// Zawężamy po Users.section, a nie po sekcji zapisanej we wpisie — nieobecność
// jej zresztą nie ma. Ta sama decyzja co w services/liveBoard.js: kiosk pokazuje
// ludzi, którzy DZIŚ należą do sekcji.
const stmt = db.prepare(`
  SELECT a.userID, a.kind, a.dateFrom, a.dateTo
    FROM Absences a
    JOIN Users u ON u.id = a.userID
   WHERE u.section = @section
     AND a.status = 'approved'
     AND a.dateFrom <= @day
     AND a.dateTo >= @day`);

/**
 * @param {string} section slug sekcji
 * @param {string} day 'YYYY-MM-DD' — doba robocza, z services/workday.js
 * @returns {Record<number, {kind: string, dateFrom: string, dateTo: string}>}
 *   mapa po userID, żeby budowanie kart było wyszukiwaniem, a nie przeszukiwaniem
 *   tablicy dla każdego pracownika z osobna
 */
export const getAbsencesForDay = (section, day) =>
  Object.fromEntries(
    stmt.all({ section, day }).map((r) => [r.userID, { kind: r.kind, dateFrom: r.dateFrom, dateTo: r.dateTo }])
  );

export default getAbsencesForDay;
