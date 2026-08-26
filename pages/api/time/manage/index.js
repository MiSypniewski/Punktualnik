import { getToken } from "next-auth/jwt";
import dayjs from "dayjs";
import getSectionTimes from "../../../../services/getSectionTimes";
import { createCardForUser, STATUS_FOR } from "../../../../services/manageTime";
import { canEditTimes } from "../../../../services/roles";
import { visibleSections, canSeeUser } from "../../../../services/scope";
import getUserData from "../../../../services/getUserData";
import { logApiError } from "../../../../services/log";

// Panel korekty kart czasu: lista (GET) i dopisanie brakującej karty (POST).
//
// Osobna gałąź adresów zamiast dokładania metod do pages/api/time/[id].js.
// Tam `id` znaczy raz userID (GET), raz Times.id (PUT) — dokładanie do tego
// trzeciego znaczenia skończyłoby się pomyłką, której nie widać w testach.
// Kiosk zostaje na swojej trasie, nietknięty.

// eslint-disable-next-line import/no-anonymous-default-export
export default async (req, res) => {
  const token = await getToken({ req });
  if (!token) {
    return res.status(401).json({ error: "not_authorized" });
  }
  if (!canEditTimes(token.role)) {
    return res.status(403).json({ error: "permission_denied" });
  }

  // Zasięg liczony RAZ, z tokenu — nie z parametru zapytania. Kierownik bez
  // przypisanych sekcji dostaje pustą listę, a nie całą firmę.
  const sections = visibleSections(token);

  if (req.method === "GET") {
    const { from, to, userID } = req.query;
    const rows = getSectionTimes({
      from: String(from ?? dayjs().date(1).format("YYYY-MM-DD")),
      to: String(to ?? dayjs().format("YYYY-MM-DD")),
      userID,
      sections,
    });
    return res.status(200).json({ cards: rows });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const { userID, day, start, end } = req.body ?? {};

  const [owner] = await getUserData(userID);
  if (!owner) {
    return res.status(404).json({ error: "user_not_found" });
  }
  // Nową kartę zawężamy po BIEŻĄCEJ sekcji pracownika (canSeeUser), bo wiersza
  // z własną sekcją jeszcze nie ma — inaczej niż przy korekcie, gdzie decyduje
  // sekcja zapisana na karcie.
  if (!canSeeUser(token, owner)) {
    return res.status(403).json({ error: "permission_denied" });
  }

  try {
    const card = createCardForUser({
      userID,
      day,
      start,
      end,
      owner,
      actor: { userID: token.userID, name: token.name },
    });
    return res.status(200).json({ status: "created", card });
  } catch (error) {
    const status = STATUS_FOR[error.code] ?? 422;
    logApiError("api/time/manage", error, status, { userID, day, by: token.userID });
    return res.status(status).json({ error: error.code || "invalid", message: error.message });
  }
};
