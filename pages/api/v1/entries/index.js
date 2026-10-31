import dayjs from "dayjs";
import { apiRoute, logApiWrite } from "../../../../services/apiAuth";
import { hasProjectId, projectProblem, publicEntry } from "../../../../services/apiEntries";
import { createManualEntry, getEntriesForUser, sweepStaleEntries } from "../../../../services/taskEntries";
import { now as appNow, workDay } from "../../../../services/workday";
import { isIsoDate } from "../../../../utils";

export const config = { api: { bodyParser: { sizeLimit: "16kb" } } };

// Duże zakresy dat to znane wąskie gardło tej aplikacji na 1 GB bez swapu.
const MAX_RANGE_DAYS = 31;

export default apiRoute("api/v1/entries", {
  GET: {
    scope: "read",
    handle: (req, res, { token }) => {
      const today = workDay(appNow());
      const from = req.query.from ?? today;
      const to = req.query.to ?? from;

      if (!isIsoDate(from) || !isIsoDate(to) || from > to) {
        return res.status(400).json({ error: "bad_range" });
      }
      if (dayjs(to).diff(dayjs(from), "day") >= MAX_RANGE_DAYS) {
        return res.status(400).json({ error: "range_too_long", maxDays: MAX_RANGE_DAYS });
      }

      sweepStaleEntries();
      return res.status(200).json({
        from,
        to,
        entries: getEntriesForUser({ userID: token.userID, from, to }).map(publicEntry),
      });
    },
  },

  // Wpis ręczny. Okno "dziś i wczoraj" obowiązuje każdego właściciela klucza, także
  // kierownika: wyciek klucza nie może pozwolić na przepisanie historii.
  POST: {
    scope: "entries:write",
    handle: (req, res, { token, key, body }) => {
      const { projectID, description, data, from, to } = body;

      if (!hasProjectId(projectID)) return res.status(400).json({ error: "bad_project" });
      const problem = projectProblem(token, projectID);
      if (problem) return res.status(problem.status).json({ error: problem.error });

      // Okno pilnuje tylko dolnej granicy. Automat nie ma zaśmiecać przyszłych dni.
      if (String(data ?? "") > workDay(appNow())) {
        return res.status(422).json({ error: "future_entry" });
      }

      const entry = createManualEntry(
        { projectID, description, data, from, to },
        { userID: token.userID, section: token.section, enforceWindow: true, apiKeyID: key.id }
      );
      logApiWrite("wpis utworzony", key, { entryID: entry.id, data: entry.data });
      return res.status(201).json({ entry: publicEntry(entry) });
    },
  },
});
