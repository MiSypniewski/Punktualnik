import db from "./db";
import { POOL_KINDS } from "./absenceKinds";

// Pula urlopu: ile dni przydzielono, ile wykorzystano, ile zostało.
//
// Rozliczana ROCZNIE — urlop w Polsce należy się za rok kalendarzowy, a dni
// zaległe kierownik dopisuje jako osobny przydział na nowy rok. Bez tego podziału
// po dwóch latach nikt nie odpowie, ile dni zostało z bieżącego roku.

// Lista rodzajów zdejmujących dni składana z absenceKinds.js — tak samo jak
// overtimeBalanceSql.js składa znak z kindSign. Interpolacja jest bezpieczna,
// bo klucze są stałymi z kodu, nigdy danymi z żądania.
const POOL_KINDS_SQL = POOL_KINDS.map((k) => `'${k}'`).join(", ");

// Wykorzystanie liczą WYŁĄCZNIE wnioski zatwierdzone i wyłącznie rodzaje
// z usesPool: L4 i urlop bezpłatny nie ruszają puli wypoczynkowej.
const USED_SQL = `
  COALESCE(SUM(CASE WHEN a.status = 'approved' AND a.kind IN (${POOL_KINDS_SQL})
                    THEN a.workDays ELSE 0 END), 0)`;

const stmtAllowance = db.prepare(`
  SELECT COALESCE(SUM(days), 0) AS granted
    FROM LeaveAllowance WHERE userID = @userID AND year = @year`);

const stmtUsed = db.prepare(`
  SELECT ${USED_SQL} AS used
    FROM Absences a WHERE a.userID = @userID AND a.year = @year`);

// Oczekujące pokazujemy osobno: nie zdejmują jeszcze dni, ale pracownik ma
// wiedzieć, że coś jest w drodze, zanim złoży kolejny wniosek.
const stmtPending = db.prepare(`
  SELECT COALESCE(SUM(CASE WHEN a.kind IN (${POOL_KINDS_SQL}) THEN a.workDays ELSE 0 END), 0) AS days,
         COUNT(*) AS count
    FROM Absences a
   WHERE a.userID = @userID AND a.year = @year AND a.status = 'pending'`);

/**
 * @returns {{granted: number, used: number, left: number, pendingDays: number, pendingCount: number}}
 *   `left` bywa ujemne — pula może zejść poniżej zera, bo kierownik świadomie
 *   zatwierdza urlop na poczet przyszłego przydziału.
 */
export const getLeaveBalance = (userID, year) => {
  const params = { userID: Number(userID), year: Number(year) };
  const { granted } = stmtAllowance.get(params);
  const { used } = stmtUsed.get(params);
  const pending = stmtPending.get(params);

  return {
    granted,
    used,
    left: granted - used,
    pendingDays: pending.days,
    pendingCount: pending.count,
  };
};

// Zestawienie zespołu. Trzy pułapki, które opisuje getOvertimeBalances.js,
// obowiązują tu tak samo i dlatego zapytanie wygląda właśnie tak:
//
//  1. LEFT JOIN, nie JOIN — kto nie brał ani dnia urlopu, ma się pokazać z pełną
//     pulą, a nie zniknąć z listy.
//  2. Filtr statusu i roku siedzi w CASE WEWNĄTRZ SUM, nie w WHERE. W WHERE
//     zamieniłby LEFT JOIN z powrotem w zwykły i wyciął wszystkich bez wpisów.
//  3. u.role <> 'editor' — kiosk jest kontem współdzielonym, nie osobą, i nie ma
//     własnego urlopu.
//
// Przydziały idą PODZAPYTANIEM, a nie drugim LEFT JOIN-em: dwa JOIN-y do tabel
// "wiele" pomnożyłyby się wzajemnie i każdy dzień urlopu policzyłby się tyle
// razy, ile pracownik ma przydziałów.
const query = (sectionsWhere) => `
  SELECT
    u.id, u.name, u.surname, u.section, u.location,
    COALESCE((SELECT SUM(l.days) FROM LeaveAllowance l
               WHERE l.userID = u.id AND l.year = @year), 0) AS granted,
    ${USED_SQL} AS used,
    COALESCE(SUM(CASE WHEN a.status = 'pending' THEN 1 ELSE 0 END), 0) AS pendingCount
  FROM Users u
  LEFT JOIN Absences a ON a.userID = u.id AND a.year = @year
  WHERE u.isActive = 1 AND u.role <> 'editor'${sectionsWhere}
  GROUP BY u.id
  ORDER BY u.surname, u.name`;

const cache = new Map();

/**
 * @param {string[]} [sections] undefined = wszyscy, [] = nikt
 * @param {number} year
 */
export const getLeaveBalances = (sections, year) => {
  if (Array.isArray(sections) && sections.length === 0) return [];

  const count = Array.isArray(sections) ? sections.length : 0;

  let stmt = cache.get(count);
  if (!stmt) {
    const where =
      count > 0
        ? ` AND u.section IN (${Array.from({ length: count }, (_, i) => `@sec${i}`).join(", ")})`
        : "";
    stmt = db.prepare(query(where));
    cache.set(count, stmt);
  }

  const params = { year: Number(year) };
  if (count > 0) sections.forEach((s, i) => (params[`sec${i}`] = s));

  return stmt.all(params).map((r) => ({ ...r, left: r.granted - r.used }));
};

export default getLeaveBalance;
