import db from "./db";
import crypto from "crypto";
import Joi from "joi";

const schema = Joi.object({
  email: Joi.string().email().required(),
  name: Joi.string().required(),
  surname: Joi.string().required(),
  section: Joi.string().required(),
  location: Joi.string().required(),
  password: Joi.string().required(),
});

const findByEmail = db.prepare(`SELECT id FROM Users WHERE email = ?`);
const insertUser = db.prepare(
  `INSERT INTO Users (name, surname, section, location, email, passwordHash, passwordSalt, role, isActive)
   VALUES (@name, @surname, @section, @location, @email, @passwordHash, @passwordSalt, 'user', 0)`
);

const checkEmail = (email) => {
  if (findByEmail.get(email)) {
    throw new Error("email_taken");
  }
};

const createUser = async (payload) => {
  const { email, name, surname, section, location, password } = await schema.validateAsync(payload);
  checkEmail(email);

  const passwordSalt = crypto.randomBytes(256).toString("hex");
  const passwordHash = crypto.pbkdf2Sync(password, passwordSalt, 2137, 256, "sha512").toString("hex");

  const info = insertUser.run({
    name,
    surname,
    section,
    location,
    email,
    passwordHash,
    passwordSalt,
  });

  return { id: info.lastInsertRowid, name, surname, section, location, email, role: "user", isActive: 0 };
};

export default createUser;
