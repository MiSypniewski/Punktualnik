import { getToken } from "next-auth/jwt";
import dayjs from "dayjs";
import "dayjs/locale/pl";
import getTimesReport from "../../../services/getTimesReport";
import { canExportTimes } from "../../../services/roles";
import { isFormat, sendReport } from "../../../utils/report";
import { visibleSections } from "../../../services/scope";

dayjs.locale("pl");

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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
  // Eksport czasów wszystkich pracowników — wyłącznie kierownik.
  // Kiosk (editor) służy tylko do odbijania kart na wspólnym ekranie.
  if (!canExportTimes(token.role)) {
    return res.status(403).json({ error: "permission_denied" });
  }
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const { from, to, userID, format = "csv" } = req.query;

  if (!isFormat(format)) {
    return res.status(400).json({ error: "bad_format", message: "format musi być csv albo xlsx" });
  }
  if (!DATE_RE.test(from || "") || !DATE_RE.test(to || "")) {
    return res.status(400).json({ error: "bad_date", message: "from/to muszą być w formacie YYYY-MM-DD" });
  }
  if (from > to) {
    return res.status(400).json({ error: "bad_range", message: "data 'od' jest późniejsza niż 'do'" });
  }
  if (userID !== undefined && userID !== "" && !/^\d+$/.test(userID)) {
    return res.status(400).json({ error: "bad_user" });
  }

  // Zasięg sekcyjny: kierownik dostaje swoje sekcje, edytor własną.
  const rows = getTimesReport({ from, to, userID, sections: visibleSections(token) });

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

  const lines = rows.map((r) => [
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
  ]);

  const namePart = userID ? `_user${userID}` : "";
  return sendReport(res, {
    format,
    basename: `czasy_${from}_${to}${namePart}`,
    sheet: "Czasy pracy",
    header,
    rows: lines,
  });
};
