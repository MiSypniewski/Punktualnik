import airDB from "../services/airtableClient";

const getTime = async (maxRecords) => {
  const times = await airDB("Times")
    .select({
      sort: [{ field: "ID", direction: "desc" }],
      maxRecords,
    })
    .firstPage();

  return times.map((time) => time.fields);
};

export default getTime;
