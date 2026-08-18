import { getToken } from "next-auth/jwt";
import { listProjects, createProject, projectScope } from "../../../services/projects";
import { canTrackTasks, canManageProjects } from "../../../services/roles";

// eslint-disable-next-line import/no-anonymous-default-export
export default async (req, res) => {
  const token = await getToken({ req });
  if (!token) {
    return res.status(401).json({ error: "not_authorized" });
  }

  if (req.method === "GET") {
    // Listę projektów czyta każdy, kto raportuje zadania — bez niej nie ma
    // czego wybrać w formularzu. Kiosk odpada razem z całym modułem.
    if (!canTrackTasks(token.role)) {
      return res.status(403).json({ error: "permission_denied" });
    }

    // Archiwalne pokazujemy wyłącznie kierownikowi i wyłącznie na wyraźne
    // żądanie: pracownik nie ma po co widzieć projektów, na które i tak nie
    // zaraportuje czasu.
    const includeArchived = req.query.archiwalne === "1" && canManageProjects(token.role);

    return res.status(200).json({
      projects: listProjects({ sections: projectScope(token), includeArchived }),
    });
  }

  if (req.method === "POST") {
    if (!canManageProjects(token.role)) {
      return res.status(403).json({ error: "permission_denied" });
    }

    const { name, client, color, sections } = req.body ?? {};

    // Kierownik nie może przypisać projektu do sekcji spoza swojego zasięgu —
    // inaczej zakładałby projekty w cudzym dziale. Pusta lista przechodzi:
    // to świadoma decyzja "projekt ogólnofirmowy".
    const allowed = projectScope(token);
    const requested = Array.isArray(sections) ? sections.map(String) : [];
    if (requested.some((s) => !allowed.includes(s))) {
      return res.status(403).json({ error: "section_out_of_scope" });
    }

    try {
      const project = createProject({ name, client, color, sections: requested }, token.userID);
      return res.status(201).json({ status: "created", project });
    } catch (error) {
      return res.status(422).json({ status: "not_created", error: error.message });
    }
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "method_not_allowed" });
};
