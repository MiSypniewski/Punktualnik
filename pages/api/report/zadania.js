import { getToken } from "next-auth/jwt";
import dayjs from "dayjs";
import { getByProject, getByUser, getSummary, iterateAllEntries } from "../../../services/entryStats";
import { sweepStaleEntries } from "../../../services/taskEntries";
import { canExportTasks } from "../../../services/roles";
import { num } from "../../../utils/csv";
import { isFormat, sendReport, streamReport } from "../../../utils/report";
import { formatDuration, timePart, TASK_QUERY_MAX } from "../../../utils";
import { visibleSections } from "../../../services/scope";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MODES = ["wpisy", "projekty", "porownanie"];

// Wymiar podajemy DWA razy, tak jak w eksporcie nadgodzin: raz jako liczbę
// z przecinkiem (Excel to zsumuje) i raz czytelnie dla człowieka. Bez tego
// pierwszego arkusz nie policzy sumy kolumny, bez drugiego nikt nie wie,
// czy 1,75 to godziny czy coś innego.
//
// CZTERY miejsca po przecinku, nie domyślne dwa: przy dwóch najmniejszą
// rozróżnialną wartością jest 0,01 h, czyli 36 sekund — każdy krótki wpis
// zaokrąglałby się do niej i suma kolumny w arkuszu rozjeżdżałaby się
// z kolumną czytelną tym bardziej, im więcej takich wpisów.
const HOURS_DECIMALS = 4;

const hoursPair = (seconds) => [
  num(seconds / 3600, HOURS_DECIMALS),
  formatDuration(seconds),
];

// Start i koniec z sekundami, mimo że na ekranie wystarcza "HH:mm": w arkuszu
// ktoś odejmie jedną kolumnę od drugiej i wynik musi zgadzać się z kolumną czasu.

// eslint-disable-next-line import/no-anonymous-default-export
export default async (req, res) => {
  const token = await getToken({ req });
  if (!token) {
    return res.status(401).json({ error: "not_authorized" });
  }
  // Eksport zadań całego zespołu — wyłącznie kierownik, jak przy czasach pracy.
  if (!canExportTasks(token.role)) {
    return res.status(403).json({ error: "permission_denied" });
  }
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const { tryb, from, to, projectID, userID, minMinutes, q, format = "csv" } = req.query;

  if (!isFormat(format)) {
    return res.status(400).json({ error: "bad_format", message: "format musi być csv albo xlsx" });
  }
  if (!MODES.includes(tryb)) {
    return res.status(400).json({ error: "bad_mode", message: `tryb musi być jednym z: ${MODES.join(", ")}` });
  }
  if (!DATE_RE.test(from || "") || !DATE_RE.test(to || "")) {
    return res.status(400).json({ error: "bad_date", message: "from/to muszą być w formacie YYYY-MM-DD" });
  }
  if (from > to) {
    return res.status(400).json({ error: "bad_range", message: "data 'od' jest późniejsza niż 'do'" });
  }
  for (const [name, v] of [["projectID", projectID], ["userID", userID], ["minMinutes", minMinutes]]) {
    if (v !== undefined && v !== "" && !/^\d+$/.test(v)) {
      return res.status(400).json({ error: "bad_param", message: `${name} musi być liczbą` });
    }
  }

  sweepStaleEntries();

  // Zasięg sekcyjny bierzemy z tokenu, nigdy z zapytania: kierownik dostanie
  // swoje sekcje nawet wtedy, gdy jawnie poda userID kogoś spoza zasięgu.
  //
  // Fraza szukana leci przycięta do tej samej długości co w formularzu —
  // eksport ma dać dokładnie to, co widać w tabeli, a nie inny wycinek.
  const filters = {
    from,
    to,
    projectID,
    userID,
    minMinutes,
    q: String(q ?? "").slice(0, TASK_QUERY_MAX),
    sections: visibleSections(token),
  };
  const stamp = `${from}_${to}`;

  if (tryb === "projekty") {
    const rows = getByProject(filters);
    const total = getSummary(filters).seconds || 1;

    return sendReport(res, {
      format,
      basename: `zadania_projekty_${stamp}`,
      sheet: "Projekty",
      header: ["Projekt", "Klient", "Liczba osób", "Liczba wpisów", "Czas [h]", "Czas", "Udział %"],
      rows: rows.map((p) => [
        p.name,
        p.client || "",
        p.people,
        p.entries,
        ...hoursPair(p.seconds),
        num((p.seconds / total) * 100, 1),
      ]),
    });
  }

  if (tryb === "porownanie") {
    const rows = getByUser(filters);

    return sendReport(res, {
      format,
      basename: `zadania_porownanie_${stamp}`,
      sheet: "Porównanie",
      header: [
        "Nazwisko",
        "Imię",
        "Sekcja",
        "Obecność [h]",
        "Obecność",
        "Zaraportowano [h]",
        "Zaraportowano",
        "Różnica [h]",
        "Różnica",
        "Pokrycie %",
      ],
      rows: rows.map((u) => [
        u.surname,
        u.name,
        u.section,
        ...hoursPair(u.present),
        ...hoursPair(u.reported),
        // Znak ma zostać widoczny również w wersji liczbowej — inaczej
        // "2,5" nie odróżni nadmiaru od niedoboru.
        num(u.diff / 3600, HOURS_DECIMALS),
        formatDuration(u.diff, { withSign: true }),
        u.coverage === null ? "" : u.coverage,
      ]),
    });
  }

  // Eksport szczegółowy jest jedynym bez górnego ograniczenia liczby wierszy
  // (obiecuje komplet), więc idzie STRUMIENIOWO: wiersze czytane leniwie prosto
  // z bazy i wypychane porcjami, zamiast sklejania całego pliku w pamięci.
  // Przy 1 GB bez swapu to różnica między działającym eksportem a cichym OOM.
  // Dotyczy obu formatów — `streamReport` nie materializuje generatora ani
  // przy CSV, ani przy XLSX.
  const toCells = (r) => [
    dayjs(r.data).format("YYYY-MM-DD"),
    r.surname,
    r.name,
    r.section,
    r.projectName || "(bez projektu)",
    r.projectClient || "",
    r.description,
    timePart(r.startedAt),
    timePart(r.endedAt),
    ...hoursPair(r.seconds),
    r.autoClosed ? "tak" : "nie",
    r.editedByName || "",
  ];

  const header = [
    "Data",
    "Nazwisko",
    "Imię",
    "Sekcja",
    "Projekt",
    "Klient",
    "Zadanie",
    "Start",
    "Koniec",
    "Czas [h]",
    "Czas",
    "Domknięty automatycznie",
    "Poprawił",
  ];

  function* cells() {
    for (const row of iterateAllEntries(filters)) yield toCells(row);
  }

  return streamReport(res, {
    format,
    basename: `zadania_${stamp}`,
    sheet: "Wpisy",
    header,
    rows: cells(),
  });
};
