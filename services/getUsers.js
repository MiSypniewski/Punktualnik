import airDB from "../services/airtableClient";

const getUsers = async (section) => {
  const users = await airDB("Users")
    // .select({ filterByFormula: `AND(User="${user}", Data="${data}")` })
    .select({ filterByFormula: `AND(Section="${section}", IsActive="Active")` })
    .firstPage();

  return users.map((user) => user.fields);
};

export default getUsers;
