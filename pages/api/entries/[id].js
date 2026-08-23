import { getToken } from "next-auth/jwt";
import {
  getEntry,
  stopEntry,
  updateEntry,
  deleteEntry,
  retagRunningEntry,
  setRunningStart,
} from "../../../services/taskEntries";
import { getProject, canUseProject } from "../../../services/projects";
import { canTrackTasks, canSeeTeamTasks, boundByEditWindow } from "../../../services/roles";
import { canSeeUser } from "../../../services/scope";
import getUserData from "../../../services/getUserData";
import { logApiError } from "../../../services/log";

// "retag" to opis i projekt biegnącego timera, "setstart" — jego godzina
// rozpoczęcia; "update" to cały zamknięty wpis razem z czasami. Rozdzielone, bo
// obowiązują je inne reguły: trzy pierwsze wolno tylko właścicielowi i tylko
// dopóki licznik leci, update także kierownikowi i tylko na wpisie zamkniętym.
const ALLOWED_ACTIONS = ["stop", "update", "retag", "setstart"];

// Akcje na WŁASNYM biegnącym timerze. Kierownik ich nie dostaje: nie wie, kiedy
// pracownik faktycznie zaczął ani skończył, a zgadnięty czas to zafałszowany
// wpis. Jego narzędziem jest "update" na wpisie już zamkniętym — z podpisem.
const OWNER_ONLY = ["stop", "setstart"];
const CONFLICT_CODES = ["overlap", "already_running", "edit_window_closed"];

/**
 * Kto może ruszyć ten wpis i na jakich zasadach.
 * Okno "dziś i wczoraj" obowiązuje pracownika; kierownika — nigdzie, ani na
 * cudzym wpisie, ani na własnym (services/roles.js: boundByEditWindow). Inaczej
 * starszy błąd zostawałby w bazie na zawsze: pracownik go nie sięgnie, a jedyna
 * osoba, która może go poprawić, nie sięgnęłaby własnego.
 */
const resolveAccess = async (token, entry) => {
  // Własny wpis: zasięg projektów bierzemy z prawdziwego tokenu, żeby lista
  // na stronie i to, co da się zapisać, znaczyły to samo (patrz komentarz
  // w pages/api/entries/index.js). `actor` zostaje pusty — podpis "popr." jest
  // zastrzeżony dla korekty CUDZEGO wpisu.
  if (Number(entry.userID) === Number(token.userID)) {
    return {
      allowed: true,
      enforceWindow: boundByEditWindow(token.role),
      actor: null,
      scopeToken: token,
    };
  }
  if (!canSeeTeamTasks(token.role)) return { allowed: false };

  const [owner] = await getUserData(entry.userID);
  if (!owner || !canSeeUser(token, owner)) return { allowed: false };

  return {
    allowed: true,
    enforceWindow: false,
    actor: { userID: token.userID, name: token.name },
    // Cudzy wpis — zasięg właściciela, nie poprawiającego.
    scopeToken: { section: owner.section, role: "user", userID: owner.id },
  };
};

// eslint-disable-next-line import/no-anonymous-default-export
export default async (req, res) => {
  const token = await getToken({ req });
  if (!token) {
    return res.status(401).json({ error: "not_authorized" });
  }
  if (!canTrackTasks(token.role)) {
    return res.status(403).json({ error: "permission_denied" });
  }

  const { id } = req.query;
  if (!/^\d+$/.test(id || "")) {
    return res.status(400).json({ error: "bad_id" });
  }

  const entry = getEntry(id);
  if (!entry) {
    return res.status(404).json({ error: "not_found" });
  }

  const access = await resolveAccess(token, entry);
  if (!access.allowed) {
    return res.status(403).json({ error: "permission_denied" });
  }

  if (req.method === "DELETE") {
    const removed = deleteEntry({
      id,
      userID: entry.userID,
      enforceWindow: access.enforceWindow,
    });
    // changes === 0 przy istniejącym wpisie znaczy dokładnie jedno: warunek
    // okna w SQL go odrzucił.
    return removed
      ? res.status(200).json({ status: "deleted" })
      : res.status(409).json({ error: "edit_window_closed" });
  }

  if (req.method !== "PUT") {
    res.setHeader("Allow", "PUT, DELETE");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const { action } = req.body ?? {};
  if (!ALLOWED_ACTIONS.includes(action)) {
    return res.status(400).json({ error: "bad_action" });
  }

  const { projectID, description, data, from, to } = req.body ?? {};

  if (OWNER_ONLY.includes(action)) {
    if (Number(entry.userID) !== Number(token.userID)) {
      return res.status(403).json({ error: "permission_denied" });
    }

    try {
      if (action === "stop") {
        // stopEntry odrzuca wpis bez opisu albo bez projektu (assertComplete),
        // więc od tej zmiany potrafi rzucić — stąd try wokół obu akcji.
        const stopped = stopEntry({ id, userID: token.userID });
        return stopped
          ? res.status(200).json({ status: "stopped", entry: stopped })
          : res.status(409).json({ error: "not_running" });
      }

      const moved = setRunningStart({ id, userID: token.userID, from });
      return moved
        ? res.status(200).json({ status: "moved", entry: moved })
        : res.status(409).json({ error: "not_running" });
    } catch (error) {
      const status = CONFLICT_CODES.includes(error.code) ? 409 : 422;
      logApiError("api/entries/[id]", error, status, { action, id, userID: token.userID });
      return res
        .status(status)
        .json({ status: "not_updated", error: error.code || "invalid", message: error.message });
    }
  }

  // Wybór projektu sprawdzamy raz, dla obu pozostałych akcji — jedna i druga
  // potrafi przenieść wpis na inny projekt i obie muszą to zrobić na tych samych
  // zasadach. Różnią się jedną rzeczą: retag dotyczy wpisu BIEGNĄCEGO, a taki
  // wolno zostawić (i cofnąć) bez projektu; update zamyka temat na dobre.
  const hasProject = /^\d+$/.test(String(projectID ?? ""));
  if (!hasProject && action !== "retag") {
    return res.status(400).json({ error: "bad_project" });
  }

  if (hasProject) {
    const project = getProject(projectID);
    if (!project) {
      return res.status(404).json({ error: "project_not_found" });
    }
    // Projekt archiwalny wolno ZOSTAWIĆ, ale nie wolno na niego przenieść.
    const keepsProject = Number(projectID) === Number(entry.projectID);
    if (!canUseProject(access.scopeToken, project, { allowArchived: keepsProject })) {
      return res.status(403).json({ error: "project_out_of_scope" });
    }
  }

  if (action === "retag") {
    // Jak przy "stop": biegnący timer należy wyłącznie do swojego właściciela.
    // Kierownik poprawia dopiero wpis zamknięty, i wtedy zostaje pod nim podpis.
    if (Number(entry.userID) !== Number(token.userID)) {
      return res.status(403).json({ error: "permission_denied" });
    }
    const retagged = retagRunningEntry({
      id,
      userID: token.userID,
      projectID,
      description,
    });
    return retagged
      ? res.status(200).json({ status: "retagged", entry: retagged })
      : res.status(409).json({ error: "not_running" });
  }

  try {
    const updated = updateEntry(
      id,
      { projectID, description, data, from, to },
      { userID: entry.userID, enforceWindow: access.enforceWindow, actor: access.actor }
    );
    return updated
      ? res.status(200).json({ status: "updated", entry: updated })
      : res.status(404).json({ error: "not_found" });
  } catch (error) {
    const status = CONFLICT_CODES.includes(error.code) ? 409 : 422;
    logApiError("api/entries/[id]", error, status, { action, id, userID: token.userID });
    return res.status(status).json({ status: "not_updated", error: error.code || "invalid", message: error.message });
  }
};
