import { getActiveToken } from "../../../../../services/session";
import { createNote, listNotes, noteTarget, parseNoteInput } from "../../../../../services/employeeNotes";
import { canSeeMonthlyReports } from "../../../../../services/roles";
import { MONTH_RE } from "../../../../../utils/monthlyReport";

// Notatki kierownika o pracowniku.
//
//  GET  ?userID&miesiac=YYYY-MM          — notatki osoby z miesiąca
//  POST { userID, noteDate, body }       — nowa notatka; miesiąc wynika z daty
//
// Pracownik spoza zasięgu i nieistniejący dają to samo 404 — jak raport.

// eslint-disable-next-line import/no-anonymous-default-export
export default async (req, res) => {
  const token = await getActiveToken(req);
  if (!token) {
    return res.status(401).json({ error: "not_authorized" });
  }
  if (!canSeeMonthlyReports(token.role)) {
    return res.status(403).json({ error: "permission_denied" });
  }
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const userID = req.method === "GET" ? req.query.userID : req.body?.userID;
  const user = await noteTarget(token, userID);
  if (!user) {
    return res.status(404).json({ error: "not_found", message: "Nie ma takiego pracownika." });
  }

  if (req.method === "GET") {
    const { miesiac } = req.query;
    if (!MONTH_RE.test(miesiac || "")) {
      return res.status(400).json({ error: "bad_month", message: "miesiac musi być w formacie YYYY-MM" });
    }
    return res.status(200).json({ notes: listNotes(user.id, miesiac) });
  }

  const input = parseNoteInput(req.body);
  if (input.error) {
    return res.status(400).json({ error: "bad_note", message: input.error });
  }

  const note = createNote({ userID: user.id, ...input }, { id: Number(token.userID), name: token.name });
  return res.status(201).json({ note });
};
