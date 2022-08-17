import airDB from "./airtableClient";

const getTime = async (userID, data) => {
  const times = await airDB("Times")
    .select({ filterByFormula: `AND(userID="${userID}", data="${data}")` })
    // .select({ filterByFormula: `Data="${data}"` })
    .firstPage();

  return times.map((time) => time.fields);
};

export default getTime;
