import db from "./db";
import { signedMinutesSql } from "./overtimeBalanceSql";

// Zestawienie sald wszystkich aktywnych pracowników.
//
// LEFT JOIN, a nie JOIN — inaczej z listy zniknęliby ci, którzy nigdy nie
// złożyli wniosku, a kierownik ma widzieć cały zespół (saldo 0 to też
// informacja). Filtr statusu musi siedzieć w CASE wewnątrz SUM, a nie w WHERE:
// w WHERE zamieniłby LEFT JOIN z powrotem w zwykły JOIN i wyciął zerowe salda.
// Do salda liczą się tylko wnioski zatwierdzone; oczekujące tylko zliczamy.
const stmt = db.prepare(
  `SELECT
     u.id, u.name, u.surname, u.section, u.location,
     COALESCE(SUM(CASE WHEN o.status = 'approved' THEN ${signedMinutesSql("o")} ELSE 0 END), 0) AS balance,
     COALESCE(SUM(CASE WHEN o.status = 'pending' THEN 1 ELSE 0 END), 0) AS pendingCount
   FROM Users u
   LEFT JOIN Overtime o ON o.userID = u.id
   WHERE u.isActive = 1
   GROUP BY u.id
   ORDER BY u.surname, u.name`
);

const getOvertimeBalances = () => stmt.all();

export default getOvertimeBalances;
