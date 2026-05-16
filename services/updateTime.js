import db from "./db";

const updateTimeStmt = db.prepare(
  `UPDATE Times SET
     userID = @userID, name = @name, surname = @surname, section = @section,
     location = @location, data = @data, startTime = @startTime, endTime = @endTime,
     totalWorkTime = @totalWorkTime, status = @status, overTime = @overTime
   WHERE id = @id`
);

const updateTime = async (airtableID, pyload) => {
  updateTimeStmt.run({
    id: Number(airtableID),
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

  return { id: Number(airtableID), ...pyload };
};

export default updateTime;
