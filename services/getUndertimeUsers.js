import db from "./db";
import { signedMinutesSql } from "./overtimeBalanceSql";

// Pracownicy, których saldo nadgodzin jest na tyle ujemne, że wymaga pokrycia
// urlopem — lista adresatów cotygodniowego przypomnienia
// (services/weeklyUndertimeJob.js).
//
// Osobne zapytanie zamiast getOvertimeBalances(): tamto NIE zwraca kolumny
// `email`, a dołożenie jej tam wypchnęłoby adresy całego zespołu do propsów
// strony kierownika. Wysyłce potrzebny jest adres, panelowi nie.
//
// Reszta warunków jest przepisana z getOvertimeBalances.js świadomie, żeby obie
// listy liczyły saldo tak samo:
//   - LEFT JOIN, a filtr statusu w CASE wewnątrz SUM — w WHERE zamieniłby
//     LEFT JOIN z powrotem w zwykły JOIN;
//   - bez kont `editor` (wspólny kiosk, nie człowiek);
//   - znak wyłącznie z signedMinutesSql (services/overtimeBalanceSql.js).
// Dochodzi warunek na adres: pracownik bez maila nie jest adresatem, a pusty
// wiersz w To zamieniłby wiadomość w wysyłkę do samych kierowników.
const stmt = db.prepare(`
  SELECT
    u.id, u.name, u.surname, u.section, u.email,
    COALESCE(SUM(CASE WHEN o.status = 'approved' THEN ${signedMinutesSql("o")} ELSE 0 END), 0) AS balance
  FROM Users u
  LEFT JOIN Overtime o ON o.userID = u.id
  WHERE u.isActive = 1
    AND u.role <> 'editor'
    AND u.email IS NOT NULL
    AND TRIM(u.email) <> ''
  GROUP BY u.id
  HAVING balance <= @threshold
  ORDER BY balance ASC, u.surname, u.name`);

/**
 * @param {number} threshold próg w minutach, UJEMNY (np. -240 dla czterech godzin).
 *   Warunek jest `<=`, więc saldo równe progowi już się kwalifikuje.
 * @returns {Array<{id:number,name:string,surname:string,section:string,email:string,balance:number}>}
 */
const getUndertimeUsers = (threshold) => stmt.all({ threshold: Number(threshold) });

export default getUndertimeUsers;
