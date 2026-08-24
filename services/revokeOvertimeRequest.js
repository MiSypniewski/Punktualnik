import dayjs from "dayjs";
import db from "./db";

const findById = db.prepare(`SELECT * FROM Overtime WHERE id = ?`);

// Podpis dociągany z Users i zapisywany tekstem — jak w decideOvertimeRequest.js.
// Pod historycznym cofnięciem ma zostać nazwisko z chwili, w której zapadło.
const findDecider = db.prepare(`SELECT name, surname FROM Users WHERE id = ?`);

// Cofnięcie wniosku przez kierownika: pracownik zrezygnował, zgłoszenie było
// pomyłką albo zatwierdzenie poszło na czyjeś konto przez nieuwagę.
//
// Wniosek NIE ZNIKA z bazy — dostaje status 'revoked'. Saldo liczy wyłącznie
// wnioski 'approved' (services/getOvertimeBalance.js), więc odkręca się samo,
// a w historii zostaje ślad: co to było, kto cofnął i dlaczego. Skasowany wiersz
// nie odpowiedziałby na żadne z tych pytań, a przy nadgodzinach chodzi o czas,
// za który firma płaci.
//
// Warunek stanu siedzi W UPDATE, nie w osobnym SELECT przed nim — ta sama zasada
// co przy decyzji: dwie karty kierownika nie nadpiszą sobie podpisu, druga
// zmieni zero wierszy i dostanie `changed === false`.
const update = db.prepare(
  `UPDATE Overtime
   SET status = 'revoked',
       decidedAt = @decidedAt,
       decidedBy = @decidedBy,
       decidedByName = @decidedByName,
       decisionNote = @decisionNote
   WHERE id = @id AND status != 'revoked'`
);

/**
 * @param {{id: number, decidedBy: number, fallbackName?: string, reason: string}} payload
 * @returns {{changed: boolean, request: object|undefined}}
 */
const revokeOvertimeRequest = ({ id, decidedBy, fallbackName, reason }) => {
  const decider = findDecider.get(Number(decidedBy));
  const decidedByName = decider ? `${decider.name} ${decider.surname}` : fallbackName ?? null;

  const info = update.run({
    id: Number(id),
    decidedAt: dayjs().format(),
    decidedBy: Number(decidedBy),
    decidedByName,
    // Powód jest obowiązkowy i pilnuje tego warstwa API — tu zostaje tylko
    // normalizacja, żeby serwis dało się wołać także ze skryptu.
    decisionNote: String(reason ?? "").trim() || null,
  });

  return { changed: info.changes > 0, request: findById.get(Number(id)) };
};

export default revokeOvertimeRequest;
