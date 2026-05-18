import db from "./db";

// `data` jest zapisywane jako ISO (np. 2026-05-18T03:00:00+02:00),
// więc filtrujemy po pierwszych 10 znakach = "YYYY-MM-DD".
// Dzięki temu nie ma problemu z przesunięciem strefy (DST) przy granicy zakresu.
const COLUMNS = `userID, name, surname, section, location, data, startTime, endTime, totalWorkTime, status, overTime`;

const stmtAll = db.prepare(
  `SELECT ${COLUMNS} FROM Times
   WHERE substr(data,1,10) BETWEEN @from AND @to
   ORDER BY data, surname, name`
);

const stmtUser = db.prepare(
  `SELECT ${COLUMNS} FROM Times
   WHERE substr(data,1,10) BETWEEN @from AND @to AND userID = @userID
   ORDER BY data, surname, name`
);

// from / to: "YYYY-MM-DD" (włącznie). userID: number albo null/undefined = wszyscy.
const getTimesReport = ({ from, to, userID }) => {
  const rows =
    userID === undefined || userID === null || userID === ""
      ? stmtAll.all({ from, to })
      : stmtUser.all({ from, to, userID: Number(userID) });

  return rows.map((r) => ({ ...r, overTime: Boolean(r.overTime) }));
};

export default getTimesReport;
