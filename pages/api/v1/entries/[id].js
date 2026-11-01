import { apiRoute, logApiWrite } from "../../../../services/apiAuth";
import { hasProjectId, projectProblem, publicEntry } from "../../../../services/apiEntries";
import { deleteEntry, getEntry, updateEntry } from "../../../../services/taskEntries";
import { now as appNow, workDay } from "../../../../services/workday";

export const config = { api: { bodyParser: { sizeLimit: "16kb" } } };

// Wpis właściciela klucza. Cudzy i nieistniejący dają to samo 404, żeby przez API
// nie dało się sprawdzać, które identyfikatory istnieją.
const ownEntry = (req, res, token) => {
  const { id } = req.query;
  const entry = /^\d+$/.test(id || "") ? getEntry(id) : null;
  if (!entry || Number(entry.userID) !== Number(token.userID)) {
    res.status(404).json({ error: "not_found" });
    return null;
  }
  return entry;
};

export default apiRoute("api/v1/entries/[id]", {
  GET: {
    scope: "read",
    handle: (req, res, { token }) => {
      const entry = ownEntry(req, res, token);
      return entry ? res.status(200).json({ entry: publicEntry(entry) }) : undefined;
    },
  },

  // Pełna podmiana wpisu zamkniętego, jak formularz edycji w panelu.
  PUT: {
    scope: "entries:write",
    handle: (req, res, { token, key, body }) => {
      const entry = ownEntry(req, res, token);
      if (!entry) return undefined;

      // updateEntry ustawia endedAt, więc na biegnącym wpisie po cichu zamknąłby timer.
      if (entry.endedAt === null) return res.status(409).json({ error: "entry_running" });

      const { projectID, description, data, from, to } = body;
      if (!hasProjectId(projectID)) return res.status(400).json({ error: "bad_project" });

      const keepsProject = Number(projectID) === Number(entry.projectID);
      const problem = projectProblem(token, projectID, { keepsProject });
      if (problem) return res.status(problem.status).json({ error: problem.error });

      if (String(data ?? "") > workDay(appNow())) {
        return res.status(422).json({ error: "future_entry" });
      }

      const updated = updateEntry(
        entry.id,
        { projectID, description, data, from, to },
        { userID: token.userID, enforceWindow: true }
      );
      logApiWrite("wpis zmieniony", key, { entryID: entry.id, data: updated.data });
      return res.status(200).json({ entry: publicEntry(updated) });
    },
  },

  DELETE: {
    scope: "entries:delete",
    handle: (req, res, { token, key }) => {
      const entry = ownEntry(req, res, token);
      if (!entry) return undefined;

      if (!deleteEntry({ id: entry.id, userID: token.userID, enforceWindow: true })) {
        return res.status(409).json({ error: "edit_window_closed" });
      }
      // Kasowanie jest twarde, więc po wpisie zostaje wyłącznie ta linia w logu.
      logApiWrite("wpis usunięty", key, { entryID: entry.id, data: entry.data, seconds: entry.seconds });
      return res.status(200).json({ status: "deleted" });
    },
  },
});
