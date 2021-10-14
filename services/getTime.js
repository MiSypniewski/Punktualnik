import airDB from "../services/airtableClient";

const getRecent = async (maxRecords) => {
  const timers = await airDB("Times")
    .select({
      sort: [{ field: "ID", direction: "desc" }],
      maxRecords,
    })
    .firstPage();

  return timers.map((time) => time.fields);
};

export default getRecent;
