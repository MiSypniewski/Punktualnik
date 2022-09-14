import airDB from "./airtableClient";
import crypto from "crypto";
import Joi from "joi";

const schema = Joi.object({
  userID: Joi.number().required(),
  oldPassword: Joi.string().required(),
  newPassword: Joi.string().required(),
});

const checkUser = async (userID) => {
  const existingUser = await airDB("Users")
    .select({ filterByFormula: `ID="${userID}"` })
    .firstPage();
  if (existingUser && !existingUser[0]) {
    throw new Error("user_not_found");
  }
  return {
    airtableID: existingUser[0].id,
    ...existingUser[0].fields,
  };
};

const updateUserPassword = async (payload) => {
  const { userID, oldPassword, newPassword } = await schema.validateAsync(payload);
  const existingUser = await checkUser(userID);
  const oldPasswordSalt = existingUser.passwordSalt;
  const oldPasswordHash = crypto.pbkdf2Sync(oldPassword, oldPasswordSalt, 2137, 256, "sha512").toString("hex");

  if (oldPasswordHash !== existingUser.passwordHash) {
    throw new Error("old password incorect");
  }

  const newPasswordSalt = crypto.randomBytes(256).toString("hex");
  const newPasswordHash = crypto.pbkdf2Sync(newPassword, newPasswordSalt, 2137, 256, "sha512").toString("hex");

  const user = await airDB("Users").update([
    {
      id: existingUser.airtableID,
      fields: {
        passwordHash: newPasswordHash,
        passwordSalt: newPasswordSalt,
      },
    },
  ]);

  return user;
};

export default updateUserPassword;
