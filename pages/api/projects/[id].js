import { getToken } from "next-auth/jwt";
import { getProject, updateProject, setProjectActive, projectScope } from "../../../services/projects";
import { canManageProjects } from "../../../services/roles";

// Lista, nie obiekt — `in` przepuściłby własności odziedziczone z prototypu
// (ten sam zabieg co w pages/api/overtime/[id].js).
const ALLOWED_ACTIONS = ["update", "archive", "restore"];

// eslint-disable-next-line import/no-anonymous-default-export
export default async (req, res) => {
  const token = await getToken({ req });
  if (!token) {
    return res.status(401).json({ error: "not_authorized" });
  }
  if (!canManageProjects(token.role)) {
    return res.status(403).json({ error: "permission_denied" });
  }
  if (req.method !== "PUT") {
    res.setHeader("Allow", "PUT");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const { id } = req.query;
  if (!/^\d+$/.test(id || "")) {
    return res.status(400).json({ error: "bad_id" });
  }

  const project = getProject(id);
  if (!project) {
    return res.status(404).json({ error: "not_found" });
  }

  const allowed = projectScope(token);

  // Projekt ogólnofirmowy (bez przypisań) może ruszyć każdy kierownik — nie ma
  // właściciela, który mógłby rościć sobie do niego prawo. Projekt przypisany
  // do sekcji rusza tylko kierownik mający którąś z nich w zasięgu.
  if (project.sections.length > 0 && !project.sections.some((s) => allowed.includes(s))) {
    return res.status(403).json({ error: "permission_denied" });
  }

  const { action } = req.body ?? {};
  if (!ALLOWED_ACTIONS.includes(action)) {
    return res.status(400).json({ error: "bad_action" });
  }

  if (action === "archive" || action === "restore") {
    const updated = setProjectActive(id, action === "restore");
    return res.status(200).json({ status: "ok", project: updated });
  }

  const { name, client, color, sections } = req.body ?? {};
  const requested = Array.isArray(sections) ? sections.map(String) : [];

  // Jak przy tworzeniu: nie wolno przenieść projektu do cudzej sekcji.
  // Wyjątek — sekcje, które projekt JUŻ ma; inaczej kierownik jednej z dwóch
  // sekcji projektu nie mógłby poprawić literówki w nazwie bez odcinania drugiej.
  if (requested.some((s) => !allowed.includes(s) && !project.sections.includes(s))) {
    return res.status(403).json({ error: "section_out_of_scope" });
  }

  try {
    const updated = updateProject(id, { name, client, color, sections: requested });
    return res.status(200).json({ status: "ok", project: updated });
  } catch (error) {
    return res.status(422).json({ status: "not_updated", error: error.message });
  }
};
