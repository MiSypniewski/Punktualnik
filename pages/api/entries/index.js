import { getToken } from "next-auth/jwt";
import {
  startEntry,
  switchEntry,
  createManualEntry,
  closeStaleEntries,
} from "../../../services/taskEntries";
import { getProject, canUseProject } from "../../../services/projects";
import { canTrackTasks, canSeeTeamTasks, boundByEditWindow } from "../../../services/roles";
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

  const { action, projectID, description, data, from, to, targetUserID, replaceRunning } =
    req.body ?? {};
  if (!ALLOWED_ACTIONS.includes(action)) {
    return res.status(400).json({ error: "bad_action" });
  }
  if (!/^\d+$/.test(String(projectID ?? ""))) {
    return res.status(400).json({ error: "bad_project" });
  }

  // Domyślnie wpis powstaje NA SIEBIE — userID bierzemy z tokenu, nigdy z body.
  // Cudzy wpis wolno założyć tylko kierownikowi i tylko w jego zasięgu; służy
  // to uzupełnianiu braków za pracownika, który zapomniał zaraportować.
  //
  // `scopeToken` rozstrzyga, KTÓRE projekty wolno wybrać. Dla wpisu na siebie
  // musi to być prawdziwy token — inaczej kierownik widziałby na liście projekty
  // obsługiwanych sekcji, ale nie mógłby ich wystartować (projectScope dla roli
  // 'user' pomija ManagerSections i zostawia samą Users.section).
  let owner = { id: Number(token.userID), section: token.section, self: true, scopeToken: token };

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
    // Wpis za kogoś sprawdzamy zasięgiem TAMTEJ osoby: kierownik nie może
    // przypisać pracownikowi projektu, którego ten sam by nie wybrał.
    owner = {
      id: Number(target.id),
      section: target.section,
      self: false,
      scopeToken: { section: target.section, role: "user", userID: target.id },
    };
  }

  const project = getProject(projectID);
  if (!project) {
    return res.status(404).json({ error: "project_not_found" });
  }
  if (!canUseProject(owner.scopeToken, project)) {
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
      const payload = {
        userID: owner.id,
        projectID,
        description,
        section: owner.section,
      };

      // Przełączenie na inne zadanie tylko na JAWNE życzenie ("wznów" / "przełącz
      // na"), a nie domyślnie. Bez flagi biegnący timer nadal daje 409
      // already_running, więc dwie otwarte zakładki kończą się konfliktem,
      // a nie cichym zamknięciem pracy, o której druga zakładka nic nie wie.
      if (replaceRunning) {
        const { entry, stopped, discarded } = switchEntry(payload);
        return res.status(201).json({ status: "created", entry, stopped, discarded });
      }

      const entry = startEntry(payload);
      return res.status(201).json({ status: "created", entry });
    }

    // Okno "dziś i wczoraj" dotyczy pracownika uzupełniającego SWÓJ dzień.
    // Kierownik wpisuje wstecz i za siebie, i za kogoś — patrz boundByEditWindow.
    const entry = createManualEntry(
      { projectID, description, data, from, to },
      {
        userID: owner.id,
        section: owner.section,
        enforceWindow: owner.self && boundByEditWindow(token.role),
      }
    );
    return res.status(201).json({ status: "created", entry });
  } catch (error) {
    const status = CONFLICT_CODES.includes(error.code) ? 409 : 422;
    return res.status(status).json({ status: "not_created", error: error.code || "invalid", message: error.message });
  }
};
