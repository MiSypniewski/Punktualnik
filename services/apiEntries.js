import { getProject, canUseProject } from "./projects";
import { isEmptyTimer } from "../utils/emptyTimer";

// Wspólne kawałki tras /api/v1 dotyczących wpisów.

/** Wpis na zewnątrz. Jawna lista pól, żeby nowe kolumny nie wychodziły same. */
export const publicEntry = (entry) =>
  entry
    ? {
        id: entry.id,
        projectID: entry.projectID,
        ...(entry.projectName !== undefined && { projectName: entry.projectName }),
        description: entry.description,
        data: entry.data,
        startedAt: entry.startedAt,
        endedAt: entry.endedAt,
        seconds: entry.seconds,
        running: entry.endedAt === null,
        autoClosed: Boolean(entry.autoClosed),
        ...(entry.endedAt === null && { empty: isEmptyTimer(entry) }),
      }
    : null;

export const hasProjectId = (value) => /^\d+$/.test(String(value ?? ""));

/**
 * Sprawdza projekt wpisu. Zwraca kod błędu albo null. Reguły są te same co w panelu:
 * canUseProject odrzuca projekt systemowy i spoza sekcji, a archiwalny wolno
 * wyłącznie zostawić na wpisie, który już na nim wisi.
 */
export const projectProblem = (token, projectID, { keepsProject = false } = {}) => {
  const project = getProject(projectID);
  if (!project) return { status: 404, error: "project_not_found" };
  if (!canUseProject(token, project, { allowArchived: keepsProject })) {
    return { status: 403, error: "project_out_of_scope" };
  }
  return null;
};
