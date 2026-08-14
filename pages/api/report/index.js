import { getToken } from "next-auth/jwt";
import dayjs from "dayjs";
import "dayjs/locale/pl";
import getTimesReport from "../../../services/getTimesReport";
import { isStaff } from "../../../services/roles";

dayjs.locale("pl");

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Cudzysłów wokół każdego pola + podwojenie cudzysłowów w środku (RFC 4180).
const csvCell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;

const fmtTime = (v) => {
  const d = dayjs(v);
  return d.isValid() ? d.format("HH:mm:ss") : String(v ?? "");
};

// eslint-disable-next-line import/no-anonymous-default-export
export default async (req, res) => {
  const token = await getToken({ req });
  if (!token) {
    return res.status(401).json({ error: "not_authorized" });
  }
  // Eksport czasów wszystkich pracowników — tylko personel (editor / manager).
  if (!isStaff(token.role)) {
    return res.status(403).json({ error: "permission_denied" });
  }
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const { from, to, userID } = req.query;

  if (!DATE_RE.test(from || "") || !DATE_RE.test(to || "")) {
    return res.status(400).json({ error: "bad_date", message: "from/to muszą być w formacie YYYY-MM-DD" });
  }
  if (from > to) {
    return res.status(400).json({ error: "bad_range", message: "data 'od' jest późniejsza niż 'do'" });
  }
  if (userID !== undefined && userID !== "" && !/^\d+$/.test(userID)) {
    return res.status(400).json({ error: "bad_user" });
  }

  const rows = getTimesReport({ from, to, userID });

  const header = [
    "Data",
    "Imię",
    "Nazwisko",
    "Sekcja",
    "Lokalizacja",
    "Start",
    "Koniec",
    "Czas pracy",
    "Status",
    "Nadgodziny",
  ];

  const lines = rows.map((r) =>
    [
      String(r.data ?? "").slice(0, 10),
      r.name,
      r.surname,
      r.section,
      r.location,
      fmtTime(r.startTime),
      fmtTime(r.endTime),
      r.totalWorkTime,
      r.status,
      r.overTime ? "tak" : "nie",
    ]
      .map(csvCell)
      .join(";")
  );

  // BOM (﻿) + separator ";" => polski Excel/LibreOffice rozbija na kolumny
  // i poprawnie pokazuje polskie znaki.
  const csv = "﻿" + [header.map(csvCell).join(";"), ...lines].join("\r\n") + "\r\n";

  const namePart = userID ? `_user${userID}` : "";
  const filename = `czasy_${from}_${to}${namePart}.csv`;

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.status(200).send(csv);
};
