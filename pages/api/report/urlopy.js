import { getToken } from "next-auth/jwt";
import dayjs from "dayjs";
import { getAbsences } from "../../../services/getAbsences";
import { getLeaveBalances } from "../../../services/leaveBalance";
import {
  ABSENCE_KIND_KEYS,
  ABSENCE_STATUS_KEYS,
  absenceKindLabel,
  absenceStatusLabel,
} from "../../../services/absenceKinds";
import { canApproveLeave } from "../../../services/roles";
import { visibleSections } from "../../../services/scope";
import { isFormat, sendReport } from "../../../utils/report";
import { now as appNow } from "../../../services/workday";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MODES = ["nieobecnosci", "salda"];

// eslint-disable-next-line import/no-anonymous-default-export
export default async (req, res) => {
  const token = await getToken({ req });
  if (!token) {
    return res.status(401).json({ error: "not_authorized" });
  }
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const {
    tryb = "nieobecnosci",
    userID = "",
    kind = "",
    status = "",
    from = "",
    to = "",
    year = "",
    format = "csv",
  } = req.query;

  if (!isFormat(format)) {
    return res.status(400).json({ error: "bad_format", message: "format musi być csv albo xlsx" });
  }
  if (!MODES.includes(tryb)) {
    return res.status(400).json({ error: "bad_mode", message: `tryb musi być jednym z: ${MODES.join(", ")}` });
  }
  if (status && !ABSENCE_STATUS_KEYS.includes(status)) {
    return res.status(400).json({ error: "bad_status" });
  }
  if (kind && !ABSENCE_KIND_KEYS.includes(kind)) {
    return res.status(400).json({ error: "bad_kind" });
  }
  if (userID && !/^\d+$/.test(userID)) {
    return res.status(400).json({ error: "bad_user" });
  }
  if (year && !/^\d{4}$/.test(year)) {
    return res.status(400).json({ error: "bad_year" });
  }
  for (const d of [from, to]) {
    if (d && !DATE_RE.test(d)) {
      return res.status(400).json({ error: "bad_date", message: "daty w formacie RRRR-MM-DD" });
    }
  }
  if (from && to && from > to) {
    return res.status(400).json({ error: "bad_range", message: "data „od” jest późniejsza niż „do”" });
  }

  const rok = year ? Number(year) : appNow().year();

  // Zestawienie sald to cudze dane — wyłącznie dla kierownika.
  if (tryb === "salda") {
    if (!canApproveLeave(token.role)) {
      return res.status(403).json({ error: "permission_denied" });
    }

    const header = ["Nazwisko", "Imię", "Sekcja", "Rok", "Przydzielone", "Wykorzystane", "Pozostało", "Oczekujące wnioski"];
    const rows = getLeaveBalances(visibleSections(token), rok).map((u) => [
      u.surname,
      u.name,
      u.section,
      rok,
      u.granted,
      u.used,
      u.left,
      u.pendingCount || 0,
    ]);

    return sendReport(res, { format, basename: `urlopy_salda_${rok}`, sheet: "Salda", header, rows });
  }

  // Tryb "nieobecnosci": ta sama zasada co w GET /api/absences — bez uprawnień
  // kierownika można pobrać wyłącznie własną historię, niezależnie od tego,
  // co przyjdzie w parametrze userID. Degradacja zamiast odmowy.
  const canSeeAll = canApproveLeave(token.role);
  const effectiveUserID = canSeeAll ? userID : String(token.userID);

  // limit: null — eksport obiecuje KOMPLET, w odróżnieniu od widoków, które
  // przycinają listę do ABSENCE_LIST_LIMIT.
  const rows = getAbsences(
    {
      userID: effectiveUserID,
      kind,
      status,
      from,
      to,
      ...(canSeeAll ? { sections: visibleSections(token) } : {}),
    },
    { limit: null }
  );

  const header = [
    "Od",
    "Do",
    "Nazwisko",
    "Imię",
    "Sekcja",
    "Rodzaj",
    "Dni robocze",
    "Rok rozliczeniowy",
    "Status",
    "Powód",
    "Wpisał",
    "Zdecydował",
    "Data decyzji",
    "Notatka do decyzji",
  ];

  const lines = rows.map((r) => [
    r.dateFrom,
    r.dateTo,
    r.surname,
    r.name,
    r.section,
    absenceKindLabel(r.kind),
    r.workDays,
    r.year,
    absenceStatusLabel(r.status),
    r.reason,
    // "Wpisał" ma sens tylko wtedy, gdy wpisał KTOŚ INNY niż właściciel wpisu —
    // przy własnym wniosku ta kolumna powtarzałaby nazwisko z kolumny obok.
    r.createdBy !== r.userID ? r.createdByName : "",
    r.decidedByName,
    r.decidedAt ? dayjs(r.decidedAt).format("YYYY-MM-DD HH:mm") : "",
    r.decisionNote,
  ]);

  const zakres = from || to ? `_${from || "poczatek"}_${to || "dzis"}` : "";
  const osoba = effectiveUserID ? `_user${effectiveUserID}` : "";

  return sendReport(res, {
    format,
    basename: `urlopy${zakres}${osoba}`,
    sheet: "Nieobecności",
    header,
    rows: lines,
  });
};
