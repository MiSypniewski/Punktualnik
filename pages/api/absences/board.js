import { getToken } from "next-auth/jwt";
import { getDayBoard } from "../../../services/dayBoard";
import { canApproveLeave } from "../../../services/roles";
import { visibleSections } from "../../../services/scope";
import { workDay } from "../../../services/workday";

// Dzień zespołu dla ekranu /urlopy/stan, odpytywany cyklicznie — tak samo jak
// /api/time/board zasila tablicę kiosku, a /api/entries/running sekcję
// "Teraz w toku" w raporcie zadań.
//
// Data idzie w QUERY, nie w ścieżce, i z tego samego powodu co sekcja
// w pages/api/time/board.js: obok stoi pages/api/absences/[id].js, gdzie [id]
// znaczy id wniosku. Trasa statyczna wygrywa w Next 12 z dynamiczną, więc
// /api/absences/board nigdy nie trafi tam jako "wniosek o id 'board'".
//
// Endpoint wyłącznie CZYTA i tak ma zostać. Zapis wykonywany przy odczycie —
// choćby domykanie czegoś "przy okazji" — położył serwer 21.08.2026 (README,
// "Kiedy aplikacja muli").

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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

  // Ta sama bramka co w getServerSideProps strony. Gdyby API było łagodniejsze
  // od SSR, adres wpisany z palca pokazywałby dane, których strona pokazać
  // nie chce.
  if (!canApproveLeave(token.role)) {
    return res.status(403).json({ error: "permission_denied" });
  }

  // Zła data to cichy powrót na dziś, nie 400: ten adres odpytuje widok
  // w pętli, a jedno przeklejone query nie ma prawa zostawić kierownika
  // z pustym ekranem do końca zmiany.
  const raw = String(req.query.dzien ?? "");
  const day = DATE_RE.test(raw) ? raw : workDay();

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json(getDayBoard({ day, sections: visibleSections(token) }));
};
