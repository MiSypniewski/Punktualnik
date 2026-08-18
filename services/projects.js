import Joi from "joi";
import db from "./db";
import { visibleSections } from "./scope";
import { TS_FORMAT, now as appNow } from "./workday";

// Słownik projektów dla modułu zadań.
//
// W odróżnieniu od services/sections.js ten moduł ZAPISUJE — zarządzanie
// projektami siedzi w panelu webowym kierownika, nie w scripts/admin.js.
// Powód jest praktyczny: sekcji przybywa raz na rok, projektów co tydzień,
// a każde dołożenie projektu przez CLI oznaczałoby wejście na serwer.
// Komentarz w sections.js:12-14 przewidywał dokładnie ten scenariusz.
//
// Projektu się NIE kasuje, tylko archiwizuje — TaskEntries trzymają projectID
// historycznie, więc DELETE osierociłby wpisy sprzed lat.

// Klucze kolorów, nie klasy CSS. Tailwind purge skanuje wyłącznie pages/
// i components/ (patrz tailwind.config.js), więc klasa zapisana w services/
// zostałaby wycięta z arkusza. Mapowanie klucz → klasa siedzi
// w components/projectColors.js.
export const PROJECT_COLOR_KEYS = ["indigo", "emerald", "amber", "rose", "sky", "violet", "slate"];

const COLUMNS = `p.id, p.name, p.client, p.color, p.isActive, p.createdAt, p.createdBy`;

const stmtGet = db.prepare(`SELECT ${COLUMNS} FROM Projects p WHERE p.id = ?`);
const stmtSectionsOf = db.prepare(`SELECT section FROM ProjectSections WHERE projectID = ? ORDER BY section`);
const stmtInsert = db.prepare(
  `INSERT INTO Projects (name, client, color, createdAt, createdBy)
   VALUES (@name, @client, @color, @createdAt, @createdBy)`
);
const stmtUpdate = db.prepare(
  `UPDATE Projects SET name = @name, client = @client, color = @color WHERE id = @id`
);
const stmtSetActive = db.prepare(`UPDATE Projects SET isActive = @isActive WHERE id = @id`);
const stmtClearSections = db.prepare(`DELETE FROM ProjectSections WHERE projectID = ?`);
const stmtAddSection = db.prepare(
  `INSERT OR IGNORE INTO ProjectSections (projectID, section) VALUES (?, ?)`
);
const stmtNameTaken = db.prepare(`SELECT id FROM Projects WHERE name = ? COLLATE NOCASE AND id <> ?`);

const toRow = (row) =>
  row
    ? { ...row, isActive: Boolean(row.isActive), sections: stmtSectionsOf.all(row.id).map((r) => r.section) }
    : undefined;

/**
 * Sekcje, których projekty wolno temu użytkownikowi WYBIERAĆ.
 *
 * Świadomie NIE jest to samo co visibleSections(): tamto odpowiada na pytanie
 * "czyje cudze dane wolno oglądać" i dla zwykłego pracownika zwraca pustą
 * listę. Tutaj chodzi o coś innego — o własny warsztat pracy, więc pracownik
 * musi widzieć projekty swojej sekcji, mimo że cudzych danych nie ogląda.
 * Kierownik dostaje sumę: swoją sekcję i wszystkie sobie przypisane.
 */
export const projectScope = (token) => {
  const own = token?.section ? [String(token.section)] : [];
  return [...new Set([...own, ...visibleSections(token)])];
};

// Liczba sekcji jest zmienna, więc statement budujemy dynamicznie i cache'ujemy
// — dokładnie ten sam zabieg co w services/getTimesReport.js.
const listCache = new Map();

const getListStatement = (sectionCount, includeArchived) => {
  const key = `${sectionCount}#${includeArchived ? "all" : "act"}`;
  if (!listCache.has(key)) {
    const activeClause = includeArchived ? "" : ` AND p.isActive = 1`;

    // Projekt bez ŻADNEGO przypisania jest ogólnofirmowy — stąd NOT EXISTS
    // w pierwszym członie. To odwrotna wartość domyślna niż w ManagerSections
    // i jest to celowe: patrz komentarz przy tabeli w services/db.js.
    const scopeClause =
      sectionCount > 0
        ? ` AND (
              NOT EXISTS (SELECT 1 FROM ProjectSections ps WHERE ps.projectID = p.id)
              OR EXISTS (
                SELECT 1 FROM ProjectSections ps
                 WHERE ps.projectID = p.id
                   AND ps.section IN (${Array.from({ length: sectionCount }, (_, i) => `@sec${i}`).join(", ")})
              )
            )`
        : ` AND NOT EXISTS (SELECT 1 FROM ProjectSections ps WHERE ps.projectID = p.id)`;

    listCache.set(
      key,
      db.prepare(`SELECT ${COLUMNS} FROM Projects p WHERE 1=1${activeClause}${scopeClause}
                  ORDER BY p.name COLLATE NOCASE`)
    );
  }
  return listCache.get(key);
};

/**
 * @param {{sections?: string[], includeArchived?: boolean}} opts
 *   sections pominięte = bez zawężania (widok pełny, tylko dla zaufanych ścieżek).
 */
export const listProjects = ({ sections, includeArchived = false } = {}) => {
  if (!Array.isArray(sections)) {
    const all = db
      .prepare(
        `SELECT ${COLUMNS} FROM Projects p
          ${includeArchived ? "" : "WHERE p.isActive = 1"}
          ORDER BY p.name COLLATE NOCASE`
      )
      .all();
    return all.map(toRow);
  }

  const params = {};
  sections.forEach((s, i) => {
    params[`sec${i}`] = String(s);
  });

  return getListStatement(sections.length, includeArchived).all(params).map(toRow);
};

export const getProject = (id) => toRow(stmtGet.get(Number(id)));

/**
 * Czy ten użytkownik może raportować czas na ten projekt.
 *
 * @param {{allowArchived?: boolean}} opts allowArchived przepuszcza projekt
 *   zarchiwizowany. Używane WYŁĄCZNIE przy poprawianiu wpisu, który już na nim
 *   wisi: inaczej archiwizacja projektu zamrażałaby jego stare wpisy na zawsze
 *   — nie dałoby się poprawić w nich literówki, mimo że projektu nikt nie zmienia.
 */
export const canUseProject = (token, project, { allowArchived = false } = {}) => {
  if (!project) return false;
  if (!project.isActive && !allowArchived) return false;
  if (project.sections.length === 0) return true; // ogólnofirmowy
  return project.sections.some((s) => projectScope(token).includes(s));
};

const schema = Joi.object({
  name: Joi.string().trim().min(2).max(80).required(),
  client: Joi.string().trim().max(80).allow("").default(""),
  color: Joi.string()
    .valid(...PROJECT_COLOR_KEYS)
    .default("indigo"),
  sections: Joi.array().items(Joi.string().trim()).default([]),
});

// Unikalność nazwy pilnuje też idx_projects_name (UNIQUE COLLATE NOCASE), ale
// sprawdzamy ją wcześniej, żeby zwrócić czytelny błąd zamiast SQLITE_CONSTRAINT.
const assertNameFree = (name, id = 0) => {
  if (stmtNameTaken.get(name, id)) {
    const err = new Error("Projekt o tej nazwie już istnieje.");
    err.code = "name_taken";
    throw err;
  }
};

const writeSections = (projectID, sections) => {
  stmtClearSections.run(projectID);
  [...new Set(sections.map((s) => String(s).trim()).filter(Boolean))].forEach((s) =>
    stmtAddSection.run(projectID, s)
  );
};

export const createProject = (payload, createdBy) => {
  const { name, client, color, sections } = Joi.attempt(payload, schema);

  return db.transaction(() => {
    assertNameFree(name);
    const info = stmtInsert.run({
      name,
      client,
      color,
      createdAt: appNow().format(TS_FORMAT),
      createdBy: createdBy ? Number(createdBy) : null,
    });
    writeSections(info.lastInsertRowid, sections);
    return getProject(info.lastInsertRowid);
  })();
};

export const updateProject = (id, payload) => {
  const { name, client, color, sections } = Joi.attempt(payload, schema);
  const projectID = Number(id);

  return db.transaction(() => {
    if (!stmtGet.get(projectID)) return undefined;
    assertNameFree(name, projectID);
    stmtUpdate.run({ id: projectID, name, client, color });
    writeSections(projectID, sections);
    return getProject(projectID);
  })();
};

/** Archiwizacja i przywrócenie. Kasowania nie ma i nie będzie. */
export const setProjectActive = (id, isActive) => {
  const info = stmtSetActive.run({ id: Number(id), isActive: isActive ? 1 : 0 });
  return info.changes > 0 ? getProject(id) : undefined;
};

export default listProjects;
