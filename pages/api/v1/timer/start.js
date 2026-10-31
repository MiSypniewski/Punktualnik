import { apiRoute } from "../../../../services/apiAuth";
import { hasProjectId, projectProblem, publicEntry } from "../../../../services/apiEntries";
import { startEntry, sweepStaleEntries, switchEntry } from "../../../../services/taskEntries";

export const config = { api: { bodyParser: { sizeLimit: "16kb" } } };

export default apiRoute("api/v1/timer/start", {
  POST: {
    scope: "timer",
    handle: (req, res, { token, key, body }) => {
      const { projectID, description, replaceRunning } = body;

      // Projekt jest opcjonalny jak w panelu, a kompletu pilnuje dopiero stop.
      if (projectID !== undefined && projectID !== null) {
        if (!hasProjectId(projectID)) return res.status(400).json({ error: "bad_project" });
        const problem = projectProblem(token, projectID);
        if (problem) return res.status(problem.status).json({ error: problem.error });
      }

      sweepStaleEntries();

      const payload = {
        userID: token.userID,
        projectID,
        description,
        section: token.section,
        apiKeyID: key.id,
      };

      // Przełączenie tylko na jawne życzenie, inaczej biegnący timer daje 409.
      if (replaceRunning === true) {
        const { entry, stopped, discarded } = switchEntry(payload);
        return res.status(201).json({ entry: publicEntry(entry), stopped: publicEntry(stopped), discarded });
      }
      return res.status(201).json({ entry: publicEntry(startEntry(payload)) });
    },
  },
});
