import airDB from "../services/airtableClient";
import crypto from "crypto";
import Joi from "joi";

const schema = Joi.object({
  email: Joi.string().email().required(),
  name: Joi.string().required(),
  surname: Joi.string().required(),
  section: Joi.string().required(),
  location: Joi.string().required(),
  login: Joi.string().required(),
  password: Joi.string().required(),
});

const create = async (payload) => {
  const { email, name, surname, section, location, login, password } = await schema.validateAsync(payload);
  const passwordSalt = crypto.randomBytes(256).toString("hex");
  const passwordHash = crypto.pbkdf2Sync(password, passwordSalt, 2137, 256, "sha512").toString("hex");

  const user = await airDB("users").create([
    {
      fields: {
        email,
        name,
        surname,
        section,
        location,
        login,
        passwordSalt,
        passwordHash,
        role: "user",
      },
    },
  ]);

  return user;
};
