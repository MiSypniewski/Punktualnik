import { getActiveToken } from "../../services/session";
import { getPendingCounts } from "../../services/pendingCounts";
import { canApproveLeave } from "../../services/roles";
import { visibleSections } from "../../services/scope";

// Liczba wniosków czekających na decyzję — dla licznika przy pozycji "Wnioski"
// w pasku stacyjnym i przy zakładkach Urlopy | Nadgodziny.
//
// Endpoint wyłącznie CZYTA (ta sama zasada co /api/absences/board) i zwraca
// same liczby: żadnych nazwisk ani dat, bo odpowiedź ląduje w pasku na każdej
// stronie aplikacji.

// eslint-disable-next-line import/no-anonymous-default-export
export default async (req, res) => {
  const token = await getActiveToken(req);
  if (!token) {
    return res.status(401).json({ error: "not_authorized" });
  }

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  // Jedna bramka na oba rodzaje wniosków: canApproveLeave i canApproveOvertime
  // to dziś ta sama reguła, a pasek pyta tym samym predykatem (stationRail.js).
  if (!canApproveLeave(token.role)) {
    return res.status(403).json({ error: "permission_denied" });
  }

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json(getPendingCounts(visibleSections(token)));
};
