import { apiRoute } from "../../../../services/apiAuth";
import { hasProjectId, projectProblem, publicEntry } from "../../../../services/apiEntries";
import db from "../../../../services/db";
import {
  getRunningEntry,
  getRunningEntryDetail,
  retagRunningEntry,
  runningSeconds,
  setRunningStart,
  sweepStaleEntries,
} from "../../../../services/taskEntries";

export const config = { api: { bodyParser: { sizeLimit: "16kb" } } };

export default apiRoute("api/v1/timer", {
  GET: {
    scope: "read",
    handle: (req, res, { token }) => {
      sweepStaleEntries();
      const entry = getRunningEntryDetail(token.userID);
      return res.status(200).json({
        running: entry ? { ...publicEntry(entry), elapsedSec: runningSeconds(entry) } : null,
      });
    },
  },

  // Zmiana biegnącego timera. Podane pola się zmieniają, pozostałe zostają.
  // retagRunningEntry zapisuje dokładnie to, co dostanie (panel wysyła zawsze oba
  // pola), więc brak opisu w żądaniu wyczyściłby go bez tego scalania.
  PATCH: {
    scope: "timer",
    handle: (req, res, { token, body }) => {
      const has = (field) => Object.prototype.hasOwnProperty.call(body, field);
      if (!has("projectID") && !has("description") && !has("from")) {
        return res.status(400).json({ error: "nothing_to_change" });
      }

      const running = getRunningEntry(token.userID);
      if (!running) return res.status(409).json({ error: "not_running" });

      const projectID = has("projectID") ? body.projectID : running.projectID;
      if (has("projectID") && projectID !== null) {
        if (!hasProjectId(projectID)) return res.status(400).json({ error: "bad_project" });
        const keepsProject = Number(projectID) === Number(running.projectID);
        const problem = projectProblem(token, projectID, { keepsProject });
        if (problem) return res.status(problem.status).json({ error: problem.error });
      }

      // W jednej transakcji: błędny opis nie może zostawić przesuniętego startu.
      db.transaction(() => {
        if (has("from")) setRunningStart({ id: running.id, userID: token.userID, from: body.from });
        if (has("projectID") || has("description")) {
          retagRunningEntry({
            id: running.id,
            userID: token.userID,
            projectID,
            description: has("description") ? body.description : running.description,
          });
        }
      })();

      const entry = getRunningEntryDetail(token.userID);
      return res.status(200).json({ running: { ...publicEntry(entry), elapsedSec: runningSeconds(entry) } });
    },
  },
});
