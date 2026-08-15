import { getToken } from "next-auth/jwt";
import { startEntry, createManualEntry, closeStaleEntries } from "../../../services/taskEntries";
import { getProject, canUseProject } from "../../../services/projects";
import { canTrackTasks, canSeeTeamTasks } from "../../../services/roles";
import { canSeeUser } from "../../../services/scope";
import getUserData from "../../../services/getUserData";

const ALLOWED_ACTIONS = ["start", "manual"];

// Kod błędu z serwisu → status HTTP. Wszystkie te przypadki to konflikt ze
// stanem danych, nie zły format żądania, stąd 409.
const CONFLICT_CODES = ["overlap", "already_running", "edit_window_closed"];

// eslint-disable-next-line import/no-anonymous-default-export
export default async (req, res) => {
  const token = await getToken({ req });
  if (!token) {
    return res.status(401).json({ error: "not_authorized" });
  }
  if (!canTrackTasks(token.role)) {
    return res.status(403).json({ error: "permission_denied" });
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const { action, projectID, description, data, from, to, targetUserID } = req.body ?? {};
  if (!ALLOWED_ACTIONS.includes(action)) {
    return res.status(400).json({ error: "bad_action" });
  }
  if (!/^\d+$/.test(String(projectID ?? ""))) {
    return res.status(400).json({ error: "bad_project" });
  }

  // Domyślnie wpis powstaje NA SIEBIE — userID bierzemy z tokenu, nigdy z body.
  // Cudzy wpis wolno założyć tylko kierownikowi i tylko w jego zasięgu; służy
  // to uzupełnianiu braków za pracownika, który zapomniał zaraportować.
  let owner = { id: Number(token.userID), section: token.section, self: true };

  if (targetUserID !== undefined && targetUserID !== "" && Number(targetUserID) !== Number(token.userID)) {
    if (!canSeeTeamTasks(token.role)) {
      return res.status(403).json({ error: "permission_denied" });
    }
    if (!/^\d+$/.test(String(targetUserID))) {
      return res.status(400).json({ error: "bad_user" });
    }
    const [target] = await getUserData(targetUserID);
    if (!target || !canSeeUser(token, target)) {
      return res.status(403).json({ error: "permission_denied" });
    }
    owner = { id: Number(target.id), section: target.section, self: false };
  }

  const project = getProject(projectID);
  if (!project) {
    return res.status(404).json({ error: "project_not_found" });
  }
  // Projekt sprawdzamy w zasięgu WŁAŚCICIELA wpisu, nie zlecającego: kierownik
  // nie może przypisać pracownikowi projektu, którego ten i tak by nie wybrał.
  if (!canUseProject({ section: owner.section, role: "user", userID: owner.id }, project)) {
    return res.status(403).json({ error: "project_out_of_scope" });
  }

  closeStaleEntries();

  try {
    if (action === "start") {
      // Timer zawsze biegnie "u siebie" — kierownik nie uruchamia licznika
      // za kogoś, bo nie wie, kiedy tamten faktycznie zaczął.
      if (!owner.self) {
        return res.status(400).json({ error: "start_for_others" });
      }
      const entry = startEntry({
        userID: owner.id,
        projectID,
        description,
        section: owner.section,
      });
      return res.status(201).json({ status: "created", entry });
    }

    const entry = createManualEntry(
      { projectID, description, data, from, to },
      { userID: owner.id, section: owner.section, enforceWindow: owner.self }
    );
    return res.status(201).json({ status: "created", entry });
  } catch (error) {
    const status = CONFLICT_CODES.includes(error.code) ? 409 : 422;
    return res.status(status).json({ status: "not_created", error: error.code || "invalid", message: error.message });
  }
};
