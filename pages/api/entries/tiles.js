import { getToken } from "next-auth/jwt";
import { saveTilePrefs } from "../../../services/resumeTiles";
import { getProject, canUseProject } from "../../../services/projects";
import { canTrackTasks } from "../../../services/roles";
import { logApiError } from "../../../services/log";

// Ustawienia kafelków "Wznów": ile ich pokazywać i co jest przypięte na stałe.
//
// Trasa STATYCZNA obok dynamicznego [id].js w tym samym katalogu — w Next static
// wygrywa, więc /api/entries/tiles nie trafi do obsługi wpisu o id "tiles".
// Siedzi pod /entries, a nie na własnym poziomie, bo to ustawienie EKRANU wpisów,
// a nie osobna dziedzina jak projekty czy urlopy.
//
// Jedna metoda i jedno żądanie na cały panel: PUT podmienia komplet ustawień.
// Osobne endpointy na "przypnij", "odepnij" i "przestaw" dawałyby cztery żądania
// na jedno kliknięcie w panelu i stan pośredni do sprzątania po błędzie.

// eslint-disable-next-line import/no-anonymous-default-export
export default async (req, res) => {
  const token = await getToken({ req });
  if (!token) {
    return res.status(401).json({ error: "not_authorized" });
  }
  // Kiosk odpada razem z całym modułem zadań — konto `editor` jest współdzielone
  // przez sekcję, więc nie ma czyich kafelków ustawiać.
  if (!canTrackTasks(token.role)) {
    return res.status(403).json({ error: "permission_denied" });
  }
  if (req.method !== "PUT") {
    res.setHeader("Allow", "PUT");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const { count, pins } = req.body ?? {};

  // Ustawienia są ZAWSZE własne: userID bierzemy z tokenu i nie ma tu
  // odpowiednika `targetUserID` z /api/entries. Kierownik uzupełnia komuś wpisy,
  // ale nie układa mu ekranu — to nie jest ewidencja, tylko cudze biurko.
  const list = Array.isArray(pins) ? pins : [];

  // Każdy przypięty projekt przechodzi ten sam tor co start wpisu. Bez tego dało
  // się przypiąć projekt spoza swojej sekcji i mieć na ekranie jego nazwę —
  // czyli wyciek nazwy projektu cudzego działu, mimo że wystartować i tak by się
  // nie dało.
  for (const pin of list) {
    // Kształt sprawdzamy PRZED zapytaniem — dokładnie tym wyrażeniem co
    // /api/entries. getProject robi Number() na wejściu, a NaN w parametrze
    // zapytania jest błędem sterownika, nie czytelnym 400.
    if (!/^\d+$/.test(String(pin?.projectID ?? ""))) {
      return res.status(400).json({ error: "bad_project" });
    }

    const project = getProject(pin.projectID);
    if (!project) {
      return res.status(404).json({ error: "project_not_found" });
    }
    // Archiwizacja OSOBNO od zasięgu sekcji, choć canUseProject odrzuca jedno
    // i drugie. To dwie różne wiadomości dla pracownika: "wybierz inny projekt,
    // bo tego już nie ma" kontra "ten projekt nie jest twojego działu" — a
    // kafelek na zarchiwizowanym projekcie robi się sam, bez niczyjego błędu,
    // wystarczy że kierownik posprząta słownik.
    if (!project.isActive) {
      return res.status(422).json({ error: "project_archived" });
    }
    if (!canUseProject(token, project)) {
      return res.status(403).json({ error: "project_out_of_scope" });
    }
  }

  try {
    const saved = saveTilePrefs(token.userID, { count, pins: list });
    return res.status(200).json({ status: "saved", ...saved });
  } catch (error) {
    logApiError("api/entries/tiles", error, 422, { userID: token.userID });
    return res
      .status(422)
      .json({ status: "not_saved", error: error.code || "invalid", message: error.message });
  }
};
