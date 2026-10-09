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

/** Ile zadań (opisów wpisów) trafia do raportu. */
export const TOP_TASKS = 10;

/**
 * Projekt, do którego pracownicy wpisują czas prywatny w godzinach pracy.
 *
 * Rozpoznawany PO NAZWIE, bez flagi w bazie: jest jeden, istnieje od początku
 * i tak samo nazywał się w Clockify. Zmiana nazwy projektu wyzeruje wskaźnik
 * „czas prywatny” w nowych raportach — wtedy poprawia się tę stałą.
 */
export const PRIVATE_PROJECT = "prywacizna";

export const isPrivateProject = (name) => String(name ?? "").trim().toLowerCase() === PRIVATE_PROJECT;

/**
 * Wniosek nadgodzinowy na co najmniej tyle minut nie opisuje dłuższego dnia
 * pracy, tylko ROZLICZENIE: bilans otwarcia, urlop wymieniony na nadgodziny,
 * dzień wolny odebrany z nadgodzin (w rejestrze: równe 8 h albo wpisy po 23 h
 * z powodem „stan początkowy”, „urlop z nadgodzin”). Raport pokazuje je na
 * liście, ale nie dolicza do nadgodzin miesiąca — inaczej wrzesień jednej
 * osoby miałby ich 44, a drugiej minus 49.
 *
 * To próg, nie pewność: prawdziwe 8 h nadgodzin jednego dnia też tu wpadnie.
 * Dlatego rozliczenia są na liście widoczne i podpisane, a nie ukryte.
 */
export const OVERTIME_BOOKKEEPING_MIN = 8 * 60;

/** Rodzaj "nieobecności", którego nie ma w tabeli Absences: dzień wolny za nadgodziny. */
export const OVERTIME_OFF = "overtime_off";

/** Powyżej tylu sekund zaraportowanych jednego dnia dzień idzie do sprawdzenia. */
export const LONG_DAY_SECONDS = 12 * 3600;

/** Pierwszy i ostatni dzień miesiąca 'YYYY-MM' jako 'YYYY-MM-DD'. */
export const monthBounds = (month) => {
  const first = dayjs(`${month}-01`);
  return { from: first.format("YYYY-MM-DD"), to: first.endOf("month").format("YYYY-MM-DD") };
};

/** Wszystkie dni miesiąca po kolei, jako 'YYYY-MM-DD'. */
export const daysOf = (month) => {
  const { from, to } = monthBounds(month);
  const days = [];
  for (let d = dayjs(from); !d.isAfter(to, "day"); d = d.add(1, "day")) days.push(d.format("YYYY-MM-DD"));
  return days;
};

/** Dni robocze miesiąca jako zbiór 'YYYY-MM-DD'. */
export const workingDaysOf = (month) => new Set(daysOf(month).filter((d) => isWorkingDay(d)));

export const ratio = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : null);

/** Udział z jednym miejscem po przecinku — czas prywatny bywa ułamkiem procenta. */
const share1 = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);

const mean = (values) => (values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null);

/**
 * Metryki jednej osoby za jeden miesiąc.
 *
 * Każdy dzień roboczy trafia do DOKŁADNIE jednej z trzech szufladek, w tej
 * kolejności: przepracowany → nieobecność (zatwierdzony wniosek) → bez
 * ewidencji. Praca wygrywa z wnioskiem: ktoś, kto przyszedł mimo urlopu, był
 * w pracy, a liczenie go dwa razy rozjechałoby sumę z dniami roboczymi.
 *
 * „Przepracowany” to dzień z odbitą kartą ALBO z zaraportowanym zadaniem. Sama
 * karta nie wystarcza jako definicja: dyrekcja kart nie odbija wcale, a zadania
 * raportuje — według kart miałaby zero dni pracy w miesiącu. Rozjazd między
 * jednym a drugim źródłem raport pokazuje osobno (cardOnlyDays, entryOnlyDays).
 *
 * @param {string|null} input.entriesFrom pierwszy dzień, z którego w bazie są
 *   jakiekolwiek wpisy zadań. Dni sprzed tej daty nie wchodzą do średniej ani
 *   do pokrycia — moduł zadań jeszcze nie istniał, więc „zero zaraportowane”
 *   nie jest tam informacją o pracowniku.
 * @param {object} input
 * @param {string} input.month 'YYYY-MM'
 * @param {{day: string, seconds: number, startMin: number|null, endMin: number|null, autoClosed: boolean}[]} input.cards
 * @param {{kind: string, dateFrom: string, dateTo: string}[]} input.absences zatwierdzone
 * @param {{data: string, projectID: number|null, seconds: number}[]} input.entries
 * @param {{description: string, projectID: number|null, seconds: number, entries: number}[]} input.tasks
 * @param {{entries: number, manual: number, edited: number, auto: number}} input.quality
 * @param {{data: string, kind: string, minutes: number, sign: number, reason: string|null}[]} input.overtime zatwierdzone
 * @param {Map<number, {name: string, color: string}>} input.projects
 */
export const buildPersonReport = ({
  month,
  cards = [],
  absences = [],
  entries = [],
  tasks = [],
  quality = { entries: 0, manual: 0, edited: 0, auto: 0 },
  overtime = [],
  projects,
  entriesFrom = null,
}) => {
  const allDays = daysOf(month);
  const { from, to } = monthBounds(month);
  const working = workingDaysOf(month);

  // --- karty: jeden dzień może mieć więcej niż jedną --------------------------
  const cardByDay = new Map();
  for (const card of cards) {
    const cur = cardByDay.get(card.day) || { seconds: 0, startMin: null, endMin: null, autoClosed: false };
    cur.seconds += card.seconds || 0;
    if (card.startMin !== null && (cur.startMin === null || card.startMin < cur.startMin)) cur.startMin = card.startMin;
    if (card.endMin !== null && (cur.endMin === null || card.endMin > cur.endMin)) cur.endMin = card.endMin;
    cur.autoClosed = cur.autoClosed || Boolean(card.autoClosed);
    cardByDay.set(card.day, cur);
  }

  // --- wpisy: suma na dzień i na projekt -------------------------------------
  const reportedByDay = new Map();
  const privateByDay = new Map();
  const byProject = new Map();
  for (const entry of entries) {
    const seconds = entry.seconds || 0;
    reportedByDay.set(entry.data, (reportedByDay.get(entry.data) || 0) + seconds);
    const key = entry.projectID ?? null;
    byProject.set(key, (byProject.get(key) || 0) + seconds);
    if (key !== null && isPrivateProject(projects.get(key)?.name)) {
      privateByDay.set(entry.data, (privateByDay.get(entry.data) || 0) + seconds);
    }
  }

  // Dzień wolny odebrany z nadgodzin: w rejestrze to wniosek "wcześniejsze
  // wyjście" na cały dzień. Formalnie nie jest nieobecnością z tabeli Absences,
  // ale dla raportu znaczy to samo — dzień z uzasadnieniem, nie luka w ewidencji.
  const dayOff = new Set(
    overtime.filter((o) => o.sign < 0 && o.minutes >= OVERTIME_BOOKKEEPING_MIN).map((o) => o.data)
  );

  // --- dzień po dniu ---------------------------------------------------------
  let workedDays = 0;
  let measuredDays = 0;
  let measuredPresent = 0;
  let workedOnAbsence = 0;
  let cardOnlyDays = 0;
  let entryOnlyDays = 0;
  let gapDays = 0;
  let reportedSeconds = 0;
  let offSeconds = 0;
  let offDays = 0;
  let presentSeconds = 0;
  let autoClosedCards = 0;
  const absenceByKind = {};
  const longDays = [];

  // Klucze jednoliterowe: tablica ma do 31 pozycji na osobę i miesiąc, a cała
  // siedzi w JSON-ie w bazie. d — dzień miesiąca, w — roboczy, c — karta,
  // p — obecność [s], r — zaraportowane [s], x — w tym prywatne [s], a — rodzaj
  // nieobecności, g — dzień bez ewidencji.
  const days = allDays.map((day) => {
    const isWorking = working.has(day);
    const card = cardByDay.get(day);
    const reported = reportedByDay.get(day) || 0;
    const row = { d: Number(day.slice(8)), w: isWorking ? 1 : 0, c: card ? 1 : 0, p: card?.seconds || 0, r: reported };

    const priv = privateByDay.get(day) || 0;
    if (priv) row.x = priv;
    if (card) {
      presentSeconds += card.seconds;
      if (card.autoClosed) autoClosedCards += 1;
    }
    if (reported > LONG_DAY_SECONDS) longDays.push({ day, seconds: reported });

    if (!isWorking) {
      // Czas z weekendów i świąt idzie OSOBNO. W liczniku średniej zawyżałby ją
      // (godziny są, dnia w mianowniku nie ma) — na to nacięły się raporty z Clockify.
      if (reported > 0) {
        offSeconds += reported;
        offDays += 1;
      }
      return row;
    }

    reportedSeconds += reported;
    if (card || reported > 0) {
      workedDays += 1;
      if (absences.some((x) => x.dateFrom <= day && x.dateTo >= day)) workedOnAbsence += 1;
      if (!entriesFrom || day >= entriesFrom) {
        measuredDays += 1;
        measuredPresent += card?.seconds || 0;
        if (card && reported === 0) cardOnlyDays += 1;
      }
      if (!card) entryOnlyDays += 1;
      return row;
    }
    // Daty to 'YYYY-MM-DD', więc porównanie tekstowe jest porównaniem dat.
    const absence = absences.find((a) => a.dateFrom <= day && a.dateTo >= day);
    if (absence) {
      absenceByKind[absence.kind] = (absenceByKind[absence.kind] || 0) + 1;
      row.a = absence.kind;
    } else if (dayOff.has(day)) {
      absenceByKind[OVERTIME_OFF] = (absenceByKind[OVERTIME_OFF] || 0) + 1;
      row.a = OVERTIME_OFF;
    } else {
      gapDays += 1;
      row.g = 1;
    }
    return row;
  });

  const absenceDays = Object.values(absenceByKind).reduce((sum, n) => sum + n, 0);
  const totalSeconds = reportedSeconds + offSeconds;

  // --- projekty --------------------------------------------------------------
  // Udział liczony od sumy WSZYSTKICH wpisów miesiąca, łącznie z weekendowymi —
  // pytanie brzmi „w co się angażuje”, a nie „co robił w godzinach pracy”.
  const projectRows = [...byProject.entries()]
    .map(([id, seconds]) => {
      const project = id === null ? null : projects.get(id);
      return {
        id,
        name: project?.name ?? null,
        color: project?.color ?? null,
        seconds,
        share: ratio(seconds, totalSeconds),
      };
    })
    .sort((a, b) => b.seconds - a.seconds);

  const privateSeconds = [...privateByDay.values()].reduce((a, b) => a + b, 0);

  // --- nadgodziny deklarowane (rejestr wniosków, nie rachunek z wpisów) -------
  const overtimeItems = overtime
    .map((o) => ({
      data: o.data,
      kind: o.kind,
      minutes: o.minutes * o.sign,
      reason: o.reason || null,
      ...(o.minutes >= OVERTIME_BOOKKEEPING_MIN && { bookkeeping: true }),
    }))
    .sort((a, b) => a.data.localeCompare(b.data));
  const real = overtimeItems.filter((o) => !o.bookkeeping);
  const sumMinutes = (rows) => rows.reduce((sum, o) => sum + o.minutes, 0);

  // --- nieobecności jako lista (termin, rodzaj, dni robocze W TYM miesiącu) ---
  const absenceItems = absences.map((a) => {
    const start = a.dateFrom < from ? from : a.dateFrom;
    const end = a.dateTo > to ? to : a.dateTo;
    return {
      kind: a.kind,
      dateFrom: a.dateFrom,
      dateTo: a.dateTo,
      days: allDays.filter((d) => d >= start && d <= end && working.has(d)).length,
    };
  });

  const starts = [...cardByDay.entries()].filter(([day, c]) => working.has(day) && c.startMin !== null);
  const ends = [...cardByDay.entries()].filter(([day, c]) => working.has(day) && c.endMin !== null && !c.autoClosed);

  return {
    v: 2,
    workingDays: working.size,
    workedDays,
    absenceDays,
    absenceByKind,
    gapDays,
    // Urlop nie obniża frekwencji: mianownikiem są dni, w które pracownik MIAŁ być.
    attendance: ratio(workedDays, working.size - absenceDays),
    reportedSeconds,
    totalSeconds,
    // Średniej nie ma bez przepracowanego dnia i bez JAKIEGOKOLWIEK wpisu: kto
    // zadań nie raportuje wcale (odbija tylko kartę), nie ma "średniej 0 h" —
    // nie ma jej w ogóle i nie ściąga w dół średniej zespołu.
    avgDailySeconds: measuredDays > 0 && reportedSeconds > 0 ? Math.round(reportedSeconds / measuredDays) : null,
    measuredDays,
    cardOnlyDays,
    entryOnlyDays,
    // Dni przepracowane mimo zatwierdzonej nieobecności — liczone jako praca.
    workedOnAbsence,
    ...(entriesFrom && entriesFrom > from && { entriesFrom }),
    off: { days: offDays, seconds: offSeconds },
    presentSeconds,
    // Ile czasu obecności ma pokrycie w zaraportowanych zadaniach — tylko
    // z dni, w których moduł zadań już działał.
    measuredPresent,
    coverage: reportedSeconds > 0 ? ratio(reportedSeconds, measuredPresent) : null,
    privateSeconds,
    privateShare: share1(privateSeconds, totalSeconds),
    projects: projectRows,
    projectCount: projectRows.filter((p) => p.id !== null).length,
    tasks: tasks
      .slice()
      .sort((a, b) => b.seconds - a.seconds)
      .slice(0, TOP_TASKS)
      .map((t) => ({
        description: t.description,
        project: t.projectID === null ? null : projects.get(t.projectID)?.name ?? null,
        seconds: t.seconds,
        entries: t.entries,
      })),
    quality: { ...quality, autoClosedCards },
    avgStartMin: mean(starts.map(([, c]) => c.startMin)),
    avgEndMin: mean(ends.map(([, c]) => c.endMin)),
    longDays,
    overtime: {
      plus: sumMinutes(real.filter((o) => o.minutes > 0)),
      minus: sumMinutes(real.filter((o) => o.minutes < 0)),
      net: sumMinutes(real),
      bookkeeping: sumMinutes(overtimeItems.filter((o) => o.bookkeeping)),
      items: overtimeItems,
    },
    absences: absenceItems,
    days,
  };
};

/**
 * Wskaźniki zespołu — wszystkie WAŻONE, nie średnie ze średnich: suma przez
 * sumę. Ktoś, kto był w pracy dwa dni, nie waży wtedy tyle, co ktoś obecny
 * cały miesiąc.
 */
export const teamStats = (reports) => {
  const sum = (rows, pick) => rows.reduce((total, r) => total + pick(r), 0);
  // Średnią i pokrycie liczymy z osób, które zadania w ogóle raportują.
  const reporting = reports.filter((r) => r.avgDailySeconds !== null);
  const days = sum(reporting, (r) => r.measuredDays);
  const covered = reporting.filter((r) => r.coverage !== null);

  return {
    people: reports.length,
    reporting: reporting.length,
    avgDailySeconds: days > 0 ? Math.round(sum(reporting, (r) => r.reportedSeconds) / days) : null,
    attendance: ratio(sum(reports, (r) => r.workedDays), sum(reports, (r) => r.workingDays - r.absenceDays)),
    privateShare: share1(sum(reports, (r) => r.privateSeconds), sum(reports, (r) => r.totalSeconds)),
    coverage: ratio(sum(covered, (r) => r.reportedSeconds), sum(covered, (r) => r.measuredPresent)),
  };
};

/**
 * Miejsce w zespole wg średniej dziennej (1 = najwyższa). Osoby bez średniej
 * nie są klasyfikowane; remis daje to samo miejsce.
 */
export const rankByAverage = (reports) => {
  const ranked = reports.filter((r) => r.avgDailySeconds !== null).map((r) => r.avgDailySeconds);
  return reports.map((r) =>
    r.avgDailySeconds === null ? null : { place: ranked.filter((v) => v > r.avgDailySeconds).length + 1, of: ranked.length }
  );
};
