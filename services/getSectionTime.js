import airDB from "./airtableClient";

const getSectionTime = async (section, data) => {
  console.log(data);
  const times = await airDB("Times")
    .select({ filterByFormula: `AND(section="${section}", data="${data}")` })
    // .select({ filterByFormula: `Data="${data}"` })
    .firstPage();
  // console.log(times);
  return times.map((time) => {
    return {
      airtableID: time.id,
      ...time.fields,
    };
  });
};

export default getSectionTime;
