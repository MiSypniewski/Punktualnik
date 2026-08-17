import { getToken } from "next-auth/jwt";
import { sweepStaleEntries } from "../../../services/taskEntries";
import { getLiveBoard } from "../../../services/liveBoard";
import { canSeeTeamTasks } from "../../../services/roles";
import { visibleSections } from "../../../services/scope";

// Sekcja "Teraz w toku" na /zadania/zarzadzaj odpytuje ten endpoint cyklicznie,
// zamiast przeładowywać cały raport. Różnica jest realna: SSR tamtej strony
// liczy sumy, rozbicie na projekty, obecność z kart czasu i do 200 wpisów —
// tego nie chcemy powtarzać co kilkadziesiąt sekund na Mikrusie z 1 GB.
//
// Trasa statyczna, więc w Next 12 wygrywa z [id].js i nie da się jej pomylić
// z wpisem o id "running" (tamten walidator i tak przyjmuje wyłącznie cyfry).

// Domykanie zapomnianych timerów jest dławione w serwisie (sweepStaleEntries),
// wspólnie z /api/entries/timer — oba endpointy są odpytywane cyklicznie.

// eslint-disable-next-line import/no-anonymous-default-export
export default async (req, res) => {
  const token = await getToken({ req });
  if (!token) {
    return res.status(401).json({ error: "not_authorized" });
  }
  // Podgląd cudzej bieżącej pracy to to samo uprawnienie co reszta raportu.
  if (!canSeeTeamTasks(token.role)) {
    return res.status(403).json({ error: "permission_denied" });
  }
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  sweepStaleEntries();

  // Zasięg sekcyjny z tokenu, nigdy z zapytania — jak w pages/api/report/zadania.js.
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json(getLiveBoard(visibleSections(token)));
};
