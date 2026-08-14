import db from "./db";
import { signedMinutesSql } from "./overtimeBalanceSql";

// Saldo = suma wyłącznie ZATWIERDZONYCH wniosków. Oczekujące i odrzucone
// nie ruszają salda, więc pracownik od razu widzi, co jest już rozliczone.
const stmt = db.prepare(
  `SELECT COALESCE(SUM(${signedMinutesSql()}), 0) AS balance
   FROM Overtime
   WHERE userID = @userID AND status = 'approved'`
);

/** @returns {number} saldo w minutach (może być ujemne) */
const getOvertimeBalance = (userID) => stmt.get({ userID: Number(userID) }).balance;

export default getOvertimeBalance;
