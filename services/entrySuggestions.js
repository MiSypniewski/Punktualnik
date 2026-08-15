import db from "./db";
import { now as appNow } from "./workday";

// Podpowiedzi zadań budowane z własnej historii pracownika.
//
// Dwa zastosowania, jedno zapytanie:
//  - przyciski "wznów" (kilka najczęstszych par projekt+opis),
//  - <datalist> przy polu opisu, filtrowany po wybranym projekcie.
//
// Sortowanie po LICZBIE powtórzeń, a dopiero potem po dacie: codzienna
// rutyna ("odprawa celna") ma wypaść wyżej niż coś, co pracownik zrobił raz
// wczoraj po południu. Bez tego lista wznowień zmieniałaby się każdego dnia
// i przestałaby być przewidywalna.

const HORIZON_DAYS = 90;
const LIMIT = 50;

const stmt = db.prepare(`
  SELECT e.projectID, e.description, p.name AS projectName, p.color AS projectColor,
         COUNT(*) AS uses, MAX(e.startedAt) AS lastUsed
    FROM TaskEntries e
    JOIN Projects p ON p.id = e.projectID
   WHERE e.userID = @userID
     AND e.description <> ''
     AND e.data >= @since
     AND p.isActive = 1
   GROUP BY e.projectID, e.description
   ORDER BY uses DESC, lastUsed DESC
   LIMIT ${LIMIT}`);

/**
 * @returns {{projectID: number, description: string, projectName: string,
 *            projectColor: string, uses: number, lastUsed: string}[]}
 */
export const getSuggestions = (userID, now = appNow()) =>
  stmt.all({
    userID: Number(userID),
    since: now.subtract(HORIZON_DAYS, "day").format("YYYY-MM-DD"),
  });

/**
 * Opisy pogrupowane per projekt — gotowe do wstrzyknięcia w <datalist>.
 * @returns {Record<number, string[]>}
 */
export const suggestionsByProject = (suggestions) =>
  suggestions.reduce((acc, s) => {
    (acc[s.projectID] ||= []).push(s.description);
    return acc;
  }, {});

export default getSuggestions;
