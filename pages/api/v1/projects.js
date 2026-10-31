import { apiRoute } from "../../../services/apiAuth";
import { listProjects, projectScope } from "../../../services/projects";

export const config = { api: { bodyParser: { sizeLimit: "16kb" } } };

// Projekty, na które właściciel klucza może raportować czas. Bez archiwalnych
// i bez projektu systemowego, tak jak na liście wyboru w panelu.
export default apiRoute("api/v1/projects", {
  GET: {
    scope: "read",
    handle: (req, res, { token }) =>
      res.status(200).json({
        projects: listProjects({ sections: projectScope(token) }).map(({ id, name, client, color }) => ({
          id,
          name,
          client,
          color,
        })),
      }),
  },
});
