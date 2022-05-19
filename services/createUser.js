import airDB from "../services/airtableClient";
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

const checkEmail = async (email) => {
  const existingUser = await airDB("Users")
    .select({ filterByFormula: `email="${email}"` })
    .firstPage();
  if (existingUser && existingUser[0]) {
    throw new Error("email_taken");
  }
};

const createUser = async (payload) => {
  const { email, name, surname, section, location, password } = await schema.validateAsync(payload);
  await checkEmail(email);

  const passwordSalt = crypto.randomBytes(256).toString("hex");
  const passwordHash = crypto.pbkdf2Sync(password, passwordSalt, 2137, 256, "sha512").toString("hex");

  const user = await airDB("Users").create([
    {
      fields: {
        name,
        surname,
        section,
        location,
        email,
        passwordHash,
        passwordSalt,
        role: "user",
        isActive: "Inactive",
      },
    },
  ]);

  return user;
};

export default createUser;
