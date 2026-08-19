import db from "./db";
import crypto from "crypto";
import Joi from "joi";

const schema = Joi.object({
  userID: Joi.number().required(),
  oldPassword: Joi.string().required(),
  newPassword: Joi.string().required(),
});

const findById = db.prepare(`SELECT * FROM Users WHERE id = ?`);
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
  const oldPasswordHash = crypto.pbkdf2Sync(oldPassword, oldPasswordSalt, 2137, 256, "sha512").toString("hex");

  if (oldPasswordHash !== existingUser.passwordHash) {
    // Kod, nie zdanie: komunikat dla człowieka składa strona (pages/users/[id].js),
    // tak samo jak przy rejestracji.
    throw new Error("wrong_old_password");
  }

  const newPasswordSalt = crypto.randomBytes(256).toString("hex");
  const newPasswordHash = crypto.pbkdf2Sync(newPassword, newPasswordSalt, 2137, 256, "sha512").toString("hex");

  updatePassword.run({
    id: existingUser.id,
    passwordHash: newPasswordHash,
    passwordSalt: newPasswordSalt,
  });

  return { id: existingUser.id };
};

export default updateUserPassword;
