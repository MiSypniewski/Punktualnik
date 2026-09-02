import db from "./db";
import Joi from "joi";
import { verifyPassword, makePasswordRecord } from "./password";

const schema = Joi.object({
  userID: Joi.number().required(),
  // oldPassword BEZ .min() — i to jest istotne, a nie przeoczone. Konta założone
  // przed wprowadzeniem minimum mają hasła krótsze niż 10 znaków; wymóg długości
  // na STARYM haśle odebrałby tym osobom jedyną drogę do ustawienia dłuższego.
  oldPassword: Joi.string().max(200).required(),
  newPassword: Joi.string().min(10).max(200).required().messages({
    // Kod, nie zdanie — komunikat po polsku składa strona (pages/users/[id].js).
    "string.min": "password_too_short",
    "string.max": "password_too_long",
  }),
});

// Do zmiany hasła potrzebne są wyłącznie te cztery kolumny — reszta konta nie ma
// tu czego szukać. passwordParams doszło razem z wersjonowaniem: stare hasło
// trzeba zweryfikować parametrami, którymi je policzono.
const findById = db.prepare(
  `SELECT id, passwordHash, passwordSalt, passwordParams FROM Users WHERE id = ?`
);
const updatePassword = db.prepare(
  `UPDATE Users
      SET passwordHash = @passwordHash, passwordSalt = @passwordSalt, passwordParams = @passwordParams
    WHERE id = @id`
);

const checkUser = (userID) => {
  const existingUser = findById.get(Number(userID));
  if (!existingUser) {
    throw new Error("user_not_found");
  }
  return existingUser;
};

const updateUserPassword = async (payload) => {
  const { userID, oldPassword, newPassword } = await schema.validateAsync(payload);
  const existingUser = checkUser(userID);

  // Parametrami Z WIERSZA: konto, które nie logowało się od podniesienia iteracji,
  // ma hash policzony po staremu.
  if (!(await verifyPassword(oldPassword, existingUser))) {
    // Kod, nie zdanie: komunikat dla człowieka składa strona (pages/users/[id].js),
    // tak samo jak przy rejestracji.
    throw new Error("wrong_old_password");
  }

  // Nowe hasło zawsze bieżącymi parametrami — zmiana hasła jest, obok logowania,
  // drugim momentem, w którym konto przechodzi na mocniejszy wariant.
  const record = await makePasswordRecord(newPassword);

  updatePassword.run({
    id: existingUser.id,
    ...record,
  });

  return { id: existingUser.id };
};

export default updateUserPassword;
