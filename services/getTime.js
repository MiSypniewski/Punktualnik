import airDB from "./airtableClient";
import dayjs from "dayjs";
import "dayjs/locale/pl";
dayjs.locale("pl");

const getTime = async (userID) => {
  const data = dayjs().hour(3).minute(0).second(0).millisecond(0).format();
  const times = await airDB("Times")
    .select({ filterByFormula: `AND(userID="${userID}", data="${data}")` })
    // .select({ filterByFormula: `Data="${data}"` })
    .firstPage();

  return times.map((time) => {
    return {
      airtableID: time.id,
      ...time.fields,
    };
  });
};

export default getTime;
