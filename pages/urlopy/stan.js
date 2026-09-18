import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import classNames from "classnames";
import { getToken } from "next-auth/jwt";
import BaseLayout from "../../components/baseLayout";
import DayNav from "../../components/dayNav";
import DayTimeline from "../../components/dayTimeline";
import LiveDot from "../../components/liveDot";
import PendingDecisions from "../../components/pendingDecisions";
import { ProjectMark } from "../../components/projectColors";
import {
  absenceLabel,
  exitAlarming,
  exitMarks,
  exitNote,
  isLive,
  nameNote,
  stateBadge,
} from "../../components/dayState";
import {
  Alert,
  Badge,
  Plate,
  PlateHeader,
  Table,
  TableWrap,
  Th,
  Td,
  Tr,
  Num,
  PageHeader,
  Stat,
  EmptyState,
} from "../../components/ui";
import { getDayBoard } from "../../services/dayBoard";
import { canApproveLeave } from "../../services/roles";
import { visibleSections } from "../../services/scope";
import { workDay } from "../../services/workday";
import { formatDuration, hhmm, isIsoDate } from "../../utils";
import { LIVE_POLL_MS, fetchLive } from "../../utils/live";

// Dzień zespołu na jednym ekranie: kto jest w pracy i od której, o której
// planowo wychodzi, kogo nie ma i dlaczego, kto ma coś do rozpatrzenia.
//
// Odpowiedź na poranne pytanie kierownika, która dotąd wymagała czterech
// ekranów: tablicy kafelków (kto odbił), panelu nieobecności (kogo nie ma),
// panelu nadgodzin (kto ma zgodę na wcześniejsze wyjście) i raportu zadań
// (kto nad czym pracuje).
//
// Czego ten ekran NIE WIE: aplikacja nie ma grafiku pracy — nie istnieje tabela
// zmian ani pole "o której ma zaczynać". Godzina wejścia bierze się z odbicia
// karty, a godzina wyjścia jest z niej WYLICZANA (start + 8 h ± zatwierdzone
// wnioski). Stąd gwiazdka przy prognozie i stąd puste kolumny godzin dla dnia
// przyszłego: dopóki nikt nie odbije wejścia, nie ma od czego liczyć.

const boardKey = (day) => `/api/absences/board?dzien=${encodeURIComponent(day)}`;

export async function getServerSideProps(ctx) {
  const token = await getToken({ req: ctx.req });

  if (!token) {
    return { redirect: { destination: "/users/signin", permanent: false } };
  }
  // notFound, nie 403 — dla pracownika ta strona ma nie istnieć, a nie odmawiać.
  // Ta sama bramka co w pages/urlopy/zarzadzaj.js i w /api/absences/board.
  if (!canApproveLeave(token.role)) {
    return { notFound: true };
  }

  // Dzień żyje w adresie, więc widok da się zalinkować i odświeżyć — ten sam
  // wzorzec, co filtry w panelu wniosków i w raporcie zadań. Zła wartość
  // wraca cicho na dziś, bo przeklejony adres nie ma prawa zostawić
  // kierownika z pustym ekranem.
  // isIsoDate, a nie samo wyrażenie regularne: "2026-13-99" ma kształt daty,
  // ale takiego dnia nie ma, i trafiał do nagłówka jako "Invalid Date".
  const raw = String(ctx.query.dzien ?? "");
  const day = isIsoDate(raw) ? raw : workDay();

  const sections = visibleSections(token);

  return {
    props: {
      initial: getDayBoard({ day, sections }),
      day,
      sections,
      currentUserID: token.userID ?? null,
    },
  };
}

const fullName = (person) => `${person.surname} ${person.name}`;

/** Godzina albo kreska — pusta komórka w kolumnie liczb czyta się jak błąd. */
const hourCell = (value) => value || "—";

/**
 * Godzina wyjścia razem ze wszystkim, co o niej trzeba wiedzieć.
 *
 * Kolumna "Uwagi" stała tu do września 2026 i zniknęła: rządek chipów
 * wersalikami obok każdego nazwiska kazał czytać siedem wielkich napisów na
 * ekranie, który ma dawać odpowiedź jednym spojrzeniem. Znaczniki karty
 * wróciły do godziny, o której mówią, a całe wyprowadzenie tej godziny
 * (wejście + 8 h ± wnioski) siedzi w dymku — łącznie z ostrzeżeniem
 * o karcie wiszącej po planowanym wyjściu.
 */
const ExitCell = ({ person }) => {
  const marks = exitMarks(person);
  const alarming = exitAlarming(person);

  return (
    <span title={exitNote(person) || undefined}>
      <span className={classNames(alarming && "font-semibold text-signal-strong")}>
        {hourCell(person.endHm)}
        {/* Gwiazdka znaczy "wyliczone, nie zmierzone" — legenda stoi pod tabelą. */}
        {person.endIsPlanned && <span className="text-signal-strong">*</span>}
      </span>
      {marks.length > 0 && (
        // Znaczniki karty małymi literami i drobnym tekstem: to przypis do
        // liczby obok, nie osobna informacja.
        <span className="ml-1 font-sans text-xs font-normal normal-case text-muted">
          {marks.join(" ")}
        </span>
      )}
    </span>
  );
};

/** Co ktoś robi w tej chwili — wyłącznie dla dnia dzisiejszego. */
const RunningCell = ({ running, drift }) => {
  if (!running) return <span className="text-faint">—</span>;

  return (
    <div className="flex items-start gap-2 min-w-0">
      <ProjectMark color={running.projectColor} />
      <div className="min-w-0">
        <p className="truncate">
          {running.projectName || "(bez projektu)"} ·{" "}
          {running.description ? (
            <span className="font-medium">{running.description}</span>
          ) : (
            <span className="text-faint">(bez opisu)</span>
          )}
        </p>
        <p className="font-mono text-xs tabular-nums text-muted">
          od {hhmm(running.startedAt)} · {formatDuration(running.elapsedSec + drift)}
        </p>
      </div>
    </div>
  );
};

const PersonRow = ({ person, showHours, showRunning, drift, isMe }) => {
  const badge = stateBadge(person);
  const live = isLive(person);
  const worked = live ? person.workedSec + drift : person.workedSec;

  return (
    <Tr className={classNames(live && "bg-signal-soft")}>
      {/* pl-3 = px-3 nagłówka płyty: nazwisko stoi równo z "Zespół", a nie
          przyklejone do krawędzi. Ten sam wcięty początek ma nagłówek kolumny. */}
      <Td className="pl-3">
        {/* Dymek przy nazwisku niesie ujemne saldo nadgodzin. Saldo jest stanem
            narastającym, bez własnej daty, więc nie ma czego robić w wierszu
            opisującym JEDEN dzień — ale przy rozmowie z pracownikiem przydaje
            się pod ręką. */}
        <span className="font-medium" title={nameNote(person) || undefined}>
          {fullName(person)}
        </span>
        {/* Kierownik odbija własną kartę jak każdy, więc stoi na tej liście —
            bez podpisu szukałby siebie po nazwisku. */}
        {isMe && <span className="ml-2 text-xs text-muted">(Ty)</span>}
        <span className="block text-xs text-muted">{person.section}</span>
      </Td>
      <Td>
        <span className="flex items-center gap-1.5">
          {live && <LiveDot />}
          <Badge tone={badge.tone}>{badge.label}</Badge>
        </span>
        {person.absence && (
          <span className="block mt-1 text-xs leading-tight text-muted">{absenceLabel(person)}</span>
        )}
      </Td>
      {showHours && (
        <>
          <Num>{hourCell(person.startHm)}</Num>
          <Num>
            <ExitCell person={person} />
          </Num>
          <Num>{person.startHm ? formatDuration(worked) : "—"}</Num>
        </>
      )}
      {showRunning ? (
        <Td className="text-sm">
          <RunningCell running={person.running} drift={drift} />
        </Td>
      ) : (
        <Td aria-hidden="true" />
      )}
    </Tr>
  );
};

/**
 * Ten sam wiersz na telefonie. Siedmiu kolumn nie da się czytać, wodząc palcem
 * po każdym wierszu — ten sam powód i ten sam podział co w liście wpisów
 * w raporcie zadań.
 */
const PersonCard = ({ person, showHours, showRunning, drift, isMe }) => {
  const badge = stateBadge(person);
  const live = isLive(person);
  const worked = live ? person.workedSec + drift : person.workedSec;

  return (
    <li
      className={classNames(
        "p-3 border rounded",
        live ? "border-signal/40 bg-signal-soft" : "border-line"
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-medium truncate" title={nameNote(person) || undefined}>
          {fullName(person)}
          {isMe && <span className="ml-2 text-xs font-normal text-muted">(Ty)</span>}
        </p>
        <span className="flex items-center gap-1.5 shrink-0">
          {live && <LiveDot />}
          <Badge tone={badge.tone}>{badge.label}</Badge>
        </span>
      </div>

      {showHours && (
        <p className="mt-1 font-mono text-sm tabular-nums text-muted">
          {person.startHm ? (
            <>
              {person.startHm} → <ExitCell person={person} /> · {formatDuration(worked)}
            </>
          ) : (
            "bez karty czasu"
          )}
        </p>
      )}

      {person.absence && <p className="mt-1 text-sm text-muted">{absenceLabel(person)}</p>}

      {showRunning && person.running && (
        <div className="mt-1 text-sm">
          <RunningCell running={person.running} drift={drift} />
        </div>
      )}

    </li>
  );
};

export default function AktualnyStan({ initial, day, sections, currentUserID }) {
  // Polling TYLKO dla dnia dzisiejszego: przeszłość się nie zmienia, a przyszłość
  // nie ma "teraz". Każde zapytanie do SQLite jest synchroniczne, więc
  // częstotliwość odpytywania jest wprost kosztem dla wszystkich żądań.
  const { data, error, mutate } = useSWR(boardKey(day), fetchLive, {
    fallbackData: initial,
    refreshInterval: initial.isToday ? LIVE_POLL_MS : 0,
  });

  const board = data ?? initial;
  const { people, counts, isToday, isFuture } = board;

  // Sekundy dorobione lokalnie od chwili odebrania danych — wzorzec
  // z components/liveBoard.js. Startuje od zera, więc pierwszy render klienta
  // jest identyczny z HTML-em z serwera i nie ma ostrzeżenia o hydracji.
  const [drift, setDrift] = useState(0);
  const receivedAt = useRef(null);

  useEffect(() => {
    receivedAt.current = Date.now();
    setDrift(0);
  }, [board]);

  useEffect(() => {
    // Różnicowo wobec chwili odbioru, nigdy prev + 1: karta w tle bywa dławiona
    // do jednego ticka na minutę i inkrementacja rozjechałaby się nieodwracalnie.
    const tick = () => {
      if (receivedAt.current === null) return;
      setDrift(Math.floor((Date.now() - receivedAt.current) / 1000));
    };
    const handle = setInterval(tick, 1000);
    return () => clearInterval(handle);
  }, []);

  // Kolumna "Teraz robi" ma sens wyłącznie dziś. Dla innych dat znika razem
  // z nagłówkiem, zamiast stać pusta i sugerować brak raportowania.
  const showRunning = isToday;
  // Kolumny godzin dla dnia przyszłego stałyby puste w każdym wierszu —
  // ta sama zasada co przy "Teraz robi": kolumna bez treści znika razem
  // z nagłówkiem, zamiast sugerować brak danych tam, gdzie ich nie może być.
  const showHours = !isFuture;
  const planned = people.some((p) => p.endIsPlanned);

  return (
    // "wide", nie "full", i to jest zmiana wobec pierwszej wersji tego ekranu:
    // `full` (max-w-none) ma w tej aplikacji JEDEN uprawniony użytkownik —
    // kiosk (/time/[id]), bo tam treść jest oglądana z drugiego końca hali.
    // Panel kierownika czyta się z bliska i ma stać w tej samej szerokości co
    // sąsiedni ekran modułu (/urlopy/zarzadzaj) oraz korekta kart czasu.
    // Przy okazji znika rozjazd, w którym treść była szersza od paska
    // stacyjnego i stopki — te stoją w max-w-wide.
    <BaseLayout width="wide">
      <PageHeader
        title="Aktualny stan"
        description="Dzień zespołu: obecność z kart czasu, nieobecności i zgody na zmianę godzin — w jednym miejscu."
      />

      {/* Bez paska podzakładek. Do obiegu wniosków prowadzi pozycja
          „Nieobecności” w pasku stacyjnym, a ten ekran jest oglądany codziennie
          rano i ma zaczynać się od dnia zespołu, nie od wyboru, gdzie pójść. */}

      {sections.length === 0 && (
        <Alert tone="warn" className="mb-6">
          Nie masz przypisanej żadnej sekcji, więc nie widzisz niczyjego dnia. Przypisanie nadaje się
          komendą <code>npm run admin -- sections &lt;e-mail&gt; nazwaSekcji</code>.
        </Alert>
      )}

      <DayNav day={day} today={board.today} />

      {isFuture && (
        <Alert tone="info" className="mb-4">
          Dzień przyszły — godzin jeszcze nie ma. Aplikacja nie prowadzi grafiku pracy, więc do
          czasu odbicia wejścia widać wyłącznie zaplanowane nieobecności i zatwierdzone zgody na
          zmianę godzin.
        </Alert>
      )}

      {/* Kafle dnia przyszłego liczą coś innego niż kafle dnia minionego, bo
          o jutrze aplikacja wie tylko tyle, kto nie ma nieobecności — godzin
          jeszcze nie ma skąd wziąć. "W pracy 0" byłoby prawdą, która nic nie
          mówi. */}
      {/* "Nieobecności planowane", a nie samo "Nieobecności": obok stoi kafel
          "Bez karty", który też liczy ludzi, których nie ma, i dwie nazwy
          znaczące „nie ma go" niczego nie rozdzielały. Rozdziela je
          USPRAWIEDLIWIENIE — tu nieobecność zgłoszona i zatwierdzona, tam brak
          karty bez wyjaśnienia. */}
      {isFuture ? (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-8">
          <Stat label="W planie" value={counts.expected} hint="bez zgłoszonej nieobecności" />
          <Stat label="Nieobecności planowane" value={counts.absent} hint="zatwierdzone" />
          <Stat label="Wnioski" value={counts.pending} hint="czekają na decyzję" />
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-8">
          <Stat label="W pracy" value={counts.working} tone={counts.working > 0 ? "signal" : "default"} />
          <Stat label="Po pracy" value={counts.done} />
          <Stat label="Nieobecności planowane" value={counts.absent} hint="zgłoszone i zatwierdzone" />
          <Stat
            label="Bez karty"
            value={counts.noCard}
            hint="bez zgłoszonej nieobecności"
            tone={counts.noCard > 0 ? "danger" : "default"}
          />
          <Stat label="Wnioski" value={counts.pending} hint="czekają na decyzję" />
        </div>
      )}

      {/* Oś czasu chowa się poniżej lg: czternastu godzin nie da się czytać na
          telefonie, a lista kart niżej niesie te same dane. Dla dnia przyszłego
          też jej nie ma — nie byłoby na niej ani jednej belki, bo godzin
          jeszcze nie ma skąd wziąć. */}
      {people.length > 0 && !isFuture && (
        <div className="hidden lg:block mb-10">
          <DayTimeline people={people} isToday={isToday} nowMin={board.nowMin} drift={drift} />
        </div>
      )}

      <Plate className="mb-3 overflow-hidden">
        <PlateHeader className="bg-raised">
          <h2 className="text-xs font-bold uppercase tracking-signage">Zespół ({people.length})</h2>
          <p className="text-xs text-muted">
            {board.generatedAt && <>stan na {hhmm(board.generatedAt)}</>}
            {isToday && " · odświeża się sam"}
            {error && <span className="text-signal-strong"> · brak łączności, dane mogą być nieaktualne</span>}
          </p>
        </PlateHeader>

        {people.length === 0 ? (
          <EmptyState
            title="Brak pracowników"
            description="W twoich sekcjach nie ma aktywnych kont pracowników."
          />
        ) : (
          <>
            <TableWrap className="hidden lg:block">
              {/* Układ STAŁY, nie automatyczny, i to jest rozstrzygnięcie.
                  W układzie automatycznym szerokości ustawiała treść: podpis
                  nieobecności ("wniosek: Urlop do 2026-09-17") rozpychał kolumnę
                  STAN na ćwierć tabeli, a nadwyżkę przeglądarka rozkładała
                  równo na wszystkie kolumny — stąd rów między STAN i WEJŚCIEM.
                  Klasy `w-*` na komórkach tego nie naprawiały: przy `w-full`
                  na jednej z nich reszta i tak schodzi do treści.

                  Przy okazji zaczyna działać `truncate` na opisie zadania —
                  bez zadanej szerokości kolumny nie miał czego przycinać
                  i długi opis rozpychał tabelę. */}
              <Table className="table-fixed">
                <colgroup>
                  {/* Nazwisko z sekcją pod nim — tyle, żeby najdłuższe
                      w firmie zmieściło się w jednej linii. Z w-56 na w-60
                      razem z wcięciem pl-3: bez tego najdłuższe nazwisko
                      dotykało kolumny STAN. */}
                  <col className="w-60" />
                  {/* Chip stanu i podpis nieobecności pod nim; podpis się łamie
                      i już nie dyktuje szerokości. */}
                  <col className="w-40" />
                  {showHours && (
                    <>
                      <col className="w-20" />
                      {/* Szersza od wejścia, bo obok godziny stoją znaczniki
                          karty ("13:50 auto"). */}
                      <col className="w-28" />
                      <col className="w-32" />
                    </>
                  )}
                  {/* Kolumna bez zadanej szerokości bierze w układzie stałym
                      CAŁĄ resztę — i tu idzie miejsce odzyskane z kolumny STAN.
                      Jest obecna ZAWSZE, także w dniach bez "Teraz robi",
                      i wtedy jest pustym zbiornikiem na nadwyżkę. Bez niej
                      nadwyżka rozkładała się proporcjonalnie na pozostałe
                      kolumny i odtwarzała ten sam rów między STAN i WEJŚCIEM,
                      tylko dla wczoraj i jutra. Zwężenie samej tabeli też nie
                      jest wyjściem: linie wierszy urywały się wtedy w połowie
                      płyty. */}
                  <col />
                </colgroup>
                <thead>
                  <Tr>
                    <Th className="pl-3">Pracownik</Th>
                    <Th>Stan</Th>
                    {showHours && (
                      <>
                        <Th align="right">Wejście</Th>
                        <Th align="right">Wyjście</Th>
                        <Th align="right">Czas</Th>
                      </>
                    )}
                    {showRunning ? <Th>Teraz robi</Th> : <Th aria-hidden="true" />}
                  </Tr>
                </thead>
                <tbody>
                  {people.map((person) => (
                    <PersonRow
                      key={person.userID}
                      person={person}
                      showHours={showHours}
                      showRunning={showRunning}
                      drift={drift}
                      isMe={Number(person.userID) === Number(currentUserID)}
                    />
                  ))}
                </tbody>
              </Table>
            </TableWrap>

            <ul className="lg:hidden flex flex-col gap-2 p-3">
              {people.map((person) => (
                <PersonCard
                  key={person.userID}
                  person={person}
                  showHours={showHours}
                  showRunning={showRunning}
                  drift={drift}
                  isMe={Number(person.userID) === Number(currentUserID)}
                />
              ))}
            </ul>
          </>
        )}
      </Plate>

      {planned && (
        // Legenda jest krótka i stoi pod tabelą, a nie w dymku: gwiazdka
        // oznacza JEDYNĄ liczbę na tym ekranie, której nikt nie zmierzył.
        <p className="text-xs text-muted">
          <span className="font-mono text-signal-strong">*</span> godzina wyliczona: wejście plus osiem
          godzin, skorygowane o zatwierdzone wnioski o wcześniejsze wyjście i o zostanie dłużej.
          Aplikacja nie zna grafiku pracy, więc to prognoza, nie ustalenie.
        </p>
      )}

      {/* Wnioski stoją NA KOŃCU, a nie na górze, i to jest kolejność celowa:
          ekran ma najpierw odpowiedzieć na pytanie „jak dziś stoi zespół”,
          a dopiero potem dać pracę do wyklikania. Lista nie zależy od wybranego
          dnia — wniosek czeka na decyzję niezależnie od tego, na który dzień
          go złożono. */}
      {sections.length > 0 && (
        <PendingDecisions
          absences={board.pending.absences}
          overtime={board.pending.overtime}
          leaveLeft={board.leaveLeft}
          onDecided={mutate}
          className="mt-10"
        />
      )}
    </BaseLayout>
  );
}
