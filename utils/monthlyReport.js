import dayjs from "dayjs";
import { isWorkingDay } from "../services/workingDays";

// Miesięczne podsumowanie pracownika — sama arytmetyka, bez bazy.
//
// Ten plik NIE importuje ./db (services/workingDays.js też nie), więc da się go
// uruchomić poza Nextem i sprawdzić rachunek na ręcznie ułożonym miesiącu.
// Zapytania i zapis migawki siedzą w services/monthlyReport.js.
//
// Trzy źródła, które nigdzie indziej nie spotykają się na jednym ekranie:
// karty czasu (był w pracy), nieobecności (miał prawo nie być) i wpisy zadań
// (co zaraportował). Zestawienie jest wskazówką dla kierownika, nie podstawą
// rozliczeń — ta sama zasada co przy kolumnie „Pokrycie” w raporcie zadań.

export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Ile projektów pokazujemy z nazwy; reszta zlewa się w „pozostałe”. */
export const TOP_PROJECTS = 5;

/** Pierwszy i ostatni dzień miesiąca 'YYYY-MM' jako 'YYYY-MM-DD'. */
export const monthBounds = (month) => {
  const first = dayjs(`${month}-01`);
  return { from: first.format("YYYY-MM-DD"), to: first.endOf("month").format("YYYY-MM-DD") };
};

/** Dni robocze miesiąca jako zbiór 'YYYY-MM-DD'. */
export const workingDaysOf = (month) => {
  const { from, to } = monthBounds(month);
  const days = new Set();
  for (let d = dayjs(from); !d.isAfter(to, "day"); d = d.add(1, "day")) {
    if (isWorkingDay(d)) days.add(d.format("YYYY-MM-DD"));
  }
  return days;
};

const ratio = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : null);

/**
 * Projekty pracownika: największe z nazwy, ogon w jednym wierszu.
 *
 * Udział liczony od sumy WSZYSTKICH wpisów miesiąca, łącznie z weekendowymi —
 * pytanie brzmi „w co się angażuje”, a nie „co robił w godzinach pracy”.
 */
const foldProjects = (byProject, projects, total) => {
  const rows = [...byProject.entries()]
    .map(([id, seconds]) => {
      const project = id === null ? null : projects.get(id);
      return {
        id,
        name: project?.name ?? null,
        color: project?.color ?? null,
        seconds,
        share: ratio(seconds, total),
      };
    })
    .sort((a, b) => b.seconds - a.seconds);

  if (rows.length <= TOP_PROJECTS + 1) return rows;

  const rest = rows.slice(TOP_PROJECTS);
  const restSeconds = rest.reduce((sum, r) => sum + r.seconds, 0);
  return [
    ...rows.slice(0, TOP_PROJECTS),
    { id: "rest", rest: rest.length, name: null, color: null, seconds: restSeconds, share: ratio(restSeconds, total) },
  ];
};

/**
 * Metryki jednej osoby za jeden miesiąc.
 *
 * Każdy dzień roboczy trafia do DOKŁADNIE jednej z trzech szufladek, w tej
 * kolejności: przepracowany (jest karta) → nieobecność (zatwierdzony wniosek)
 * → bez ewidencji. Karta wygrywa z wnioskiem: ktoś, kto przyszedł mimo urlopu,
 * był w pracy, a liczenie go dwa razy rozjechałoby sumę z dniami roboczymi.
 *
 * @param {object} input
 * @param {Set<string>} input.workingDays dni robocze miesiąca
 * @param {Set<string>} input.cardDays dni z odbitą kartą
 * @param {{kind: string, dateFrom: string, dateTo: string}[]} input.absences zatwierdzone
 * @param {{data: string, projectID: number|null, seconds: number}[]} input.entries
 * @param {Map<number, {name: string, color: string}>} input.projects
 */
export const buildPersonReport = ({ workingDays, cardDays, absences, entries, projects }) => {
  let workedDays = 0;
  let gapDays = 0;
  const absenceByKind = {};

  for (const day of workingDays) {
    if (cardDays.has(day)) {
      workedDays += 1;
      continue;
    }
    // Daty to 'YYYY-MM-DD', więc porównanie tekstowe jest porównaniem dat.
    const absence = absences.find((a) => a.dateFrom <= day && a.dateTo >= day);
    if (absence) absenceByKind[absence.kind] = (absenceByKind[absence.kind] || 0) + 1;
    else gapDays += 1;
  }

  const absenceDays = Object.values(absenceByKind).reduce((sum, n) => sum + n, 0);

  // Czas z weekendów i świąt idzie OSOBNO. W liczniku średniej zawyżałby ją
  // (godziny są, dnia w mianowniku nie ma) — na to nacięły się raporty z Clockify.
  let reportedSeconds = 0;
  let offSeconds = 0;
  const offDays = new Set();
  const byProject = new Map();

  for (const entry of entries) {
    const seconds = entry.seconds || 0;
    if (workingDays.has(entry.data)) {
      reportedSeconds += seconds;
    } else {
      offSeconds += seconds;
      offDays.add(entry.data);
    }
    const key = entry.projectID ?? null;
    byProject.set(key, (byProject.get(key) || 0) + seconds);
  }

  const totalSeconds = reportedSeconds + offSeconds;

  return {
    workingDays: workingDays.size,
    workedDays,
    absenceDays,
    absenceByKind,
    gapDays,
    // Urlop nie obniża frekwencji: mianownikiem są dni, w które pracownik MIAŁ być.
    attendance: ratio(workedDays, workingDays.size - absenceDays),
    reportedSeconds,
    // Bez przepracowanego dnia średniej nie ma — zero sugerowałoby wynik.
    avgDailySeconds: workedDays > 0 ? Math.round(reportedSeconds / workedDays) : null,
    off: { days: offDays.size, seconds: offSeconds },
    totalSeconds,
    projects: foldProjects(byProject, projects, totalSeconds),
  };
};

/**
 * Średnia dzienna zespołu — WAŻONA, nie średnia ze średnich: suma czasu przez
 * sumę przepracowanych dni. Ktoś, kto był w pracy dwa dni, nie waży wtedy tyle,
 * co ktoś obecny cały miesiąc.
 *
 * @param {{reportedSeconds: number, workedDays: number}[]} reports
 */
export const teamAverage = (reports) => {
  const days = reports.reduce((sum, r) => sum + r.workedDays, 0);
  const seconds = reports.reduce((sum, r) => sum + r.reportedSeconds, 0);
  return { people: reports.length, avgDailySeconds: days > 0 ? Math.round(seconds / days) : null };
};
