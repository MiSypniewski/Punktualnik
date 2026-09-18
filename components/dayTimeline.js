import { useRef, useState } from "react";
import classNames from "classnames";
import LiveDot from "./liveDot";
import { absenceLabel, isLive } from "./dayState";
import { EMPTY_MARK, ProjectMark, projectColor } from "./projectColors";
import { TIMELINE_FROM_HOUR, TIMELINE_TO_HOUR, formatDuration, formatMinutes } from "../utils";

// Oś czasu dnia: jedna belka na osobę, od wejścia do wyjścia, ze znacznikiem
// „teraz” i kreską planowanego wyjścia.
//
// To jest element, po który kierownik przychodzi na ten ekran: tabela niżej ma
// te same dane, ale „o której kto wychodzi” trzeba z niej ODCZYTAĆ kolumna po
// kolumnie, a tutaj widać to od razu — kto już wyszedł, kto zostaje najdłużej,
// czyja belka wystaje za planowaną godzinę.
//
// Rysowane DOM-em, nie SVG, i to jest rozstrzygnięcie: kolory idą przez tokeny
// (bg-signal, bg-ok, bg-raised), więc tryb ciemny działa sam, a podpisy nie
// skalują się razem z geometrią. W SVG każdy kolor musiałby wejść wartością,
// czyli dokładnie tym, czego zabrania README („Kolory — dla nowych ekranów”).
//
// Bursztyn wyłącznie na stanie „teraz”: biegnąca belka, znacznik chwili
// obecnej i kreska planowanego wyjścia. Belka zamknięta jest zielona przy
// pełnej dniówce i neutralna w pozostałych przypadkach — tak samo jak chip
// stanu w tabeli (components/dayState.js).
//
// Tor zadań (opcjonalny, checkbox na stronie) to OSOBNY, niższy pas pod belką,
// a nie przemalowanie belki kolorami projektów. Paleta projektów ma amber,
// emerald i rose — dokładnie te odcienie, którymi belka mówi „w pracy”,
// „pełna dniówka” i „niepełna”. Zadanie projektu `rose` na belce czytałoby się
// jak niepełna dniówka. W osobnym pasie kolor znaczy tylko „który projekt”,
// a puste miejsce pod belką — czas obecności bez zaraportowanego zadania.

const MINUTES_PER_DAY = 24 * 60;

// Od jakiej szerokości belki napis „06:45 – 15:45*” mieści się w niej samej.
// Trzynaście znaków monospace przy text-xs to około 90 px, a najwęższy tor
// (kolumna nazwisk odjęta od szerokości okna na progu lg) ma około 790 px —
// stąd czternaście procent z zapasem. Poniżej progu godziny idą OBOK belki,
// bo tor ma overflow-hidden i napis w za wąskiej belce zostałby przycięty
// w połowie cyfry.
const LABEL_FITS_PCT = 14;

// Od jakiej szerokości odcinek „wcześniejsze wyjście” dostaje napis. Próg
// niższy niż dla godzin, bo napis ma `truncate`: przy dwóch godzinach zgody
// na najwęższym torze skróci się do „wcześniejsze wyj…”, co wciąż się czyta.
// Poniżej progu (około półtorej godziny) zostaje bez napisu — to samo mówią
// dymek i legenda.
const LEAVE_LABEL_FITS_PCT = 10;

/**
 * Kolor belki i tekstu na niej.
 *
 * Cztery przypadki, nie trzy, i to jest zmiana wobec pierwszej wersji: „karta
 * niepełna” i „karta domknięta nocą” dzieliły wcześniej jeden neutralny szary
 * i przez to niepełna dniówka była na osi niewidoczna, choć jest jedyną
 * z czterech, która wymaga rozmowy z pracownikiem.
 *
 * Domknięta nocą ZOSTAJE neutralna: ta ósemka jest założona, nie zmierzona,
 * więc nie wolno jej pomalować ani na zielono („przepracowane i pełne”), ani
 * na czerwono („za krótko”) — o niej nie wiadomo nic poza tym, że nikt karty
 * nie zamknął.
 *
 * Zieleń znaczy „dniówka rozliczona”, nie tylko „przepracowana”: serwer liczy
 * `full` z doliczeniem zatwierdzonego wcześniejszego wyjścia, a same godziny
 * zgody rysuje osobny, blady odcinek za belką.
 */
const barStyle = (person, running) => {
  if (running) return { bar: "bg-signal", ink: "text-signal-ink" };
  if (person.autoClosed) return { bar: "bg-raised border border-line", ink: "text-muted" };
  if (person.full) return { bar: "bg-ok", ink: "text-ok-ink" };
  return { bar: "bg-danger", ink: "text-danger-ink" };
};

/**
 * Okno godzin osi.
 *
 * Domyślne 5:00–19:00 jest STAŁE, żeby dało się porównywać dni — oś, która co
 * odświeżenie dopasowuje się do danych, przestawiałaby tę samą godzinę w inne
 * miejsce we wtorek i w środę. Rozszerzamy je tylko wtedy, gdy ktoś realnie
 * wyszedł poza nie (zmiana nocna, wejście przed piątą), i zawsze do pełnej
 * godziny.
 */
const windowFor = (people, nowMin, isToday, tasksByUser) => {
  const values = [];
  people.forEach((p) => {
    if (p.startMin !== null) values.push(p.startMin);
    if (p.endMin !== null) values.push(p.endMin);
    if (p.leaveEndMin !== null && p.leaveEndMin !== undefined) values.push(p.leaveEndMin);
    // Zadania też rozszerzają okno — wpis sprzed wejścia (praca z domu) ma być
    // widoczny, a nie ucięty krawędzią. Domknięty automatycznie rozszerza
    // okno tylko POCZĄTKIEM: kończy się o 3:00 następnej doby z definicji
    // i rozciągałby oś o pół wykresu dla godziny, której nikt nie zmierzył.
    // Godzina za początkiem wystarcza, żeby odcinek był widoczny i dał się
    // najechać — sam początek dawałby pasek szerokości kilku pikseli.
    ((tasksByUser && tasksByUser[p.userID]) || []).forEach((t) => {
      if (t.startMin === null || t.endMin === null) return;
      values.push(t.startMin);
      values.push(t.autoClosed ? Math.min(t.endMin, t.startMin + 60) : t.endMin);
    });
  });
  if (isToday) values.push(nowMin);

  const lo = Math.min(TIMELINE_FROM_HOUR * 60, ...values);
  const hi = Math.max(TIMELINE_TO_HOUR * 60, ...values);

  return {
    from: Math.floor(lo / 60) * 60,
    // Zmiana nocna daje endMin > 24 h (services/dayBoard.js dolicza dobę, żeby
    // belka szła w prawo, a nie zawijała się) — oś musi za nią sięgnąć.
    to: Math.ceil(hi / 60) * 60,
  };
};

/**
 * Dymek ze szczegółami wpisu. Własny, a nie atrybut `title`: natywny dymek
 * pojawia się po około sekundzie, nie da się go sformatować i nie działa
 * z klawiatury. Renderowany na poziomie całej osi, bo tor ma overflow-hidden
 * i dymek osadzony w odcinku zostałby przycięty.
 */
const TaskTooltip = ({ hovered, drift }) => {
  if (!hovered) return null;
  const { entry, x, y, align } = hovered;
  const seconds = entry.seconds + (entry.running ? drift : 0);

  return (
    <div
      role="tooltip"
      className={classNames(
        "absolute z-20 w-72 pointer-events-none rounded-md border border-line bg-raised shadow-plate p-3 text-sm",
        align === "start" ? "translate-x-0" : align === "end" ? "-translate-x-full" : "-translate-x-1/2"
      )}
      style={{ left: x, top: y }}
    >
      <p className="flex items-center gap-2 font-medium">
        <ProjectMark color={entry.projectColor} />
        <span className="truncate">
          {entry.projectName || "(bez projektu)"}
          {entry.projectClient && <span className="text-muted font-normal"> · {entry.projectClient}</span>}
        </span>
      </p>
      <p className={classNames("mt-1 break-words", !entry.description && "text-faint")}>
        {entry.description || "(bez opisu)"}
      </p>
      <p className="mt-1.5 font-mono text-xs tabular-nums text-muted">
        {entry.startHm} – {entry.running ? "trwa" : entry.endHm} · {formatDuration(seconds)}
      </p>
      {entry.autoClosed && (
        <p className="mt-1 text-xs text-muted">Domknięty automatycznie — koniec jest założony, nie zmierzony.</p>
      )}
      {entry.editedByName && <p className="mt-1 text-xs text-muted">Poprawił: {entry.editedByName}</p>}
    </div>
  );
};

const Timeline = ({ people, isToday, nowMin, drift, tasksByUser = null }) => {
  const live = people.filter(isLive).length;
  const withTasks = Boolean(tasksByUser);
  const { from, to } = windowFor(people, nowMin, isToday, tasksByUser);

  const rootRef = useRef(null);
  const [hovered, setHovered] = useState(null);

  // Pozycja dymka liczona względem całej osi: pod odcinkiem, wyśrodkowany,
  // a przy krawędziach dosunięty do środka, żeby nie wystawał za stronę.
  const showTask = (entry, target) => {
    const root = rootRef.current;
    if (!root) return;
    const box = root.getBoundingClientRect();
    const seg = target.getBoundingClientRect();
    const center = seg.left + seg.width / 2 - box.left;
    const half = 144; // połowa w-72
    const align = center < half ? "start" : center > box.width - half ? "end" : "center";
    const x = align === "start" ? Math.max(0, seg.left - box.left) : align === "end" ? seg.right - box.left : center;
    setHovered({ entry, x, y: seg.bottom - box.top + 6, align });
  };
  const hideTask = () => setHovered(null);

  // Projekty występujące tego dnia — do legendy toru. Kolor nie identyfikuje
  // projektu jednoznacznie (siedem odcieni na dowolnie wiele projektów), więc
  // legenda podaje nazwy, a dymek szczegóły.
  const dayProjects = [];
  let hasNoProject = false;
  if (withTasks) {
    const seen = new Set();
    people.forEach((p) =>
      (tasksByUser[p.userID] || []).forEach((t) => {
        if (!t.projectName) {
          hasNoProject = true;
          return;
        }
        if (seen.has(t.projectName)) return;
        seen.add(t.projectName);
        dayProjects.push({ name: t.projectName, color: t.projectColor });
      })
    );
    dayProjects.sort((a, b) => a.name.localeCompare(b.name, "pl"));
  }
  const span = Math.max(60, to - from);

  const pct = (minutes) => ((Math.min(Math.max(minutes, from), to) - from) / span) * 100;

  // Godziny pełne do podpisania. Przy szerokim oknie (zmiana nocna) co druga,
  // żeby podpisy się nie zlewały.
  const hours = [];
  const step = span / 60 > 16 ? 2 : 1;
  for (let h = from / 60; h <= to / 60; h += step) hours.push(h);

  // Znacznik „teraz” przesuwa się lokalnie od chwili odebrania danych — tym
  // samym driftem, którym tykają liczniki w tabeli, więc oba nigdy się nie
  // rozjadą. Serwerowa wartość nowMin jest punktem odniesienia: pierwszy render
  // klienta jest identyczny z HTML-em z serwera (drift = 0).
  const nowLive = Math.min(nowMin + Math.floor(drift / 60), MINUTES_PER_DAY * 2);

  // Bez własnego marginesu dolnego: rytm strony ustawia strona
  // (pages/urlopy/stan.js), inaczej dwa marginesy konkurowałyby i podniesienie
  // odstępu na stronie po cichu ograniczałby margines z tego komponentu.
  // Przy torze zadań wiersz rośnie, a belka obecności zajmuje górną część —
  // tej samej wysokości co bez toru, więc godziny w belce czytają się tak samo.
  const barPos = withTasks ? "top-0.5 h-5" : "top-0.5 bottom-0.5";
  const labelPos = withTasks ? "top-0 h-6" : "top-0 bottom-0";

  return (
    <div ref={rootRef} className="relative">
      {/* Skala godzin. Podpis jest przesunięty w lewo o pół swojej szerokości,
          żeby stał NAD kreską, a nie za nią. */}
      <div className="flex items-end gap-3 mb-1">
        {/* Ta sama szerokość plus przerwa co w kolumnie nazwisk niżej — skala
            godzin musi stać dokładnie nad torem, nie obok niego. */}
        <div className="w-48 shrink-0" />
        <div className="relative flex-grow h-4">
          {hours.map((h, i) => (
            <span
              key={h}
              className={classNames(
                "absolute font-mono text-[0.6875rem] tabular-nums text-muted",
                // Podpis stoi NAD kreską, czyli wyśrodkowany na niej. Skrajne
                // dwa są wyjątkiem: wyśrodkowany wisiałby połową w marginesie
                // strony, więc pierwszy dosuwa się w prawo, ostatni w lewo.
                i === 0 ? "translate-x-0" : i === hours.length - 1 ? "-translate-x-full" : "-translate-x-1/2"
              )}
              style={{ left: `${pct(h * 60)}%` }}
            >
              {String(h % 24).padStart(2, "0")}
            </span>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        {people.map((person) => {
          const running = isLive(person);
          const hasCard = person.startMin !== null;
          const barFrom = hasCard ? pct(person.startMin) : 0;
          // Belka biegnąca kończy się TERAZ, nie na godzinie planowanej —
          // inaczej ktoś, kto zapomniał drugiego dotknięcia kafelka, miałby na
          // osi dniówkę zamkniętą punktualnie, a to jest właśnie ta nieprawda,
          // o której ekran ma ostrzegać.
          const barTo = hasCard
            ? pct(running ? Math.max(nowLive, person.startMin) : person.endMin)
            : 0;

          // Godziny karty — te same, które stoją w tabeli. Dla karty otwartej
          // druga liczba jest PROGNOZĄ, więc dostaje gwiazdkę jak w tabeli.
          const span = `${person.startHm} – ${person.endHm}${person.endIsPlanned ? "*" : ""}`;
          const inside = barTo - barFrom >= LABEL_FITS_PCT;

          // Odcinek zatwierdzonego wcześniejszego wyjścia, doklejony za belką.
          // Serwer ustawia leaveEndMin tylko dla karty zamkniętej i zmierzonej.
          const hasLeave = hasCard && person.leaveEndMin !== null && person.leaveEndMin !== undefined;
          const leaveTo = hasLeave ? pct(person.leaveEndMin) : barTo;
          // Godziny stojące OBOK krótkiej belki idą za odcinkiem, nie na nim.
          const outsideFrom = hasLeave ? leaveTo : barTo;

          return (
            <div key={person.userID} className="flex items-center gap-3">
              {/* Miejsce na kropkę „na żywo” jest zarezerwowane w KAŻDYM
                  wierszu, także tam, gdzie kropki nie ma. Inaczej nazwiska
                  pracujących byłyby wcięte względem pozostałych i kolumna
                  przestawałaby się czytać jednym spojrzeniem w dół. */}
              <div className="w-48 shrink-0 flex items-center gap-1.5">
                <span className="w-1.5 shrink-0">{running && <LiveDot />}</span>
                <p className="text-sm truncate" title={`${person.surname} ${person.name}`}>
                  {person.surname} {person.name}
                </p>
              </div>

              <div
                className={classNames(
                  "relative flex-grow rounded-sm bg-surface border border-line-subtle overflow-hidden",
                  withTasks ? "h-10" : "h-6"
                )}
              >
                {/* Linie pełnych godzin — włosowe, pod belkami. */}
                {hours.map((h) => (
                  <span
                    key={h}
                    aria-hidden="true"
                    className="absolute top-0 bottom-0 border-l border-line-subtle"
                    style={{ left: `${pct(h * 60)}%` }}
                  />
                ))}

                {/* Nieobecność jako pasmo na całą szerokość okna: dotyczy CAŁEGO
                    dnia, a nie wycinka, i ma się czytać także pod belką kogoś,
                    kto odbił kartę mimo urlopu. */}
                {person.absence && (
                  <span
                    className={classNames(
                      "absolute inset-0 flex items-center px-2 text-xs truncate",
                      person.absence.status === "pending"
                        ? "bg-accent-soft border border-dashed border-accent/40 text-accent-strong"
                        : "bg-raised text-muted"
                    )}
                  >
                    {absenceLabel(person)}
                  </span>
                )}

                {hasCard && (
                  <>
                    <span
                      className={classNames(
                        "absolute rounded-sm flex items-center overflow-hidden",
                        barPos,
                        barStyle(person, running).bar
                      )}
                      style={{ left: `${barFrom}%`, width: `${Math.max(barTo - barFrom, 0.4)}%` }}
                    >
                      {/* Godziny W BELCE, gdy się w niej mieszczą. Szeroka belka
                          ma na nie miejsce i wtedy liczba stoi dokładnie tam,
                          gdzie oko już patrzy. */}
                      {inside && (
                        <span
                          className={classNames(
                            "px-1.5 font-mono text-xs tabular-nums whitespace-nowrap",
                            barStyle(person, running).ink
                          )}
                        >
                          {span}
                        </span>
                      )}
                    </span>

                    {/* Belka krótka — godziny obok niej. Po prawej, a przy
                        belce kończącej się u krawędzi okna po lewej, bo tor ma
                        overflow-hidden i napis wystający za prawy brzeg
                        zostałby ucięty w połowie. */}
                    {hasLeave && (
                      <span
                        className={classNames(
                          "absolute rounded-sm flex items-center overflow-hidden bg-ok-soft border border-dashed border-ok",
                          barPos
                        )}
                        style={{ left: `${barTo}%`, width: `${Math.max(leaveTo - barTo, 0.4)}%` }}
                        title={`Zatwierdzone wcześniejsze wyjście: ${formatMinutes(person.earlyLeaveMin)}`}
                      >
                        {leaveTo - barTo >= LEAVE_LABEL_FITS_PCT && (
                          <span className="px-1.5 text-xs text-ok-strong truncate">wcześniejsze wyjście</span>
                        )}
                      </span>
                    )}

                    {!inside && (
                      <span
                        className={classNames(
                          "absolute flex items-center font-mono text-xs tabular-nums whitespace-nowrap text-muted",
                          labelPos
                        )}
                        style={
                          outsideFrom <= 78
                            ? { left: `${outsideFrom}%`, paddingLeft: "0.375rem" }
                            : { right: `${100 - barFrom}%`, paddingRight: "0.375rem" }
                        }
                      >
                        {span}
                      </span>
                    )}
                  </>
                )}

                {/* Kreska planowanego wyjścia — tylko dla karty otwartej, bo
                    tylko tam jest PROGNOZĄ. Karta zamknięta ma godzinę
                    faktyczną i to ona kończy belkę. */}
                {person.endIsPlanned && person.endMin !== null && (
                  <span
                    aria-hidden="true"
                    className="absolute top-0 bottom-0 w-0.5 bg-signal-strong pointer-events-none"
                    style={{ left: `${pct(person.endMin)}%` }}
                  />
                )}

                {/* Tor zadań: niski pas pod belką. Odcinki rozdziela
                    jednopikselowa szczelina, żeby dwa kolejne wpisy tego
                    samego projektu nie zlały się w jeden. */}
                {withTasks &&
                  (tasksByUser[person.userID] || []).map((t) => {
                    if (t.startMin === null || t.endMin === null) return null;
                    // Biegnący kończy się TERAZ, tym samym driftem co belka.
                    const end = t.running ? Math.max(nowLive, t.startMin) : t.endMin;
                    const left = pct(t.startMin);
                    const width = Math.max(pct(end) - left, 0.3);
                    return (
                      <span
                        key={t.id}
                        tabIndex={0}
                        aria-label={`${t.projectName || "bez projektu"}: ${t.description || "bez opisu"}, ${t.startHm} – ${
                          t.running ? "trwa" : t.endHm
                        }`}
                        onMouseEnter={(e) => showTask(t, e.currentTarget)}
                        onMouseLeave={hideTask}
                        onFocus={(e) => showTask(t, e.currentTarget)}
                        onBlur={hideTask}
                        className={classNames(
                          "absolute bottom-0.5 h-3 rounded-sm cursor-default outline-none focus-visible:ring-2 focus-visible:ring-accent",
                          t.projectColor ? projectColor(t.projectColor).bar : EMPTY_MARK,
                          t.autoClosed && "opacity-50",
                          hovered && hovered.entry.id === t.id && "ring-2 ring-body/60"
                        )}
                        style={{ left: `${left}%`, width: `calc(${width}% - 1px)` }}
                      />
                    );
                  })}

                {/* Napis leży NAD torem zadań, więc nie może łapać myszy —
                    inaczej zadania osoby bez karty (np. kierownika
                    z nieregularnym czasem pracy) byłyby na osi widoczne,
                    ale bez dymka. Przy torze zajmuje tylko górną część,
                    tam gdzie stałaby belka. */}
                {!hasCard && !person.absence && (
                  <span
                    className={classNames(
                      "absolute inset-x-0 flex items-center px-2 text-xs text-faint pointer-events-none",
                      withTasks ? "top-0 h-6" : "inset-y-0"
                    )}
                  >
                    {person.state === "expected" ? "bez zgłoszonej nieobecności" : "bez karty czasu"}
                  </span>
                )}

                {/* Znacznik chwili obecnej zawsze na wierzchu — ma się rysować
                    także na belce i na paśmie nieobecności. */}
                {isToday && (
                  <span
                    aria-hidden="true"
                    className="absolute top-0 bottom-0 w-px bg-signal-strong pointer-events-none"
                    style={{ left: `${pct(nowLive)}%` }}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="w-4 h-2.5 rounded-sm bg-signal" /> w pracy ({live})
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="w-4 h-2.5 rounded-sm bg-ok" /> pełna dniówka
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="w-4 h-2.5 rounded-sm bg-danger" /> dniówka niepełna
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="w-4 h-2.5 rounded-sm bg-ok-soft border border-dashed border-ok" />{" "}
          wcześniejsze wyjście (zatwierdzone)
        </span>
        <span
          className="flex items-center gap-1.5"
          title="Kartę domknęło zadanie nocne na osiem godzin od wejścia — ta godzina jest założona, nie zmierzona"
        >
          <span aria-hidden="true" className="w-4 h-2.5 rounded-sm bg-raised border border-line" /> domknięta
          nocą
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="w-4 h-2.5 rounded-sm bg-raised" /> nieobecność
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="w-0.5 h-3 bg-signal-strong" /> planowane wyjście
          {isToday && " i chwila obecna"}
        </span>
      </p>

      {withTasks && (
        <p className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
          <span className="font-bold uppercase tracking-signage">Zadania:</span>
          {dayProjects.map((p) => (
            <span key={p.name} className="flex items-center gap-1.5">
              <ProjectMark color={p.color} /> {p.name}
            </span>
          ))}
          {hasNoProject && (
            <span className="flex items-center gap-1.5">
              <ProjectMark color={null} /> bez projektu
            </span>
          )}
          {dayProjects.length === 0 && !hasNoProject && <span>tego dnia nikt nie raportował zadań</span>}
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className="w-4 h-2.5 rounded-sm bg-surface border border-line-subtle" /> brak
            zaraportowanego zadania
          </span>
        </p>
      )}

      <TaskTooltip hovered={hovered} drift={drift} />
    </div>
  );
};

export default Timeline;
