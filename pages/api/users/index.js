import { getToken } from "next-auth/jwt";
import createUser from "../../../services/createUser";
import updateUserPassword from "../../../services/updateUserPassowrd";
import { logApiError } from "../../../services/log";

// Obie metody wymagają zalogowania. Wcześniej sprawdzenie sesji było
// zakomentowane, czyli endpoint stał otworem dla całego internetu:
//
// - POST pozwalał dowolnej osobie wsypywać wiersze do tabeli Users. Konta
//   powstają wyłączone (`isActive = 0`), więc nie dawało to dostępu do
//   aplikacji, ale dawało nieograniczone zaśmiecanie bazy na maszynie z 10 GB
//   dysku i listy „do aktywacji”, w której nie sposób znaleźć prawdziwego
//   pracownika.
// - PUT był otwartą wyrocznią do zgadywania haseł: brał `userID` z CIAŁA
//   ŻĄDANIA i sprawdzał stare hasło, więc bez żadnej sesji dało się strzelać
//   hasłami do konta o dowolnym identyfikatorze (a te są małymi liczbami).
//
// Identyfikator do zmiany hasła bierzemy TERAZ Z TOKENU i nigdy z ciała
// żądania: hasło zmienia się wyłącznie własne. Kierownik od cudzych haseł ma
// `npm run admin -- passwd <email> <hasło>`.
// eslint-disable-next-line import/no-anonymous-default-export
export default async (req, res) => {
  const token = await getToken({ req });
  if (!token) {
    return res.status(401).json({ error: "not_authorized" });
  }

  switch (req.method) {
    case "POST": {
      // Kiosk to konto WSPÓŁDZIELONE przy ekranie dotykowym w miejscu
      // publicznym — nie zakłada kont, tak samo jak nie raportuje zadań
      // i nie pobiera eksportów.
      if (token.role === "editor") {
        return res.status(403).json({ error: "permission_denied" });
      }

      try {
        const user = await createUser(req.body);
        return res.status(200).json({ status: "created", user });
      } catch (error) {
        logApiError("api/users", error, 422, { op: "create" });
        return res.status(422).json({ status: "not_created", error: error.message });
      }
    }
    case "PUT": {
      const { oldPassword, newPassword } = req.body ?? {};

      try {
        const user = await updateUserPassword({
          userID: token.userID,
          oldPassword,
          newPassword,
        });
        return res.status(200).json({ status: "update", user });
      } catch (error) {
        logApiError("api/users", error, 422, { op: "passwd", userID: token.userID });
        return res.status(422).json({ status: "not_update", error: error.message });
      }
    }
    default: {
      // Wcześniej ta gałąź ustawiała status i nie kończyła odpowiedzi —
      // żądanie wisiało do timeoutu.
      res.setHeader("Allow", "POST, PUT");
      return res.status(405).json({ error: "method_not_allowed" });
    }
  }
};
