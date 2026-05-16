import db from "./db";
import Joi from "joi";
import crypto from "crypto";

const schema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required(),
});

const findByEmail = db.prepare(`SELECT * FROM Users WHERE email = ?`);

const authorizeUser = async (payload) => {
  const { email, password } = await schema.validateAsync(payload);

  const user = findByEmail.get(email);

  if (!user) {
    return null;
  }

  const passwordHash = crypto.pbkdf2Sync(password, user.passwordSalt, 2137, 256, `sha512`).toString(`hex`);

  if (passwordHash !== user.passwordHash) {
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
