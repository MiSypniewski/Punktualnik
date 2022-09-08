import airDB from "./airtableClient";

const getUserData = async (userID) => {
  const userData = await airDB("Users")
    .select({ filterByFormula: `ID="${userID}"` })
    .firstPage();

  return userData.map((user) => {
    user.fields.passwordHash = ";)";
    user.fields.passwordSalt = ";)";
    // user.email = ";)";
    return {
      // airtableID: user.id,
      ...user.fields,
    };
  });
};

export default getUserData;
