import airDB from "./airtableClient";

const getSectionTime = async (section, data) => {
  const times = await airDB("Times")
    .select({ filterByFormula: `AND(Section="${section}", Data="${data}")` })
    // .select({ filterByFormula: `Data="${data}"` })
    .firstPage();
  console.log(times);
  return times.map((time) => time.fields);
};

export default getSectionTime;
