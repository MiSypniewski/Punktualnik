import { getToken } from "next-auth/jwt";
import { getSectionBoard } from "../../../services/sectionBoard";
import { canSeeSection } from "../../../services/scope";

// Tablica kart sekcji dla kiosku (/time/[sekcja]), odpytywana cyklicznie —
// tak samo jak /api/entries/running zasila "Teraz w toku" w raporcie kierownika.
//
// Sekcja idzie w QUERY, nie w ścieżce, i to jest rozstrzygnięcie, nie estetyka:
// obok stoi pages/api/time/[id].js, gdzie [id] znaczy userID. Trasa statyczna
// wygrywa w Next 12 z dynamiczną, więc /api/time/board nigdy nie trafi tam
// jako "pracownik o id 'board'".
//
// Endpoint wyłącznie CZYTA. Zapis wykonywany przy odczycie — choćby domykanie
// czegoś "przy okazji" — jest tu zakazany: kioski odpytują ten adres non stop,
// a synchroniczna blokada zapisu w SQLite zamraża cały serwer (README,
// "Kiedy aplikacja muli").

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

  const section = String(req.query.section ?? "").trim();
  if (!section) {
    return res.status(400).json({ error: "bad_section" });
  }

  // Ten sam warunek co w getServerSideProps strony kiosku: własna sekcja zawsze,
  // cudza tylko w zasięgu kierownika. Gdyby API było łagodniejsze od SSR, adres
  // wpisany z palca pokazywałby dane, których strona pokazać nie chce.
  //
  // Świadomie przez canSeeSection, a NIE canSeeTeamTasks: kiosk ma rolę `editor`,
  // którą tamten predykat odrzuca.
  if (token.section !== section && !canSeeSection(token, section)) {
    return res.status(403).json({ error: "permission_denied" });
  }

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json(await getSectionBoard(section));
};
