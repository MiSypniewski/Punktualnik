import db from "./db";
import Joi from "joi";
import { hashPassword, hashesEqual } from "./password";

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

const authorizeUser = async (payload) => {
  const { email, password } = await schema.validateAsync(payload);

  const user = findByEmail.get(email);

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
