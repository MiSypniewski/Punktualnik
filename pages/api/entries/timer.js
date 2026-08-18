import { getToken } from "next-auth/jwt";
import { getRunningEntryDetail, runningSeconds, sweepStaleEntries } from "../../../services/taskEntries";
import { canTrackTasks } from "../../../services/roles";

// Timer w tytule karty przeglądarki (components/timerTitle.js) — WŁASNY biegnący
// wpis, jedno zdanie danych.
//
// Osobno od /api/entries/running, choć nazwy są bliźniacze: tamten endpoint jest
// managerski (canSeeTeamTasks), zwraca całą sekcję razem z listą bezczynnych
// i wymaga zasięgu sekcyjnego. Tutaj zasięg to jedno konto z tokenu, więc pytanie
// trafia w częściowy indeks idx_entries_running i jest tanie — a musi być, bo ten
// endpoint odpytuje KAŻDA otwarta strona, nie tylko panel kierownika.
//
// Trasa statyczna, więc w Next 12 wygrywa z [id].js i nie da się jej pomylić
// z wpisem o id "timer" (tamten walidator i tak przyjmuje wyłącznie cyfry).

// eslint-disable-next-line import/no-anonymous-default-export
export default async (req, res) => {
  const token = await getToken({ req });
  if (!token) {
    return res.status(401).json({ error: "not_authorized" });
  }
  // Kiosk (`editor`) nie raportuje zadań, więc nie ma własnego timera — tytuł
  // karty na wspólnym stanowisku i tak nie należy do nikogo konkretnego.
  if (!canTrackTasks(token.role)) {
    return res.status(403).json({ error: "permission_denied" });
  }
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  sweepStaleEntries();

  const entry = getRunningEntryDetail(token.userID);

  // Odpowiedź celowo minimalna: to zasila jeden napis w pasku karty, nie widok.
  // `elapsedSec` liczy serwer — powód w services/taskEntries.js (runningSeconds).
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({
    running: entry
      ? {
          id: entry.id,
          description: entry.description,
          projectName: entry.projectName,
          elapsedSec: runningSeconds(entry),
        }
      : null,
  });
};
