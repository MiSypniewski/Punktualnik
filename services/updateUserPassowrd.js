import db from "./db";
import Joi from "joi";
import { hashPassword, hashesEqual, makeSalt } from "./password";

const schema = Joi.object({
  userID: Joi.number().required(),
  oldPassword: Joi.string().required(),
  newPassword: Joi.string().required(),
});

// Do zmiany hasła potrzebne są wyłącznie te trzy kolumny — reszta konta nie ma
// tu czego szukać.
const findById = db.prepare(`SELECT id, passwordHash, passwordSalt FROM Users WHERE id = ?`);
const updatePassword = db.prepare(
  `UPDATE Users SET passwordHash = @passwordHash, passwordSalt = @passwordSalt WHERE id = @id`
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
  const oldPasswordSalt = existingUser.passwordSalt;
  const oldPasswordHash = await hashPassword(oldPassword, oldPasswordSalt);

  if (!hashesEqual(oldPasswordHash, existingUser.passwordHash)) {
    // Kod, nie zdanie: komunikat dla człowieka składa strona (pages/users/[id].js),
    // tak samo jak przy rejestracji.
    throw new Error("wrong_old_password");
  }

  const newPasswordSalt = makeSalt();
  const newPasswordHash = await hashPassword(newPassword, newPasswordSalt);

  updatePassword.run({
    id: existingUser.id,
    passwordHash: newPasswordHash,
    passwordSalt: newPasswordSalt,
  });

  return { id: existingUser.id };
};

export default updateUserPassword;
