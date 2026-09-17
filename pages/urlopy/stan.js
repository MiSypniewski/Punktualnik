import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import classNames from "classnames";
import { getToken } from "next-auth/jwt";
import BaseLayout from "../../components/baseLayout";
import AbsenceTabs from "../../components/absenceTabs";
import DayNav from "../../components/dayNav";
import DayTimeline from "../../components/dayTimeline";
import LiveDot from "../../components/liveDot";
import PendingDecisions from "../../components/pendingDecisions";
import { ProjectMark } from "../../components/projectColors";
import { absenceLabel, isLive, remarks, stateBadge } from "../../components/dayState";
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
import { formatDuration, hhmm } from "../../utils";
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

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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
  const raw = String(ctx.query.dzien ?? "");
  const day = DATE_RE.test(raw) ? raw : workDay();

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

const Remarks = ({ person, className }) => {
  const list = remarks(person);
  if (list.length === 0) return null;

  return (
    <div className={classNames("flex flex-wrap gap-1", className)}>
      {list.map((r) => (
        <Badge key={r.label} tone={r.tone} title={r.title}>
          {r.label}
        </Badge>
      ))}
    </div>
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
      <Td>
        <span className="font-medium">{fullName(person)}</span>
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
        {person.absence && <span className="block mt-1 text-xs text-muted">{absenceLabel(person)}</span>}
      </Td>
      {showHours && (
        <>
          <Num>{hourCell(person.startHm)}</Num>
          <Num>
            {hourCell(person.endHm)}
            {/* Gwiazdka znaczy "wyliczone, nie zmierzone" — legenda stoi pod tabelą. */}
            {person.endIsPlanned && <span className="text-signal-strong">*</span>}
          </Num>
          <Num>{person.startHm ? formatDuration(worked) : "—"}</Num>
        </>
      )}
      {showRunning && (
        <Td className="max-w-xs text-sm">
          <RunningCell running={person.running} drift={drift} />
        </Td>
      )}
      <Td>
        <Remarks person={person} />
      </Td>
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
        <p className="font-medium truncate">
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
              {person.startHm} → {hourCell(person.endHm)}
              {person.endIsPlanned && <span className="text-signal-strong">*</span>} ·{" "}
              {formatDuration(worked)}
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

      <Remarks person={person} className="mt-2" />
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
    <BaseLayout width="full">
      <PageHeader
        title="Aktualny stan"
        description="Dzień zespołu: obecność z kart czasu, nieobecności i zgody na zmianę godzin — w jednym miejscu."
      />

      <AbsenceTabs className="mb-5" />

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
      {isFuture ? (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
          <Stat label="W planie" value={counts.expected} hint="bez zgłoszonej nieobecności" />
          <Stat label="Nieobecności" value={counts.absent} hint="zatwierdzone" />
          <Stat label="Wnioski" value={counts.pending} hint="czekają na decyzję" />
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
          <Stat label="W pracy" value={counts.working} tone={counts.working > 0 ? "signal" : "default"} />
          <Stat label="Po pracy" value={counts.done} />
          <Stat label="Nieobecności" value={counts.absent} />
          <Stat label="Bez karty" value={counts.noCard} tone={counts.noCard > 0 ? "danger" : "default"} />
          <Stat label="Wnioski" value={counts.pending} hint="czekają na decyzję" />
        </div>
      )}

      {/* Oś czasu chowa się poniżej lg: czternastu godzin nie da się czytać na
          telefonie, a lista kart niżej niesie te same dane. Dla dnia przyszłego
          też jej nie ma — nie byłoby na niej ani jednej belki, bo godzin
          jeszcze nie ma skąd wziąć. */}
      {people.length > 0 && !isFuture && (
        <div className="hidden lg:block">
          <DayTimeline people={people} isToday={isToday} nowMin={board.nowMin} drift={drift} />
        </div>
      )}

      <Plate className="mb-6 overflow-hidden">
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
              <Table>
                <thead>
                  <Tr>
                    <Th>Pracownik</Th>
                    <Th>Stan</Th>
                    {showHours && (
                      <>
                        <Th align="right">Wejście</Th>
                        <Th align="right">Wyjście</Th>
                        <Th align="right">Czas</Th>
                      </>
                    )}
                    {showRunning && <Th>Teraz robi</Th>}
                    <Th>Uwagi</Th>
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
          className="mt-6"
        />
      )}
    </BaseLayout>
  );
}
