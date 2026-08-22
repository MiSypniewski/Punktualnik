import db from "./db";
import Joi from "joi";
import { hashPassword, hashesEqual } from "./password";
import { logError } from "./log";

const schema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required(),
});

// Kolumny jawnie: `SELECT *` ciągnęło tu komplet danych konta przy każdej próbie
// logowania. Hash i sól są potrzebne — reszta wraca do next-auth jako treść tokenu.
const findByEmail = db.prepare(
  `SELECT id, email, name, role, section, location, isActive, passwordHash, passwordSalt
     FROM Users WHERE email = ?`
);

// Co wyjątek z tej funkcji robi u użytkownika — powód, dla którego niżej jest
// tyle ostrożności:
//
// next-auth v4 (core/routes/callback.js) przy wyjątku z authorize() przekierowuje
// na stronę błędu z TREŚCIĄ komunikatu w adresie:
//     `${url}/error?error=${encodeURIComponent(error.message)}`
// Wcześniej trafiał tam komunikat Joi ("email" must be a valid email), a przy
// zajętej bazie trafiłby "SQLITE_BUSY: database is locked" — czyli wewnętrzny
// błąd wyświetlany człowiekowi, który chciał się tylko zalogować.
const authorizeUser = async (payload) => {
  // Niepoprawny e-mail to nie awaria, tylko nieudane logowanie. Zwracamy null,
  // czyli dokładnie to samo co przy złym haśle — także dlatego, że rozróżnianie
  // tych przypadków zdradzałoby, które adresy istnieją w bazie.
  const parsed = schema.validate(payload);
  if (parsed.error) {
    return null;
  }
  const { email, password } = parsed.value;

  let user;
  try {
    user = findByEmail.get(email);
  } catch (error) {
    // Błąd bazy (np. SQLITE_BUSY przy kolizji zapisu) NIE jest nieudanym
    // logowaniem — zwrócenie null kazałoby użytkownikowi sprawdzać hasło, które
    // jest poprawne. Rzucamy kod, nie treść: strona logowania tłumaczy go na
    // zdanie po polsku (pages/users/signin.js), a szczegóły idą do logu, gdzie
    // jest ich miejsce.
    logError("authorizeUser", error, { stage: "odczyt konta" });
    throw new Error("server_error");
  }

  if (!user) {
    return null;
  }

  const passwordHash = await hashPassword(password, user.passwordSalt);

  if (!hashesEqual(passwordHash, user.passwordHash)) {
    return null;
  }

  if (!user.isActive) {
    return null;
  }

  return {
    id: user.id,
    userID: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    section: user.section,
    location: user.location,
  };
};

export default authorizeUser;
