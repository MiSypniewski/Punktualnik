import db from "./db";
import dayjs from "dayjs";
import "dayjs/locale/pl";
dayjs.locale("pl");

const stmt = db.prepare(`SELECT * FROM Times WHERE userID = ? AND data = ?`);

const getTime = async (userID) => {
  const data = dayjs().hour(3).minute(0).second(0).millisecond(0).format();
  const times = stmt.all(Number(userID), data);

  return times.map(({ id, ...fields }) => ({
    airtableID: id,
    ...fields,
    overTime: Boolean(fields.overTime),
  }));
};

export default getTime;
