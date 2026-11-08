import { getActiveToken } from "../../../../../services/session";
import { deleteNote, getNote, noteTarget, parseNoteInput, updateNote } from "../../../../../services/employeeNotes";
import { canSeeMonthlyReports } from "../../../../../services/roles";

// Jedna notatka kierownika.
//
//  PATCH  { noteDate, body } — poprawka
//  DELETE                    — usunięcie
//
// Czytać notatkę może każdy kierownik z sekcją pracownika w zasięgu,
// zmieniać i usuwać — wyłącznie autor.

// eslint-disable-next-line import/no-anonymous-default-export
export default async (req, res) => {
  const token = await getActiveToken(req);
  if (!token) {
    return res.status(401).json({ error: "not_authorized" });
  }
  if (!canSeeMonthlyReports(token.role)) {
    return res.status(403).json({ error: "permission_denied" });
  }
  if (req.method !== "PATCH" && req.method !== "DELETE") {
    res.setHeader("Allow", "PATCH, DELETE");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const { id } = req.query;
  const note = /^\d+$/.test(id || "") ? getNote(id) : null;
  if (!note || !(await noteTarget(token, note.userID))) {
    return res.status(404).json({ error: "not_found", message: "Nie ma takiej notatki." });
  }
  if (Number(note.createdBy) !== Number(token.userID)) {
    return res.status(403).json({ error: "not_author", message: "Notatkę może zmienić tylko jej autor." });
  }

  if (req.method === "DELETE") {
    deleteNote(note.id);
    return res.status(200).json({ ok: true });
  }

  const input = parseNoteInput(req.body);
  if (input.error) {
    return res.status(400).json({ error: "bad_note", message: input.error });
  }
  return res.status(200).json({ note: updateNote(note.id, input) });
};
