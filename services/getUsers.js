import airDB from "./airtableClient";

const getUsers = async (section) => {
  const users = await airDB("Users")
    // .select({ filterByFormula: `AND(User="${user}", Data="${data}")` })
    .select({ filterByFormula: `AND(Section="${section}", role="user", IsActive="1")` })
    .firstPage();

  return users.map((user) => {
    user.fields.passwordHash = ";)";
    user.fields.passwordSalt = ";)";
    user.email = ";)";
    return user.fields;
  });
};

export default getUsers;
