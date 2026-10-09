import { getToken } from "next-auth/jwt";
import { generateMonth, isClosedMonth, listMonth } from "../../../../services/monthlyReport";
import { canSeeMonthlyReports } from "../../../../services/roles";
import { visibleSections } from "../../../../services/scope";
import { MONTH_RE } from "../../../../utils/monthlyReport";

// Miesięczne podsumowania pracowników.
//
//  GET  ?miesiac=YYYY-MM  — zapisana migawka w zasięgu kierownika
//  POST { miesiac }       — przeliczenie i zapis; zwraca świeżą migawkę
//
// POST służy też do wygenerowania miesiąca, którego automat nie widział
// (sprzed wdrożenia) — z punktu widzenia bazy to ta sama operacja.

// eslint-disable-next-line import/no-anonymous-default-export
export default async (req, res) => {
  const token = await getToken({ req });
  if (!token) {
    return res.status(401).json({ error: "not_authorized" });
  }
  if (!canSeeMonthlyReports(token.role)) {
    return res.status(403).json({ error: "permission_denied" });
  }
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const month = req.method === "GET" ? req.query.miesiac : req.body?.miesiac;
  if (!MONTH_RE.test(month || "")) {
    return res.status(400).json({ error: "bad_month", message: "miesiac musi być w formacie YYYY-MM" });
  }

  // Zasięg sekcyjny bierzemy z tokenu, nigdy z zapytania.
  const sections = visibleSections(token);

  if (req.method === "POST") {
    if (!isClosedMonth(month)) {
      return res.status(400).json({
        error: "month_open",
        message: "Podsumowanie powstaje dopiero po zakończeniu miesiąca.",
      });
    }
    // Przeliczamy WSZYSTKIE sekcje kierownika naraz, zawsze całe — przeliczenie
    // części zespołu zostawiłoby resztę ze starą średnią.
    generateMonth(month, {
      sections,
      by: { id: Number(token.userID), name: token.name },
    });
  }

  return res.status(200).json({ month, people: listMonth(month, sections) });
};
