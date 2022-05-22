// import airDB from "services/airtableClient";
import airDB from "./airtableClient";
import Joi from "joi";
import crypto from "crypto";

const schema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required(),
});

const authorizeUser = async (payload) => {
  const { email, password } = await schema.validateAsync(payload);

  const [user] = await airDB("Users")
    .select({ filterByFormula: `email="${email}"` })
    .firstPage();

  if (!user) {
    const passwordSalt = crypto.randomBytes(256).toString("hex");
    const passwordHash = crypto.pbkdf2Sync(password, passwordSalt, 2137, 256, `sha512`).toString(`hex`);
    return null;
  }

  const passwordHash = crypto.pbkdf2Sync(password, user.fields.passwordSalt, 2137, 256, `sha512`).toString(`hex`);

  // console.log(user.fields);

  if (passwordHash !== user.fields.passwordHash) {
    return null;
  }

  if (!user.fields.isActive) {
    return null;
  }

  return {
    id: user.id,
    email: user.fields.email,
    name: user.fields.name,
    role: user.fields.role,
    section: user.fields.section,
  };
};

export default authorizeUser;
