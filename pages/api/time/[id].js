import { getToken } from "next-auth/jwt";
import getTime from "../../../services/getTime";
import getUserData from "../../../services/getUserData";
import { canSeeUser } from "../../../services/scope";
import { canPunchCards } from "../../../services/roles";
import {
  openCardFromKiosk,
  updateCardFromKiosk,
  STATUS_FOR,
} from "../../../services/punchCard";
import { logApiError } from "../../../services/log";

// Karty czasu z kiosku: odczyt karty pracownika (GET), odbicie wejścia (POST)
// i kolejne dotknięcia kafelka (PUT).
//
// Reguły zapisu siedzą w services/punchCard.js, a nie tutaj. Trasa robi dokładnie
// trzy rzeczy: sprawdza sesję i rolę, przekazuje żądanie dalej i tłumaczy kod
// błędu z serwisu na status HTTP. Do tej pory było odwrotnie — ciało żądania szło
// wprost do bazy, bez schematu i bez sprawdzenia, czyjej karty dotyczy.
//
// Znaczenie `id` w adresie zależy od metody i tak ma zostać, bo tak wołają tę
// trasę kafelki (components/card.js):
//   GET  /api/time/<userID>        — karta pracownika na dziś
//   POST /api/time/empty_<userID>  — pierwsze odbicie, wiersza jeszcze nie ma
//   PUT  /api/time/<idKarty>       — istniejący wiersz Times

// eslint-disable-next-line import/no-anonymous-default-export
export default async (req, res) => {
  const token = await getToken({ req });
  if (!token) {
    return res.status(401).json({ error: "not_authorized" });
  }

  switch (req.method) {
    case "GET": {
      // req.query.id to userID pracownika. Wcześniej nie było tu żadnej
      // kontroli — każdy zalogowany mógł odczytać czas dowolnej osoby.
      const [owner] = await getUserData(req.query.id);
      if (!canSeeUser(token, owner)) {
        return res.status(403).json({ error: "permission_denied" });
      }

      const time = await getTime(req.query.id);
      return res.status(200).json(time);
    }

    case "POST":
    case "PUT": {
      // Zapis czasu tylko ze stanowiska kiosku (rola editor). Kierownik kart
      // nie klika — ogląda je, a swój czas odbija tak jak reszta zespołu,
      // na wspólnym ekranie dotykowym. Korekta po fakcie to osobne uprawnienie
      // i osobna trasa (/api/time/manage, services/roles.js: canEditTimes).
      //
      // 403, a nie 401 jak wcześniej: sesja jest poprawna, brakuje uprawnienia.
      if (!canPunchCards(token.role)) {
        return res.status(403).json({ error: "permission_denied" });
      }

      const isCreate = req.method === "POST";

      try {
        const args = { param: req.query.id, body: req.body, token };
        const time = isCreate
          ? await openCardFromKiosk(args)
          : await updateCardFromKiosk(args);

        return res.status(200).json({ status: isCreate ? "created" : "update", time });
      } catch (error) {
        // Kod nieznany w tabeli to błąd, którego serwis nie przewidział —
        // leci jako 500, żeby nie udawał odmowy walidacji.
        const status = STATUS_FOR[error.code] ?? 500;
        logApiError("api/time", error, status, {
          method: req.method,
          param: req.query.id,
          by: token.userID,
        });
        return res.status(status).json({ error: error.code || "invalid", message: error.message });
      }
    }

    default: {
      // Wcześniej ta gałąź ustawiała sam status i nie kończyła odpowiedzi —
      // żądanie wisiało otwarte do timeoutu klienta. Ten sam błąd poprawiono
      // już w pages/api/users/index.js.
      res.setHeader("Allow", "GET, POST, PUT");
      return res.status(405).json({ error: "method_not_allowed" });
    }
  }
};
