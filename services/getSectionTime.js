import db from "./db";

const stmt = db.prepare(`SELECT * FROM Times WHERE section = ? AND data = ?`);

const getSectionTime = async (section, data) => {
  const times = stmt.all(section, data);

  return times.map(({ id, ...fields }) => ({
    airtableID: id,
    ...fields,
    overTime: Boolean(fields.overTime),
  }));
};

export default getSectionTime;
