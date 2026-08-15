import { getToken } from "next-auth/jwt";
import dayjs from "dayjs";
import { getByProject, getByUser, getEntries, getSummary } from "../../../services/entryStats";
import { closeStaleEntries } from "../../../services/taskEntries";
import { canExportTasks } from "../../../services/roles";
import { buildCsv, sendCsv, plNumber } from "../../../utils/csv";
import { formatMinutes } from "../../../utils";
import { visibleSections } from "../../../services/scope";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MODES = ["wpisy", "projekty", "porownanie"];

// Wymiar podajemy DWA razy, tak jak w eksporcie nadgodzin: raz jako liczbę
// z przecinkiem (Excel to zsumuje) i raz czytelnie dla człowieka. Bez tego
// pierwszego arkusz nie policzy sumy kolumny, bez drugiego nikt nie wie,
// czy 1,75 to godziny czy coś innego.
const hoursPair = (minutes) => [plNumber(minutes / 60), formatMinutes(minutes)];

const hhmm = (ts) => String(ts ?? "").slice(11, 16);

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

  const { tryb, from, to, projectID, userID, minMinutes } = req.query;

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

  closeStaleEntries();

  // Zasięg sekcyjny bierzemy z tokenu, nigdy z zapytania: kierownik dostanie
  // swoje sekcje nawet wtedy, gdy jawnie poda userID kogoś spoza zasięgu.
  const filters = { from, to, projectID, userID, minMinutes, sections: visibleSections(token) };
  const stamp = `${from}_${to}`;

  if (tryb === "projekty") {
    const rows = getByProject(filters);
    const total = getSummary(filters).minutes || 1;

    const csv = buildCsv(
      ["Projekt", "Klient", "Liczba osób", "Liczba wpisów", "Czas [h]", "Czas", "Udział %"],
      rows.map((p) => [
        p.name,
        p.client || "",
        p.people,
        p.entries,
        ...hoursPair(p.minutes),
        plNumber((p.minutes / total) * 100, 1),
      ])
    );
    return sendCsv(res, `zadania_projekty_${stamp}.csv`, csv);
  }

  if (tryb === "porownanie") {
    const rows = getByUser(filters);

    const csv = buildCsv(
      [
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
      rows.map((u) => [
        u.surname,
        u.name,
        u.section,
        ...hoursPair(u.present),
        ...hoursPair(u.reported),
        // Znak ma zostać widoczny również w wersji liczbowej — inaczej
        // "2,5" nie odróżni nadmiaru od niedoboru.
        plNumber(u.diff / 60),
        formatMinutes(u.diff, { withSign: true }),
        u.coverage === null ? "" : u.coverage,
      ])
    );
    return sendCsv(res, `zadania_porownanie_${stamp}.csv`, csv);
  }

  // "all", nie domyślne "view": eksport ma dać komplet, nie pierwsze 500 wierszy.
  const { rows } = getEntries(filters, "all");

  const csv = buildCsv(
    [
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
    ],
    rows.map((r) => [
      dayjs(r.data).format("YYYY-MM-DD"),
      r.surname,
      r.name,
      r.section,
      r.projectName,
      r.projectClient || "",
      r.description,
      hhmm(r.startedAt),
      hhmm(r.endedAt),
      ...hoursPair(r.minutes),
      r.autoClosed ? "tak" : "nie",
      r.editedByName || "",
    ])
  );
  return sendCsv(res, `zadania_${stamp}.csv`, csv);
};
