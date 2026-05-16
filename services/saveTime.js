import db from "./db";

const insertTime = db.prepare(
  `INSERT INTO Times (userID, name, surname, section, location, data, startTime, endTime, totalWorkTime, status, overTime)
   VALUES (@userID, @name, @surname, @section, @location, @data, @startTime, @endTime, @totalWorkTime, @status, @overTime)`
);

const saveTime = async (pyload) => {
  const info = insertTime.run({
    userID: Number(pyload.userID),
    name: pyload.name ?? null,
    surname: pyload.surname ?? null,
    section: pyload.section ?? null,
    location: pyload.location ?? null,
    data: pyload.data ?? null,
    startTime: pyload.startTime ?? null,
    endTime: pyload.endTime ?? null,
    totalWorkTime: pyload.totalWorkTime ?? null,
    status: pyload.status ?? null,
    overTime: pyload.overTime ? 1 : 0,
  });

  return { id: info.lastInsertRowid, ...pyload };
};

export default saveTime;
