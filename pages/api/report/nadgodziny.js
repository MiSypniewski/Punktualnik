import { getToken } from "next-auth/jwt";
import dayjs from "dayjs";
import "dayjs/locale/pl";
import getOvertimeRequests from "../../../services/getOvertimeRequests";
import getOvertimeBalances from "../../../services/getOvertimeBalances";
import { canApproveOvertime } from "../../../services/roles";
import { visibleSections } from "../../../services/scope";
import { kindLabel, statusLabel, signedMinutes, STATUS_KEYS } from "../../../services/overtimeKinds";
import { num } from "../../../utils/csv";
import { isFormat, sendReport } from "../../../utils/report";
import { formatMinutes } from "../../../utils";

dayjs.locale("pl");

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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

  const { tryb = "wnioski", userID, status, from, to, format = "csv" } = req.query;

  if (!isFormat(format)) {
    return res.status(400).json({ error: "bad_format", message: "format musi być csv albo xlsx" });
  }
  if (tryb !== "wnioski" && tryb !== "salda") {
    return res.status(400).json({ error: "bad_mode" });
  }
  if (status !== undefined && status !== "" && !STATUS_KEYS.includes(status)) {
    return res.status(400).json({ error: "bad_status" });
  }
  if (userID !== undefined && userID !== "" && !/^\d+$/.test(userID)) {
    return res.status(400).json({ error: "bad_user" });
  }
  for (const d of [from, to]) {
    if (d !== undefined && d !== "" && !DATE_RE.test(d)) {
      return res.status(400).json({ error: "bad_date", message: "from/to muszą być w formacie YYYY-MM-DD" });
    }
  }
  if (from && to && from > to) {
    return res.status(400).json({ error: "bad_range", message: "data 'od' jest późniejsza niż 'do'" });
  }

  // Zestawienie sald całego zespołu to widok zbiorczy — tylko kierownik.
  if (tryb === "salda") {
    if (!canApproveOvertime(token.role)) {
      return res.status(403).json({ error: "permission_denied" });
    }

    const header = ["Nazwisko", "Imię", "Sekcja", "Saldo (h)", "Saldo", "Oczekujące wnioski"];
    const rows = getOvertimeBalances(visibleSections(token)).map((u) => [
      u.surname,
      u.name,
      u.section,
      num(u.balance / 60), // godziny dziesiętnie — do dalszych obliczeń w Excelu
      formatMinutes(u.balance, { withSign: true }), // czytelne dla człowieka
      u.pendingCount || 0,
    ]);

    return sendReport(res, {
      format,
      basename: `nadgodziny_salda_${dayjs().format("YYYY-MM-DD")}`,
      sheet: "Salda",
      header,
      rows,
    });
  }

  // Tryb "wnioski": ta sama zasada co w GET /api/overtime — bez uprawnień
  // kierownika można pobrać wyłącznie własną historię, niezależnie od tego,
  // co przyjdzie w parametrze userID.
  const canSeeAll = canApproveOvertime(token.role);
  const effectiveUserID = canSeeAll ? userID : String(token.userID);

  // Pracownik pobiera wyłącznie własną historię (zawężenie po userID powyżej),
  // więc zasięg sekcyjny stosujemy tylko kierownikowi.
  // limit: null — eksport obiecuje komplet, w odróżnieniu od widoków, które
  // przycinają listę do OVERTIME_LIST_LIMIT.
  const rows = getOvertimeRequests(
    {
      userID: effectiveUserID,
      status,
      from,
      to,
      ...(canSeeAll ? { sections: visibleSections(token) } : {}),
    },
    { limit: null }
  );

  const header = [
    "Data",
    "Nazwisko",
    "Imię",
    "Sekcja",
    "Rodzaj",
    "Wymiar (h)",
    "Wymiar",
    "Status",
    "Powód",
    "Zdecydował",
    "Data decyzji",
    "Notatka do decyzji",
  ];

  const lines = rows.map((r) => [
    r.data,
    r.surname,
    r.name,
    r.section,
    kindLabel(r.kind),
    num(signedMinutes(r) / 60),
    formatMinutes(signedMinutes(r), { withSign: true }),
    statusLabel(r.status),
    r.reason,
    r.decidedByName,
    r.decidedAt ? dayjs(r.decidedAt).format("YYYY-MM-DD HH:mm") : "",
    r.decisionNote,
  ]);

  const zakres = from || to ? `_${from || "poczatek"}_${to || "dzis"}` : "";
  const osoba = effectiveUserID ? `_user${effectiveUserID}` : "";

  return sendReport(res, {
    format,
    basename: `nadgodziny${zakres}${osoba}`,
    sheet: "Wnioski",
    header,
    rows: lines,
  });
};
