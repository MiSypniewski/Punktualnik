import { OVERTIME_KINDS } from "./overtimeKinds";

// Jedyne miejsce, w którym znak wniosku trafia do SQL-a. Lista rodzajów
// odejmujących jest generowana z OVERTIME_KINDS, więc dodanie nowego rodzaju
// wymaga zmiany tylko w overtimeKinds.js — nie ma czego zapomnieć tutaj.
//
// Interpolacja stringów jest tu bezpieczna: klucze pochodzą ze stałej w kodzie,
// nigdy z danych użytkownika (parametry i tak nie mogą wejść w listę IN).
const negativeKinds = Object.entries(OVERTIME_KINDS)
  .filter(([, v]) => v.sign < 0)
  .map(([key]) => `'${key}'`);

/**
 * Wyrażenie SQL zwracające minuty ze znakiem (dodatnie = przybywa nadgodzin).
 * @param {string} alias prefiks tabeli, np. "o" dla `Overtime o`; "" gdy bez aliasu.
 */
export const signedMinutesSql = (alias = "") => {
  const p = alias ? `${alias}.` : "";
  if (negativeKinds.length === 0) return `${p}minutes`;
  return `CASE WHEN ${p}kind IN (${negativeKinds.join(", ")}) THEN -${p}minutes ELSE ${p}minutes END`;
};
