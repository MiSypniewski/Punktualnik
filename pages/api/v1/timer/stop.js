import { apiRoute } from "../../../../services/apiAuth";
import { publicEntry } from "../../../../services/apiEntries";
import { getRunningEntry, stopEntry } from "../../../../services/taskEntries";

export const config = { api: { bodyParser: { sizeLimit: "16kb" } } };

// Zatrzymanie odrzuca wpis bez opisu albo bez projektu (422 incomplete), a licznik
// wtedy biegnie dalej, tak samo jak w panelu.
export default apiRoute("api/v1/timer/stop", {
  POST: {
    scope: "timer",
    handle: (req, res, { token }) => {
      const running = getRunningEntry(token.userID);
      if (!running) return res.status(409).json({ error: "not_running" });

      const stopped = stopEntry({ id: running.id, userID: token.userID });
      return stopped
        ? res.status(200).json({ entry: publicEntry(stopped) })
        : res.status(409).json({ error: "not_running" });
    },
  },
});
