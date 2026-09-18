import { getToken } from "next-auth/jwt";
import { getDayTasks } from "../../../services/dayTasks";
import { canSeeTeamTasks } from "../../../services/roles";
import { visibleSections } from "../../../services/scope";
import { workDay } from "../../../services/workday";
import { isIsoDate } from "../../../utils";

// Wpisy zadań zespołu z jednego dnia — tor zadań na osi czasu w /urlopy/stan.
// Odpytywany tylko wtedy, gdy kierownik włączy checkbox "Pokaż zadania na osi",
// i tylko dla dnia dzisiejszego cyklicznie. Wzór 1:1 z
// pages/api/absences/board.js, łącznie z cichym powrotem na dziś przy złej
// dacie.
//
// Endpoint wyłącznie CZYTA (README, "Kiedy aplikacja muli").

// eslint-disable-next-line import/no-anonymous-default-export
export default async (req, res) => {
  const token = await getToken({ req });
  if (!token) {
    return res.status(401).json({ error: "not_authorized" });
  }

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  // Bramka modułu zadań, nie nieobecności: to są cudze wpisy zadań, więc
  // decyduje to samo uprawnienie co raport zespołu (/zadania/zarzadzaj).
  if (!canSeeTeamTasks(token.role)) {
    return res.status(403).json({ error: "permission_denied" });
  }

  const raw = String(req.query.dzien ?? "");
  const day = isIsoDate(raw) ? raw : workDay();

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json(getDayTasks({ day, sections: visibleSections(token) }));
};
