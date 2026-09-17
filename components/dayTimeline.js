import classNames from "classnames";
import LiveDot from "./liveDot";
import { absenceLabel, isLive } from "./dayState";
import { TIMELINE_FROM_HOUR, TIMELINE_TO_HOUR } from "../utils";

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

const MINUTES_PER_DAY = 24 * 60;

// Od jakiej szerokości belki napis „06:45 – 15:45*” mieści się w niej samej.
// Trzynaście znaków monospace przy text-xs to około 90 px, a najwęższy tor
// (kolumna nazwisk odjęta od szerokości okna na progu lg) ma około 790 px —
// stąd czternaście procent z zapasem. Poniżej progu godziny idą OBOK belki,
// bo tor ma overflow-hidden i napis w za wąskiej belce zostałby przycięty
// w połowie cyfry.
const LABEL_FITS_PCT = 14;

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
const windowFor = (people, nowMin, isToday) => {
  const values = [];
  people.forEach((p) => {
    if (p.startMin !== null) values.push(p.startMin);
    if (p.endMin !== null) values.push(p.endMin);
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

const Timeline = ({ people, isToday, nowMin, drift }) => {
  const live = people.filter(isLive).length;
  const { from, to } = windowFor(people, nowMin, isToday);
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

  return (
    <div className="mb-6">
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

              <div className="relative flex-grow h-6 rounded-sm bg-surface border border-line-subtle overflow-hidden">
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
                        "absolute top-0.5 bottom-0.5 rounded-sm flex items-center overflow-hidden",
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
                    {!inside && (
                      <span
                        className="absolute top-0 bottom-0 flex items-center font-mono text-xs tabular-nums whitespace-nowrap text-muted"
                        style={
                          barTo <= 78
                            ? { left: `${barTo}%`, paddingLeft: "0.375rem" }
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
                    className="absolute top-0 bottom-0 w-0.5 bg-signal-strong"
                    style={{ left: `${pct(person.endMin)}%` }}
                  />
                )}

                {!hasCard && !person.absence && (
                  <span className="absolute inset-0 flex items-center px-2 text-xs text-faint">
                    {person.state === "expected" ? "bez zgłoszonej nieobecności" : "bez karty czasu"}
                  </span>
                )}

                {/* Znacznik chwili obecnej zawsze na wierzchu — ma się rysować
                    także na belce i na paśmie nieobecności. */}
                {isToday && (
                  <span
                    aria-hidden="true"
                    className="absolute top-0 bottom-0 w-px bg-signal-strong"
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
    </div>
  );
};

export default Timeline;
