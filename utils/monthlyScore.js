// Ocena miesiąca i obserwacje — reguły, które wcześniej żyły w ręcznie
// składanych raportach HR (Clockify). Bez bazy i bez Reacta: liczy z migawki
// (utils/monthlyReport.js) i z podocen wpisanych przez kierownika.
//
// Ocena łączy dwie rzeczy o różnej naturze i raport ma to pokazywać uczciwie:
//  - regularność i dyscyplina wynikają z liczb,
//  - kompetencje techniczne, dokumentacja i inicjatywa to OSĄD kierownika.
// Bez tych trzech podocen ocena nie powstaje wcale — połowa wzoru byłaby zgadywana.

const hours = (seconds) => (seconds || 0) / 3600;

/** Wagi składowych; suma = 1. */
export const WEIGHTS = { tech: 0.3, regularity: 0.25, docs: 0.15, discipline: 0.2, initiative: 0.1 };

/** Podoceny wpisywane ręcznie — klucz, etykieta. */
export const MANUAL_CRITERIA = [
  ["tech", "Kompetencje techniczne"],
  ["docs", "Dokumentacja"],
  ["initiative", "Inicjatywa / rozwój"],
];

/**
 * Kotwice skali dla podocen kierownika: pytanie, na które odpowiada liczba,
 * i opis kilku punktów skali. Bez nich „7” znaczyło u każdego kierownika co
 * innego, a podoceny to ponad połowa oceny ogólnej.
 *
 * Punkty kotwic pasują do etykiet oceny ogólnej (scoreLabel): 3 — wymaga
 * poprawy, 5–6 — dobry, 8 — bardzo dobry, 10 — wyróżniający się. Standardem
 * stanowiska jest 6; w inicjatywie 5, bo spokojny miesiąc bez niczego
 * „ponad” nie jest powodem do obniżki.
 */
export const SCORE_ANCHORS = {
  tech: {
    question: "Jak dobrze i jak samodzielnie robi swoją robotę techniczną?",
    source: "Lista zadań i projekty w raporcie pokazują, czym się zajmował — nie, jak mu poszło. Reszta: SNOW, reklamacje, własna wiedza.",
    anchors: [
      [3, "Typowe zadania (serwis drukarki, pamięć fiskalna, legalizacja) często wymagają pomocy albo poprawek; zdarzają się powtórne wyjazdy z jego winy."],
      [5, "Typowe zadania robi sam, ale trudniejsze przypadki oddaje dalej albo się w nich gubi. Pojedyncze poprawki."],
      [6, "Standard: typowe zadania robi sam i poprawnie, poprawki są wyjątkiem."],
      [8, "Robi też rzeczy nietypowe — awarie bez oczywistej przyczyny, otwarcia i remonty sklepów, namioty. Inni przychodzą do niego po pomoc."],
      [10, "Rozwiązuje problemy, z którymi nie poradzili sobie inni, albo ma specjalizację, której nikt w zespole nie ma — i w tym miesiącu było to widać na konkretnym przypadku."],
    ],
  },
  docs: {
    question: "Czy po jego pracy da się bez dopytywania ustalić, co zrobił? (wpisy zadań, GAM/SNOW, maile)",
    source: "Oceniasz treść opisów. Pokrycie i dni z kartą bez zadań to dyscyplina raportowania — nie karz za nie drugi raz.",
    anchors: [
      [3, "Opisy szczątkowe („serwis”, „sklep”) albo żadne; zgłoszenia zamykane bez opisu. Żeby wiedzieć, co się stało, trzeba dzwonić."],
      [5, "Większość ma opis, ale z lukami — bez numeru sklepu, urządzenia albo wyniku. Uzupełnia po przypomnieniu."],
      [6, "Standard: wpisy i zgłoszenia mają sklep, co zrobiono i z jakim skutkiem. Dopytywać trzeba rzadko."],
      [8, "Opisy na tyle dobre, że inny serwisant przejmie temat bez rozmowy. Pisane na bieżąco, nie na koniec dnia."],
      [10, "Jak 8, a do tego tworzy dokumentację, z której korzystają inni: instrukcje, opis typowej awarii, porządek w GAM."],
    ],
  },
  initiative: {
    question: "Czy zrobił w tym miesiącu coś ponad przydzielone zadania?",
    source: "Spokojny miesiąc to 5, nie obniżka. Nie przepisuj liczby z poprzedniego miesiąca — oceniasz ten.",
    anchors: [
      [3, "Unika nowych tematów, odmawia zastępstw, nie przekazuje dalej problemów, które zauważył."],
      [5, "Neutralnie: robi swoje i w tym miesiącu nic ponad to."],
      [6, "Drobne rzeczy z własnej woli: zgłosił usterkę procesu, pomógł koledze, wziął zastępstwo."],
      [8, "Konkretny wkład: szkolenie (prowadzone albo ukończone), wdrożenie nowej osoby, usprawnienie, które weszło w życie, nowy obszar."],
      [10, "Inicjatywa, która zmieniła pracę zespołu albo firmy: nowy proces, rekrutacja, rozwiązanie problemu ciągnącego się od miesięcy."],
    ],
  },
};

/**
 * Kotwice najbliższe wpisanej wartości — przy remisie (7 między 6 a 8) obie.
 * @returns {number[]} punkty skali do podświetlenia; pusta, gdy wartość nie jest liczbą 0–10
 */
export const nearestAnchors = (key, value) => {
  const n = typeof value === "string" ? Number(value.replace(",", ".")) : value;
  if (value === "" || value === null || value === undefined || !Number.isFinite(n) || n < 0 || n > 10) return [];
  const points = SCORE_ANCHORS[key].anchors.map(([p]) => p);
  const best = Math.min(...points.map((p) => Math.abs(p - n)));
  return points.filter((p) => Math.abs(p - n) === best);
};

/** Podoceny skrajne wymagają uzasadnienia — tam osąd najbardziej rozjeżdża się między kierownikami. */
export const JUSTIFY_LOW = 4;
export const JUSTIFY_HIGH = 9;

export const needsJustification = (scores) =>
  MANUAL_CRITERIA.some(([key]) => {
    const v = scores[key];
    const n = typeof v === "string" ? Number(v.replace(",", ".")) : v;
    return v !== "" && v !== null && v !== undefined && Number.isFinite(n) && (n <= JUSTIFY_LOW || n >= JUSTIFY_HIGH);
  });

/** Regularność ze średniej dziennej [h]. */
export const regularityScore = (avgDailySeconds) => {
  if (avgDailySeconds === null || avgDailySeconds === undefined) return null;
  const h = hours(avgDailySeconds);
  if (h >= 8) return 10;
  if (h >= 7.5) return 8.5;
  if (h >= 7) return 7.5;
  if (h >= 6.5) return 6;
  if (h >= 6) return 5;
  return 3;
};

/** Dyscyplina z udziału czasu prywatnego [%]. */
export const disciplineScore = (privateShare) => {
  if (privateShare < 2) return 10;
  if (privateShare < 5) return 7.5;
  if (privateShare < 10) return 5;
  return 4;
};

export const scoreLabel = (score) => {
  if (score < 5) return "Wymaga poprawy";
  if (score < 7) return "Dobry";
  if (score <= 8.5) return "Bardzo dobry";
  return "Wyróżniający się";
};

/** Gwiazdki miesiąca — wyłącznie ze średniej dziennej, więc bez udziału kierownika. */
export const monthStars = (avgDailySeconds) => {
  if (avgDailySeconds === null || avgDailySeconds === undefined) return null;
  const h = hours(avgDailySeconds);
  if (h >= 7.5) return 5;
  if (h >= 6.5) return 4;
  if (h >= 5.5) return 3;
  return 2;
};

export const starString = (n) => (n ? "★".repeat(n) + "☆".repeat(5 - n) : "—");

const isScore = (v) => typeof v === "number" && v >= 0 && v <= 10;

/**
 * @param {object} report migawka miesiąca
 * @param {{tech: number, docs: number, initiative: number}|null} review podoceny kierownika
 * @returns {null | {score: number, label: string, parts: object}} null, gdy brakuje podocen albo średniej
 */
export const computeScore = (report, review) => {
  const regularity = regularityScore(report.avgDailySeconds);
  if (!review || regularity === null) return null;
  if (!isScore(review.tech) || !isScore(review.docs) || !isScore(review.initiative)) return null;

  const parts = {
    tech: review.tech,
    regularity,
    docs: review.docs,
    discipline: disciplineScore(report.privateShare),
    initiative: review.initiative,
  };
  const raw = Object.keys(WEIGHTS).reduce((sum, key) => sum + parts[key] * WEIGHTS[key], 0);
  const score = Math.round(raw * 10) / 10;

  return { score, label: scoreLabel(score), parts };
};

// --- progi kolorów ----------------------------------------------------------
// Te same wartości co w raportach ręcznych, żeby liczba zielona tam była
// zielona i tutaj.

export const attendanceTone = (pct) => (pct === null ? "neutral" : pct >= 90 ? "ok" : pct >= 70 ? "neutral" : "danger");

export const averageTone = (seconds) =>
  seconds === null ? "neutral" : hours(seconds) >= 7.5 ? "ok" : hours(seconds) >= 6 ? "neutral" : "danger";

export const privateTone = (share) => (share < 2 ? "ok" : share < 10 ? "neutral" : "danger");

// --- obserwacje ---------------------------------------------------------------

const h1 = (seconds) => `${hours(seconds).toFixed(1).replace(".", ",")} h`;
const hm = (minutes) => {
  const abs = Math.abs(Math.round(minutes));
  return `${minutes < 0 ? "−" : ""}${Math.floor(abs / 60)} h ${String(abs % 60).padStart(2, "0")} min`;
};
const days = (n) => (n === 1 ? "1 dzień" : `${n} dni`);

/**
 * Obserwacje wyprowadzone z liczb. Każda reguła to jedno zdanie z konkretną
 * wartością — raport ręczny psuł się dokładnie tam, gdzie opis przestawał
 * zgadzać się z danymi, więc tutaj opis JEST danymi.
 *
 * @param {object} r migawka miesiąca (z polem team)
 * @param {object|null} prev migawka poprzedniego miesiąca tej osoby
 * @returns {{tone: "pos"|"neu"|"neg", text: string}[]}
 */
export const observe = (r, prev = null) => {
  const out = [];
  const add = (tone, text) => out.push({ tone, text });
  const team = r.team || {};

  if (r.workedDays === 0 && r.totalSeconds === 0) {
    add("neu", "Brak kart czasu i zaraportowanych zadań w tym miesiącu — raport nie ma czego oceniać.");
    return out;
  }

  // Średnia dzienna na tle zespołu i normy.
  if (r.avgDailySeconds !== null) {
    const diffMin = team.avgDailySeconds !== null ? (r.avgDailySeconds - team.avgDailySeconds) / 60 : null;
    if (team.rank?.place === 1 && team.rank.of > 1) {
      add("pos", `Najwyższa średnia dzienna w zespole: ${h1(r.avgDailySeconds)} przy średniej zespołu ${h1(team.avgDailySeconds)}.`);
    } else if (diffMin !== null && diffMin >= 30) {
      add("pos", `Średnia dzienna ${h1(r.avgDailySeconds)} — o ${hm(diffMin)} powyżej średniej zespołu (${h1(team.avgDailySeconds)}).`);
    } else if (diffMin !== null && diffMin <= -45) {
      add("neg", `Średnia dzienna ${h1(r.avgDailySeconds)} — o ${hm(-diffMin)} poniżej średniej zespołu (${h1(team.avgDailySeconds)}).`);
    } else if (diffMin !== null) {
      add("neu", `Średnia dzienna ${h1(r.avgDailySeconds)}, zbliżona do średniej zespołu (${h1(team.avgDailySeconds)}).`);
    }
    if (r.avgDailySeconds >= 8 * 3600) add("pos", "Średnia dzienna na poziomie pełnej normy 8 h lub wyżej.");
    else if (r.avgDailySeconds < 6 * 3600) add("neg", "Średnia dzienna poniżej 6 h — ponad dwie godziny dziennie bez zaraportowanego zadania.");
  } else if (r.workedDays > 0) {
    add("neu", `Obecność wg kart czasu w ${r.workedDays} dniach roboczych, bez żadnego zaraportowanego zadania — średniej dziennej nie ma z czego policzyć.`);
  }
  if (r.entriesFrom) {
    add("neu", `Wpisy zadań istnieją dopiero od ${r.entriesFrom}; średnia dzienna i pokrycie obejmują ${r.measuredDays} dni od tej daty, a łączne godziny nie są porównywalne z pełnym miesiącem.`);
  }
  if (r.cardOnlyDays >= 3) {
    add("neg", `Dni z odbitą kartą czasu, ale bez żadnego zaraportowanego zadania: ${r.cardOnlyDays}.`);
  }
  if (r.entryOnlyDays >= 3 && r.entryOnlyDays < r.workedDays) {
    add("neu", `Dni z zaraportowanymi zadaniami, ale bez karty czasu: ${r.entryOnlyDays}.`);
  } else if (r.entryOnlyDays > 0 && r.entryOnlyDays === r.workedDays) {
    add("neu", "Brak kart czasu w całym miesiącu — obecność znana wyłącznie z zaraportowanych zadań.");
  }

  // Obecność.
  if (r.gapDays === 0 && r.workedDays > 0) {
    add("pos", `Komplet ewidencji: każdy dzień roboczy ma kartę czasu, wpis zadania albo zatwierdzoną nieobecność (${r.workedDays} przepracowanych z ${r.workingDays}).`);
  } else if (r.gapDays >= 3) {
    add("neg", `Dni robocze bez karty czasu, bez wpisów i bez zatwierdzonej nieobecności: ${r.gapDays} — do wyjaśnienia.`);
  } else if (r.gapDays > 0) {
    add("neu", `Dni robocze bez karty czasu, bez wpisów i bez zatwierdzonej nieobecności: ${r.gapDays}.`);
  }
  if (r.workedOnAbsence > 0) {
    add("neu", `Praca w dni objęte zatwierdzoną nieobecnością: ${r.workedOnAbsence} — policzone jako dni przepracowane.`);
  }
  if (r.absenceDays >= 5) add("neu", `Zatwierdzone nieobecności: ${r.absenceDays} z ${r.workingDays} dni roboczych.`);

  // Pokrycie obecności zadaniami.
  if (r.coverage !== null) {
    if (r.coverage < 80) add("neg", `Zadania pokrywają ${r.coverage}% czasu obecności (${h1(r.reportedSeconds)} z ${h1(r.measuredPresent)} wg kart).`);
    else if (r.coverage > 110) add("neu", `Zaraportowano więcej, niż wynika z kart czasu (${r.coverage}% obecności) — praca poza kartą albo nieodbite wejścia.`);
    else if (r.coverage >= 95) add("pos", `Zadania pokrywają ${r.coverage}% czasu obecności — ewidencja jest kompletna.`);
  }

  // Czas prywatny.
  if (r.totalSeconds > 0) {
    if (r.privateSeconds === 0) add("pos", "Brak czasu prywatnego w godzinach pracy (0%).");
    else if (r.privateShare >= 10) add("neg", `Czas prywatny to ${String(r.privateShare).replace(".", ",")}% zaraportowanego czasu (${h1(r.privateSeconds)}).`);
    else if (r.privateShare >= 2) add("neu", `Czas prywatny: ${String(r.privateShare).replace(".", ",")}% zaraportowanego czasu (${h1(r.privateSeconds)}).`);
  }

  // Projekty.
  const top = r.projects?.[0];
  if (top && top.share >= 40) {
    add("neu", `Dominujący projekt „${top.name || "(bez projektu)"}” zajął ${top.share}% czasu (${h1(top.seconds)}).`);
  }
  if (r.projectCount >= 10) add("neu", `Czas rozłożony na ${r.projectCount} projektów — duże rozproszenie.`);
  const unassigned = r.projects?.find((p) => p.id === null);
  if (unassigned && unassigned.share >= 5) add("neg", `${unassigned.share}% czasu zaraportowano bez projektu (${h1(unassigned.seconds)}).`);

  // Nadgodziny deklarowane.
  if (r.overtime.plus >= 240) add("neu", `Zatwierdzone nadgodziny: ${hm(r.overtime.plus)}.`);
  if (r.overtime.minus <= -240) add("neu", `Zatwierdzone wcześniejsze wyjścia: ${hm(r.overtime.minus)}.`);
  if (r.off.days > 0) add("neu", `Praca w weekendy i święta: ${h1(r.off.seconds)} (${days(r.off.days)}).`);

  // Jakość ewidencji.
  const q = r.quality;
  if (q.entries >= 20) {
    const touched = q.manual + q.edited;
    const pct = Math.round((touched / q.entries) * 100);
    if (pct >= 30) add("neg", `${pct}% wpisów dodano ręcznie albo zmieniono im czas (${touched} z ${q.entries}) — timer nie jest głównym sposobem raportowania.`);
    else if (pct <= 5 && q.auto === 0) add("pos", `Wpisy powstają na bieżąco z timera: tylko ${pct}% poprawianych lub ręcznych.`);
  }
  if (q.auto >= 3) add("neg", `Wpisy zamknięte automatycznie (zapomniany albo pusty timer): ${q.auto}.`);
  if (q.autoClosedCards >= 2) add("neg", `Karty czasu domknięte automatycznie o 3:00 (brak odbicia wyjścia): ${q.autoClosedCards}.`);
  if (r.longDays.length > 0) {
    add("neg", `Dni z ponad 12 h zaraportowanego czasu: ${r.longDays.map((d) => d.day).join(", ")} — do sprawdzenia, czy to nie niezatrzymany timer.`);
  }

  // Zmiana względem poprzedniego miesiąca.
  if (prev && prev.totalSeconds > 0 && r.totalSeconds > 0) {
    const change = Math.round(((r.totalSeconds - prev.totalSeconds) / prev.totalSeconds) * 100);
    if (Math.abs(change) >= 20) {
      add("neu", `Łączny czas ${change > 0 ? "wyższy" : "niższy"} o ${Math.abs(change)}% niż miesiąc wcześniej (${h1(r.totalSeconds)} wobec ${h1(prev.totalSeconds)}).`);
    }
  }

  const order = { pos: 0, neu: 1, neg: 2 };
  return out.sort((a, b) => order[a.tone] - order[b.tone]);
};
