import db from "./db";
import dayjs from "dayjs";
import getUserData from "./getUserData";
import { canSeeUser } from "./scope";
import { now as appNow, TS_FORMAT, workDay } from "./workday";
import { NOTE_DATE_RE, NOTE_TEXT_MAX } from "../utils/employeeNotes";

// Notatki kierownika o pracowniku, zbierane w trakcie miesiąca — żeby przy
// ocenie wystawianej po jego końcu nie umknęło to, co działo się na początku.
// Widzi je każdy kierownik z sekcją pracownika w zasięgu; zmienia tylko autor.

export { NOTE_TEXT_MAX } from "../utils/employeeNotes";

const COLUMNS = `id, userID, month, noteDate, body, createdAt, createdBy, createdByName, updatedAt`;

const stmtGet = db.prepare(`SELECT ${COLUMNS} FROM EmployeeNotes WHERE id = ?`);

// Od najstarszej: notatki czyta się jak kronikę miesiąca, przy ocenie po kolei.
const stmtList = db.prepare(
  `SELECT ${COLUMNS} FROM EmployeeNotes WHERE userID = ? AND month = ? ORDER BY noteDate, id`
);

const stmtCount = db.prepare(
  `SELECT userID, COUNT(*) AS count, MAX(noteDate) AS lastDate FROM EmployeeNotes WHERE month = ? GROUP BY userID`
);

const stmtInsert = db.prepare(
  `INSERT INTO EmployeeNotes (userID, month, noteDate, body, createdAt, createdBy, createdByName)
   VALUES (@userID, @month, @noteDate, @body, @createdAt, @createdBy, @createdByName)`
);

const stmtUpdate = db.prepare(
  `UPDATE EmployeeNotes SET noteDate = @noteDate, month = @month, body = @body, updatedAt = @updatedAt WHERE id = @id`
);

const stmtDelete = db.prepare(`DELETE FROM EmployeeNotes WHERE id = ?`);

const stamp = () => appNow().format(TS_FORMAT);

export const getNote = (id) => stmtGet.get(Number(id)) || null;

export const listNotes = (userID, month) => stmtList.all(Number(userID), month);

/** Liczba notatek i data ostatniej, jako mapa userID → {count, lastDate}. */
export const countNotesForMonth = (month) =>
  new Map(stmtCount.all(month).map((r) => [r.userID, { count: r.count, lastDate: r.lastDate }]));

/**
 * Sama liczba notatek, jako zwykły obiekt userID → liczba (do JSON-a i propsów),
 * zawężona do podanych osób — liczniki spoza zasięgu nie mają po co wyjeżdżać.
 */
export const noteCountsForMonth = (month, userIDs) => {
  const counts = countNotesForMonth(month);
  return Object.fromEntries(userIDs.filter((id) => counts.has(id)).map((id) => [id, counts.get(id).count]));
};

/**
 * @param {{userID: number, noteDate: string, body: string}} note
 * @param {{id: number, name: string}} by
 */
export const createNote = ({ userID, noteDate, body }, by) => {
  const { lastInsertRowid } = stmtInsert.run({
    userID: Number(userID),
    month: noteDate.slice(0, 7),
    noteDate,
    body,
    createdAt: stamp(),
    createdBy: by?.id ?? null,
    createdByName: by?.name ?? null,
  });
  return getNote(lastInsertRowid);
};

export const updateNote = (id, { noteDate, body }) => {
  stmtUpdate.run({ id: Number(id), noteDate, month: noteDate.slice(0, 7), body, updatedAt: stamp() });
  return getNote(id);
};

export const deleteNote = (id) => stmtDelete.run(Number(id)).changes > 0;

// --- wspólne dla tras API ---------------------------------------------------

/**
 * Pracownik, o którym wolno pisać notatki temu zalogowanemu, albo null.
 * Zasięg po BIEŻĄCEJ sekcji (Users.section), nie po migawce: notatki są żywe.
 * Konto kiosku (editor) to nie człowiek — notatek o nim nie ma.
 */
export const noteTarget = async (token, userID) => {
  if (!/^\d+$/.test(String(userID ?? ""))) return null;
  const [user] = await getUserData(userID);
  if (!user || user.role === "editor" || !canSeeUser(token, user)) return null;
  return user;
};

/**
 * Pola notatki z żądania: {noteDate, body} albo {error} z komunikatem.
 * Data nie może wypaść w przyszłości (doba robocza aplikacji) — notatka
 * opisuje coś, co się wydarzyło.
 */
export const parseNoteInput = (input) => {
  const noteDate = String(input?.noteDate ?? "");
  const body = String(input?.body ?? "").trim();
  if (!NOTE_DATE_RE.test(noteDate) || dayjs(noteDate).format("YYYY-MM-DD") !== noteDate) {
    return { error: "Podaj datę notatki." };
  }
  if (noteDate > workDay()) return { error: "Data notatki nie może być z przyszłości." };
  if (!body) return { error: "Notatka nie może być pusta." };
  if (body.length > NOTE_TEXT_MAX) return { error: `Notatka może mieć najwyżej ${NOTE_TEXT_MAX} znaków.` };
  return { noteDate, body };
};
