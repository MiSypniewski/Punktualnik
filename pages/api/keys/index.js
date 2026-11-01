import Joi from "joi";
import db from "../../../services/db";
import { getActiveToken } from "../../../services/session";
import { canTrackTasks } from "../../../services/roles";
import { createApiKey, listApiKeys } from "../../../services/apiKeys";
import { verifyPassword } from "../../../services/password";
import { checkLogin, loginKeys, noteBlocked, noteFailure } from "../../../services/loginRateLimit";
import { notifyApiKeyCreated } from "../../../services/notifyMail";
import { logApiError, logInfo, publicError } from "../../../services/log";

// Zarządzanie własnymi kluczami API. Wyłącznie sesja z przeglądarki.
//
// getActiveToken nie rozpoznaje kluczy API, więc kluczem nie da się utworzyć ani
// odwołać klucza. Utworzenie wymaga dodatkowo hasła: inaczej przejęta na chwilę sesja
// dawałaby trwały dostęp, który przeżywa wylogowanie.

const stmtAccount = db.prepare(
  `SELECT id, email, sessionVersion, passwordHash, passwordSalt, passwordParams FROM Users WHERE id = ?`
);

const passwordSchema = Joi.string().max(200).required();

// eslint-disable-next-line import/no-anonymous-default-export
export default async (req, res) => {
  const token = await getActiveToken(req);
  if (!token) {
    return res.status(401).json({ error: "not_authorized" });
  }
  // Kiosk jest kontem współdzielonym, więc jego klucz nie miałby właściciela.
  if (!canTrackTasks(token.role)) {
    return res.status(403).json({ error: "permission_denied" });
  }

  res.setHeader("Cache-Control", "no-store");
  const account = stmtAccount.get(Number(token.userID));

  if (req.method === "GET") {
    return res.status(200).json({ keys: listApiKeys(account) });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const { password, name, scopes, days } = req.body ?? {};

  // Ten sam licznik co przy logowaniu. Bez niego ten formularz byłby drugą drogą do
  // zgadywania hasła i tanim sposobem na zajęcie procesora hashowaniem PBKDF2.
  const keys = loginKeys(account.email, req.headers);
  const blocked = checkLogin(keys);
  if (!blocked.ok) {
    noteBlocked(keys, blocked);
    res.setHeader("Retry-After", String(Math.ceil(blocked.retryAfterMs / 1000)));
    return res.status(429).json({ error: "too_many_attempts" });
  }

  const passwordCheck = passwordSchema.validate(password);
  if (passwordCheck.error || !(await verifyPassword(passwordCheck.value, account))) {
    noteFailure(keys);
    return res.status(403).json({ error: "wrong_password" });
  }

  try {
    const { key, token: secret } = createApiKey({ name, scopes, days }, account);

    logInfo("api/keys", "[audit] utworzono klucz", { keyID: key.id, userID: account.id, scopes: key.scopes.join("+") });
    notifyApiKeyCreated(key, account.id).catch(() => {});

    return res.status(201).json({ status: "created", key, token: secret });
  } catch (error) {
    logApiError("api/keys", error, 422, { userID: account.id });
    const { code, message } = publicError(error);
    return res.status(422).json({ status: "not_created", error: code || "invalid", message });
  }
};
