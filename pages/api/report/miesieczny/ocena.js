import { getActiveToken } from "../../../../services/session";
import { getPersonHistory } from "../../../../services/monthlyReport";
import { REVIEW_TEXT_MAX, saveReview } from "../../../../services/monthlyReview";
import { canSeeMonthlyReports } from "../../../../services/roles";
import { canSeeSection } from "../../../../services/scope";
import { MONTH_RE } from "../../../../utils/monthlyReport";

// Ocena miesiąca wpisywana przez kierownika.
//
//  PUT { miesiac, userID, tech, docs, initiative, comment, actions, growth }
//
// Podoceny 0–10 z krokiem 0,5 — tak były wpisywane w raportach ręcznych
// i drobniejsza skala udawałaby precyzję, której osąd nie ma.

const parseScore = (value) => {
  const n = typeof value === "string" ? Number(value.replace(",", ".")) : Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 10) return null;
  return Math.round(n * 2) / 2;
};

const text = (value) => String(value ?? "").trim().slice(0, REVIEW_TEXT_MAX);

// eslint-disable-next-line import/no-anonymous-default-export
export default async (req, res) => {
  const token = await getActiveToken(req);
  if (!token) {
    return res.status(401).json({ error: "not_authorized" });
  }
  if (!canSeeMonthlyReports(token.role)) {
    return res.status(403).json({ error: "permission_denied" });
  }
  if (req.method !== "PUT") {
    res.setHeader("Allow", "PUT");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const { miesiac, userID } = req.body || {};
  if (!MONTH_RE.test(miesiac || "") || !/^\d+$/.test(String(userID ?? ""))) {
    return res.status(400).json({ error: "bad_param", message: "Brak miesiąca albo pracownika." });
  }

  // Oceniać wolno tylko to, co istnieje i co się widzi: miesiąc z migawką,
  // pracownika z sekcji w zasięgu. Sekcja pochodzi z MIGAWKI — to jej dotyczy ocena.
  const [report] = getPersonHistory(userID, miesiac, 1);
  if (!report || !canSeeSection(token, report.section)) {
    return res.status(404).json({ error: "not_found", message: "Nie ma takiego raportu." });
  }

  const scores = {
    tech: parseScore(req.body.tech),
    docs: parseScore(req.body.docs),
    initiative: parseScore(req.body.initiative),
  };
  if (Object.values(scores).some((v) => v === null)) {
    return res.status(400).json({ error: "bad_score", message: "Każda podocena musi być liczbą od 0 do 10." });
  }

  const review = saveReview(
    {
      month: miesiac,
      userID,
      ...scores,
      comment: text(req.body.comment),
      actions: text(req.body.actions),
      growth: text(req.body.growth),
    },
    { id: Number(token.userID), name: token.name }
  );

  return res.status(200).json({ review });
};
