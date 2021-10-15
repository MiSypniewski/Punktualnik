import airDB from "../services/airtableClient";

const getTime = async (data) => {
  const times = await airDB("Times")
    // .select({ filterByFormula: `AND(User="${user}", Data="${data}")` })
    .select({ filterByFormula: `Data="${data}"` })
    .firstPage();

  return times.map((time) => time.fields);
};

export default getTime;

// const getTime = async (maxRecords) => {
//   const times = await airDB("Times")
//     .select({
//       sort: [{ field: "ID", direction: "desc" }],
//       maxRecords,
//     })
//     .firstPage();

//   return times.map((time) => time.fields);
// };

// export default getTime;
