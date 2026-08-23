import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useRouter } from "next/router";
import { mutate } from "swr";
import { getToken } from "next-auth/jwt";
import classNames from "classnames";
import dayjs from "dayjs";
import "dayjs/locale/pl";
import BaseLayout from "../../components/baseLayout";
import { ProjectMark } from "../../components/projectColors";
import LiveDot from "../../components/liveDot";
import Button, { IconButton } from "../../components/ui/button";
import { PlayIcon, PencilIcon, TrashIcon } from "../../components/ui/icons";
import { Input, Select } from "../../components/ui/field";
import Plate from "../../components/ui/plate";
import Alert from "../../components/ui/alert";
import PageHeader from "../../components/ui/pageHeader";
import EmptyState from "../../components/ui/emptyState";
import { listProjects, projectScope } from "../../services/projects";
import { getEntriesForUser, getRunningEntry, sweepStaleEntries } from "../../services/taskEntries";
import { getSuggestions, suggestionsByProject } from "../../services/entrySuggestions";
import { canTrackTasks, boundByEditWindow } from "../../services/roles";
import { workDay, minEditableDay } from "../../services/workday";
import { formatDuration, hhmm, keepSeconds, timePart } from "../../utils";

dayjs.locale("pl");

const HISTORY_DAYS = 14;

export async function getServerSideProps(ctx) {
  const token = await getToken({ req: ctx.req });

  if (!token) {
    return { redirect: { destination: "/users/signin", permanent: false } };
  }
  // Kiosk jest współdzielony, więc jego wpis nie miałby właściciela.
  if (!canTrackTasks(token.role)) {
    return { notFound: true };
  }

  // Zapomniany timer domykamy przy wejściu na stronę — crona na Mikrusie nie ma.
  // Wersja dławiona (raz na minutę na proces): granica domykania to 3:00, więc
  // branie blokady zapisu przy KAŻDYM wejściu było czystą stratą.
  sweepStaleEntries();

  const today = workDay();
  const suggestions = getSuggestions(token.userID);

  return {
    props: {
      projects: listProjects({ sections: projectScope(token) }),
      running: getRunningEntry(token.userID) ?? null,
      entries: getEntriesForUser({
        userID: token.userID,
        from: dayjs(today).subtract(HISTORY_DAYS, "day").format("YYYY-MM-DD"),
        to: today,
      }),
      suggestions: suggestions.slice(0, 6),
      descByProject: suggestionsByProject(suggestions),
      today,
      minEditable: minEditableDay(),
      // Kierownik poprawia i dopisuje wpisy z dowolnego dnia — także tu, na
      // swojej własnej stronie. Regułę rozstrzyga API (pages/api/entries/[id].js);
      // ten props tylko przestaje wyłączać przyciski, które i tak by przeszły.
      editAnyDay: !boundByEditWindow(token.role),
    },
  };
}

// Kody, których serwis nie opisuje własnym komunikatem (te z komunikatem —
// kolizja, zły zakres, zamknięte okno — przychodzą gotowe w `message`).
const ERRORS = {
  not_running: "Ten timer już nie biegnie — odśwież stronę.",
  already_running: "Masz już uruchomiony timer.",
  project_out_of_scope: "Ten projekt nie jest dla twojej sekcji.",
  project_not_found: "Wybranego projektu już nie ma.",
  bad_project: "Wybierz projekt.",
  not_found: "Tego wpisu już nie ma — odśwież stronę.",
  incomplete: "Uzupełnij projekt i opis, zanim zamkniesz zadanie.",
};

// Napis dla wpisu, który jeszcze nie ma przypisanego projektu. Ten sam zabieg
// co "(bez opisu)" niżej: brak informacji ma być widoczny jako brak, a nie jako
// pusty odstęp, którego nikt nie zauważy.
const NO_PROJECT = "(bez projektu)";

const errorText = (body, fallback) => body.message || ERRORS[body.error] || fallback;

/**
 * Co się właśnie stało z poprzednim timerem. Bez tego zdania przełączenie
 * wygląda jak zgubiony wpis: licznik skacze na nowe zadanie, a stare przenosi się
 * na listę dnia poniżej — czyli tam, gdzie w tej chwili nikt nie patrzy.
 */
const switchMessage = ({ stopped, discarded }) => {
  if (stopped) {
    return `Zamknięto „${stopped.description || "bez opisu"}” — ${formatDuration(stopped.seconds)}.`;
  }
  if (discarded) {
    return "Poprzedni timer trwał krócej niż 10 sekund — odrzucony jako pomyłka.";
  }
  return "";
};

/** Etykieta dnia: "dziś", "wczoraj", inaczej data słownie. */
const dayLabel = (data, today) => {
  if (data === today) return "Dziś";
  if (data === dayjs(today).subtract(1, "day").format("YYYY-MM-DD")) return "Wczoraj";
  return dayjs(data).format("dddd, D MMMM");
};

export default function Zadania({
  projects,
  running,
  entries,
  suggestions,
  descByProject,
  today,
  minEditable,
  editAnyDay,
}) {
  const router = useRouter();
  const refresh = () => router.replace(router.asPath, undefined, { scroll: false });

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");

  /** @returns {object|false} odpowiedź serwera albo false, gdy żądanie się nie udało */
  const call = async (url, options) => {
    setBusy(true);
    setErr("");
    setInfo("");
    try {
      const res = await fetch(url, {
        headers: { "Content-Type": "application/json" },
        ...options,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(errorText(body, "Nie udało się zapisać."));
        return false;
      }
      await refresh();
      // Timer w pasku karty (components/timerTitle.js) ma zareagować na Start,
      // Stop i przełączenie zadania od razu, a nie po cyklu pollingu. Świadomie
      // NIE robimy tego w autosave opisu — poprawka napisu w tytule może poczekać
      // do najbliższego odświeżenia, a mutate na każdą pauzę w pisaniu mnożyłoby
      // żądania.
      mutate("/api/entries/timer");
      return body;
    } finally {
      setBusy(false);
    }
  };

  /**
   * Wznowienie zadania. `replaceRunning` mówi API, że biegnący timer wolno
   * zamknąć — kliknięcie "wznów" znaczy "zajmuję się teraz TYM", a nie
   * "poinformuj mnie, że mam już inny timer".
   */
  const resume = ({ projectID, description }) =>
    call("/api/entries", {
      method: "POST",
      body: JSON.stringify({ action: "start", projectID, description, replaceRunning: true }),
    }).then((body) => {
      if (body) setInfo(switchMessage(body));
      return body;
    });

  // Wpisy pogrupowane po dobie roboczej; kolejność z SQL (malejąco) zachowana.
  // Biegnący wpis odsiewamy, bo pokazuje go pasek timera na górze — inaczej
  // dzisiejsza grupa pojawiałaby się pusta, z sumą 0h, zanim cokolwiek zamknięto.
  const days = useMemo(() => {
    const map = new Map();
    entries
      .filter((e) => e.endedAt)
      .forEach((e) => {
        if (!map.has(e.data)) map.set(e.data, []);
        map.get(e.data).push(e);
      });
    return [...map.entries()];
  }, [entries]);

  return (
    <BaseLayout>
      <PageHeader
        title="Moje zadania"
        description="Timer liczy czas na bieżąco, wpis ręczny dopisuje go po fakcie. Historia obejmuje ostatnie dwa tygodnie."
      />
      <div>
        <TimerBar
          running={running}
          projects={projects}
          descByProject={descByProject}
          busy={busy}
          call={call}
          onError={setErr}
        />

        {err && (
          <Alert tone="danger" className="my-3">
            {err}
          </Alert>
        )}

        {info && (
          <Alert tone="ok" className="my-3">
            {info}
          </Alert>
        )}

        {/* Podpowiedzi zostają na ekranie TAKŻE przy biegnącym timerze — to jedyne
            miejsce, z którego da się jednym kliknięciem przejść na inne zadanie. */}
        {suggestions.length > 0 && (
          <Resume suggestions={suggestions} running={running} busy={busy} onResume={resume} />
        )}

        <ManualForm
          projects={projects}
          descByProject={descByProject}
          busy={busy}
          call={call}
          today={today}
          anyDay={editAnyDay}
        />

        {days.length === 0 && (
          <EmptyState
            className="mt-6"
            title="Brak wpisów"
            description="Wybierz projekt, opisz zadanie i naciśnij Start. Czas policzy się sam."
          />
        )}

        {days.map(([data, list]) => (
          <DaySection
            key={data}
            data={data}
            list={list}
            label={dayLabel(data, today)}
            editable={editAnyDay || data >= minEditable}
            projects={projects}
            descByProject={descByProject}
            busy={busy}
            call={call}
            running={running}
            onResume={resume}
          />
        ))}
      </div>
    </BaseLayout>
  );
}

// --- pasek timera -----------------------------------------------------------

// `tone` rozróżnia stan: "idle" (czekamy na Start) od "running" (czas leci).
// Kolor ma nieść tę informację z drugiego końca pokoju — sam licznik jest na to
// za mały, a to jedyne miejsce na stronie, gdzie coś się DZIEJE.
//
// Nagłówek zamiast samego placeholdera: placeholder znika po pierwszej literze,
// więc po wpisaniu opisu pasek przestawał się przedstawiać.
const Bar = ({ tone = "idle", title, children }) => (
  // Pasek NIE jest już przyklejony do góry. Biegnący timer widać teraz na każdej
  // stronie w bursztynowej linii paska stacyjnego (components/runningStrip.js),
  // która jest zarazem linkiem tutaj — drugi lepki element mierzyłby się z tamtym
  // o miejsce i musiałby znać jego zmienną wysokość.
  <Plate tone={tone === "running" ? "signal" : "default"} className="p-3 border-2 mb-4">
    <h2 className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-signage text-muted">
      {tone === "running" && <LiveDot />}
      {title}
    </h2>
    {children}
  </Plate>
);

// Ile czekamy z zapisem opisu po ostatnim znaku. Na tyle długo, żeby nie wysyłać
// żądania na literę, i na tyle krótko, żeby "zapisano" pojawiło się jeszcze
// w trakcie myślenia nad następnym zdaniem.
const AUTOSAVE_MS = 800;

/**
 * Biegnący timer — z opisem i projektem DO POPRAWIENIA w miejscu.
 *
 * Zapis idzie własnym fetchem, a nie wspólnym call(): tamten kończy się
 * router.replace, czyli przemontowaniem paska i wyrwaniem kursora ze środka
 * zdania. Propsy zostają więc chwilowo starsze niż ekran i to jest w porządku —
 * dopiero Stop (albo przełączenie zadania) odświeża stronę, a wtedy przychodzi
 * już to, co zapisaliśmy.
 */
const RunningTimer = ({ running, projects, descByProject, busy, call, onError }) => {
  const [draft, setDraft] = useState({
    projectID: running.projectID,
    description: running.description,
  });
  const [saved, setSaved] = useState(false);
  const [elapsed, setElapsed] = useState("");

  // Godzina rozpoczęcia otwierana do poprawki na życzenie, nie na stałe: pole
  // stojące zawsze otworem kusiłoby do ruszenia jej przez przypadek, a na
  // tablecie to jedno nieostrożne dotknięcie.
  const [editingStart, setEditingStart] = useState(false);
  const [startDraft, setStartDraft] = useState(hhmm(running.startedAt));

  // Kursor ma wylądować w polu, którego brakuje — sam komunikat nad paskiem
  // zostawiałby szukanie użytkownikowi.
  const descInput = useRef(null);
  const projectSelect = useRef(null);

  const stored = useRef(draft); // ostatnia wartość potwierdzona przez serwer
  const latest = useRef(draft); // to, co widzi użytkownik — dla flushów spoza Reacta
  const pending = useRef(null); // uchwyt debounce'u
  latest.current = draft;

  // Nowy timer (Start albo przełączenie zadania) zaczyna od własnego szkicu.
  // Zależność po running.id, a NIE po całym obiekcie: props wracający z serwera
  // nie może nadpisać tekstu, który użytkownik właśnie pisze.
  useEffect(() => {
    const fresh = { projectID: running.projectID, description: running.description };
    setDraft(fresh);
    stored.current = fresh;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running.id]);

  const save = useCallback(
    async (next) => {
      if (
        next.projectID === stored.current.projectID &&
        next.description === stored.current.description
      ) {
        return;
      }

      const res = await fetch(`/api/entries/${running.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "retag", ...next }),
        // Żądanie ma dojść nawet wtedy, gdy poszło z zamykanej karty.
        keepalive: true,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        onError(errorText(body, "Nie udało się zapisać opisu."));
        return;
      }

      stored.current = next;
      onError("");
      setSaved(true);
    },
    [running.id, onError]
  );

  const edit = (patch, { now = false } = {}) => {
    const next = { ...latest.current, ...patch };
    setDraft(next);
    // Ustawiamy ręcznie, bo flush z pagehide może wypaść przed przerysowaniem.
    latest.current = next;
    setSaved(false);

    if (pending.current) clearTimeout(pending.current);
    pending.current = now ? null : setTimeout(() => save(next), AUTOSAVE_MS);
    if (now) save(next);
  };

  /** Zapisuje od razu to, co czeka w kolejce (Enter, wyjście z pola, Stop). */
  const flush = useCallback(async () => {
    if (!pending.current) return;
    clearTimeout(pending.current);
    pending.current = null;
    await save(latest.current);
  }, [save]);

  // "zapisano ✓" to potwierdzenie, nie stan — po chwili ma zniknąć, żeby pasek
  // nie zostawał na stałe zabudowany komunikatem.
  useEffect(() => {
    if (!saved) return undefined;
    const handle = setTimeout(() => setSaved(false), 2000);
    return () => clearTimeout(handle);
  }, [saved]);

  // Licznik startuje dopiero po zamontowaniu — inaczej HTML z serwera
  // i pierwszy render klienta różniłyby się o sekundę (hydration mismatch).
  useEffect(() => {
    const tick = () => setElapsed(formatDuration(dayjs().diff(dayjs(running.startedAt), "second")));

    tick();
    const handle = setInterval(tick, 1000);
    return () => clearInterval(handle);
  }, [running.startedAt]);

  // Zamknięcie karty w trakcie debounce'u nie może zjeść opisu. visibilitychange
  // łapie przy okazji telefon, na którym pagehide bywa pomijany.
  useEffect(() => {
    const leave = () => {
      if (!pending.current) return;
      clearTimeout(pending.current);
      pending.current = null;
      save(latest.current);
    };
    const onVisibility = () => document.hidden && leave();

    window.addEventListener("pagehide", leave);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", leave);
      document.removeEventListener("visibilitychange", onVisibility);
      // Przy odmontowaniu nic nie wysyłamy: to Stop albo przełączenie zadania,
      // a te robią flush same, zanim wpis przestanie biec.
      if (pending.current) clearTimeout(pending.current);
    };
  }, [save]);

  // Poprawiona godzina przychodzi propsem, więc szkic i zamknięcie edytora
  // wieszamy na startedAt, nie na id: po udanym zapisie wpis jest ten sam,
  // zmienia się wyłącznie jego początek. Nieudany zapis nie odświeża propsów,
  // więc pole zostaje otwarte razem z komunikatem.
  useEffect(() => {
    setStartDraft(hhmm(running.startedAt));
    setEditingStart(false);
  }, [running.startedAt]);

  const stop = async () => {
    // Ten sam warunek co assertComplete na serwerze. Tutaj nie po to, żeby
    // chronić dane — od tego jest serwer — tylko żeby nie płacić za odmowę
    // żądaniem i żeby kursor od razu stanął w brakującym polu.
    if (!draft.projectID) {
      onError("Wybierz projekt, zanim zamkniesz zadanie.");
      projectSelect.current?.focus();
      return;
    }
    if (!String(draft.description ?? "").trim()) {
      onError("Opisz zadanie, zanim je zamkniesz.");
      descInput.current?.focus();
      return;
    }

    await flush();
    call(`/api/entries/${running.id}`, { method: "PUT", body: JSON.stringify({ action: "stop" }) });
  };

  /**
   * Zapis poprawionej godziny startu.
   *
   * flush() PRZED call(): ten drugi kończy się router.replace, czyli
   * przemontowaniem paska, a niezflushowany debounce opisu (AUTOSAVE_MS)
   * przepadłby razem z nim. Dokładnie ta sama kolejność co w stop().
   */
  const saveStart = async () => {
    await flush();
    call(`/api/entries/${running.id}`, {
      method: "PUT",
      body: JSON.stringify({ action: "setstart", from: startDraft }),
    });
  };

  const cancelStart = () => {
    setStartDraft(hhmm(running.startedAt));
    setEditingStart(false);
  };

  // Projekt zarchiwizowany w trakcie pracy wypadłby z listy, a <select> wskazałby
  // wtedy pierwszą pozycję z brzegu i cicho przeniósł czas na cudzy projekt.
  // Warunek na draft.projectID, bo wpis bez projektu nie ma czego szukać w liście.
  const options =
    !draft.projectID || projects.some((p) => p.id === draft.projectID)
      ? projects
      : [{ id: draft.projectID, name: "— projekt poza listą —" }, ...projects];

  const project = options.find((p) => p.id === draft.projectID);

  return (
    <Bar tone="running" title="Pracujesz nad">
      <div className="flex items-center gap-2 flex-wrap">
        <ProjectMark color={project?.color} size="lg" />
        {/* Te same pola co przed startem, w tym samym układzie — pasek nie zmienia
            kształtu po naciśnięciu Start, zmienia się tylko przycisk po prawej. */}
        <Input
          ref={descInput}
          type="text"
          value={draft.description}
          list={`opisy-${draft.projectID}`}
          maxLength={200}
          placeholder="np. Weryfikacja raportów z instalacji"
          onChange={(e) => edit({ description: e.target.value })}
          onBlur={flush}
          onKeyDown={(e) => e.key === "Enter" && flush()}
          className="flex-grow w-auto min-w-[12rem]"
        />
        <DescriptionOptions descByProject={descByProject} />

        <Select
          ref={projectSelect}
          value={draft.projectID ?? ""}
          onChange={(e) =>
            edit({ projectID: e.target.value ? Number(e.target.value) : null }, { now: true })
          }
          className="w-full sm:w-56 shrink-0"
        >
          <option value="">— wybierz projekt —</option>
          {options.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>

        <span className="font-mono text-xl font-medium tabular-nums">{elapsed || "…"}</span>
        <Button variant="signal" size="lg" disabled={busy} onClick={stop}>
          Stop
        </Button>
      </div>

      {/* Godzina rozpoczęcia do poprawienia w miejscu. Powód jest codzienny:
          spotkanie zaczyna się o 9:00, a timer wchodzi o 9:10, kiedy ktoś sobie
          o nim przypomni. Bez tego jedynym wyjściem był Stop, edycja zamkniętego
          wpisu i Start od nowa — czyli rozcięcie jednej pracy na dwa kawałki. */}
      {editingStart ? (
        <div className="mt-1 flex items-center gap-2 flex-wrap text-xs text-muted">
          <span>od</span>
          <Input
            autoFocus
            type="time"
            aria-label="Godzina rozpoczęcia"
            value={startDraft}
            onChange={(e) => setStartDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && saveStart()}
            className="!w-28 py-1"
          />
          <Button size="sm" disabled={busy} onClick={saveStart}>
            Zapisz
          </Button>
          <Button size="sm" variant="ghost" onClick={cancelStart}>
            Anuluj
          </Button>
        </div>
      ) : (
        <p className="mt-1 text-xs text-muted">
          <button
            type="button"
            title="Popraw godzinę rozpoczęcia"
            onClick={() => setEditingStart(true)}
            className="inline-flex items-center gap-1 font-medium text-accent-strong hover:underline"
          >
            od {hhmm(running.startedAt)}
            <PencilIcon className="w-3 h-3" />
          </button>{" "}
          · opis i projekt zapisują się same
          {saved && <span className="ml-2 font-medium text-ok-strong">zapisano ✓</span>}
        </p>
      )}
    </Bar>
  );
};

const TimerBar = ({ running, projects, descByProject, busy, call, onError }) => {
  // Pusto, a NIE projects[0]. Podstawiony pierwszy projekt alfabetycznie znaczył,
  // że kto nie spojrzy w to pole, ten po cichu raportuje czas na cudzy projekt —
  // a wpis wygląda wtedy tak samo dobrze jak prawdziwy.
  const [projectID, setProjectID] = useState("");
  const [description, setDescription] = useState("");

  if (running) {
    return (
      <RunningTimer
        running={running}
        projects={projects}
        descByProject={descByProject}
        busy={busy}
        call={call}
        onError={onError}
      />
    );
  }

  // Start bez projektu i bez opisu jest DOZWOLONY: licznik ma ruszyć w sekundę,
  // w której zaczyna się praca, a nie w tej, w której ktoś skończy się nad nią
  // zastanawiać. Kompletu pilnuje dopiero Stop (services/taskEntries.js:
  // assertComplete), a jedno i drugie da się dopisać w biegu.
  const start = () => {
    call("/api/entries", {
      method: "POST",
      body: JSON.stringify({ action: "start", projectID: projectID || null, description }),
    }).then((ok) => ok && setDescription(""));
  };

  return (
    <Bar title="Nad czym pracujesz?">
      {/* Opis z lewej, projekt z prawej: zdanie zaczyna się od tego, CO się robi,
          a projekt jest doprecyzowaniem. Opis dostaje też całą wolną szerokość,
          bo bywa dłuższy niż nazwa projektu. */}
      <div className="flex items-center gap-2 flex-wrap">
        <Input
          type="text"
          value={description}
          list={`opisy-${projectID}`}
          maxLength={200}
          placeholder="np. Weryfikacja raportów z instalacji"
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && start()}
          className="flex-grow w-auto min-w-[12rem]"
        />
        <DescriptionOptions descByProject={descByProject} />

        {/* Stała szerokość, bo nazwy projektów bywają długie ("Nowe i remontowane
            sklepy") i bez niej select albo rozpycha pasek, albo ucina tekst
            na krawędzi. */}
        <Select
          value={projectID}
          onChange={(e) => setProjectID(e.target.value ? Number(e.target.value) : "")}
          className="w-full sm:w-56 shrink-0"
        >
          <option value="">
            {projects.length === 0 ? "— brak projektów —" : "— wybierz projekt —"}
          </option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>

        {/* Bez `projects.length === 0` w disabled: brak projektów nie blokuje już
            startu, bo timer poradzi sobie bez nich, a praca i tak trwa. */}
        <Button size="lg" disabled={busy} onClick={start}>
          Start
        </Button>
      </div>
      {projects.length === 0 && (
        <p className="mt-2 text-sm text-muted">
          Nie masz dostępnych projektów — poproś kierownika o założenie projektu dla twojej sekcji.
        </p>
      )}
    </Bar>
  );
};

// Natywny <datalist> zamiast własnego comboboksa: działa na tablecie, nie
// dokłada nic do bundla i nie wymaga biblioteki. Renderujemy po jednej liście
// na projekt, żeby podpowiedzi pasowały do tego, co akurat wybrano.
const DescriptionOptions = ({ descByProject }) => (
  <>
    {Object.entries(descByProject).map(([pid, opisy]) => (
      <datalist key={pid} id={`opisy-${pid}`}>
        {opisy.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
    ))}
  </>
);

// --- wznawianie -------------------------------------------------------------

const Resume = ({ suggestions, running, busy, onResume }) => (
  <div className="mt-8">
    {/* Nagłówek mówi, co kliknięcie ZROBI: przy biegnącym timerze zamknie
        bieżące zadanie, więc "Wznów" byłoby wtedy niepełną prawdą. */}
    <h2 className="mb-2 text-xs font-bold uppercase tracking-signage text-muted">
      {running ? "Przełącz na" : "Wznów"}
    </h2>
    <div className="flex gap-2 flex-wrap">
      {suggestions.map((s) => (
        // Nazwa projektu pod opisem, a nie sam kolorowy kwadracik. Kolorów jest
        // siedem (components/projectColors.js) i nic nie pilnuje ich unikalności,
        // więc ta sama czynność w dwóch projektach ("wystawia zlecenia" w ESL
        // i w Namiotach) dawała dwa kafelki nie do odróżnienia. Dwie linie,
        // a nie "opis · projekt" w jednej: kafelek zostaje wąski, a przy sześciu
        // podpowiedziach szerokie kafelki zawijały rząd na trzy linie.
        <button
          key={`${s.projectID}-${s.description}`}
          disabled={busy}
          title={`${s.description} · ${s.projectName} — ${
            running ? "zamknij bieżące zadanie i zacznij to" : "zacznij to zadanie"
          }`}
          onClick={() => onResume(s)}
          className="flex items-start gap-2 max-w-[16rem] py-1.5 px-3 border border-line rounded bg-surface text-sm text-left hover:bg-raised disabled:opacity-50"
        >
          <ProjectMark color={s.projectColor} size="sm" className="mt-1.5" />
          <span className="min-w-0">
            <span className="block truncate">{s.description}</span>
            <span className="block truncate text-xs text-muted">{s.projectName}</span>
          </span>
          <PlayIcon className="w-3.5 h-3.5 shrink-0 mt-1 text-muted" />
        </button>
      ))}
    </div>
  </div>
);

// --- formularz ręczny -------------------------------------------------------

const ManualForm = ({ projects, descByProject, busy, call, today, anyDay }) => {
  const [open, setOpen] = useState(false);
  const yesterday = dayjs(today).subtract(1, "day").format("YYYY-MM-DD");
  // Projekt pusty, jak w pasku timera — z tego samego powodu. Tu jednak wybór
  // jest OBOWIĄZKOWY (`required` niżej): wpis ręczny powstaje od razu zamknięty,
  // więc nie ma późniejszego momentu na uzupełnienie.
  const [form, setForm] = useState({
    projectID: "",
    description: "",
    data: today,
    from: "",
    to: "",
  });

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="mt-6 text-sm font-medium text-accent-strong hover:underline">
        + Dodaj wpis ręcznie
      </button>
    );
  }

  const submit = (e) => {
    e.preventDefault();
    call("/api/entries", { method: "POST", body: JSON.stringify({ action: "manual", ...form }) }).then(
      (ok) => ok && setForm({ ...form, description: "", from: "", to: "" })
    );
  };

  return (
    <form onSubmit={submit} className="mt-6 p-3 border border-line rounded bg-raised">
      {/* Dwa wyraźne rzędy zamiast jednego flex-wrap z siedmioma polami: przy
          wąskim ekranie tamten zawijał godzinę końca i przyciski w przypadkowe
          miejsca. Tu podział jest stały — "co robiłem" nad "kiedy". */}
      <div className="flex gap-2 flex-col sm:flex-row mb-2">
        <Input
          type="text"
          value={form.description}
          list={`opisy-${form.projectID}`}
          maxLength={200}
          placeholder="Opis zadania"
          required
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          className="flex-grow w-auto min-w-0"
        />
        <Select
          value={form.projectID}
          required
          onChange={(e) => setForm({ ...form, projectID: e.target.value ? Number(e.target.value) : "" })}
          className="sm:w-56 shrink-0"
        >
          <option value="">— wybierz projekt —</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </div>

      <div className="flex gap-2 items-end flex-wrap">
        {/* Etykiety nad polami czasu są konieczne: dwa gołe <input type="time">
            obok siebie nie mówią, które jest początkiem, a które końcem. */}
        <SmallField label="Dzień">
          {/* Pracownik ma tylko dziś i wczoraj — wstecz nie sięga. Kierownik dostaje
              pole daty, bo uzupełnia braki z dowolnego okresu; `max` pilnuje jedynie,
              żeby nie wpisać pracy w przyszłość (serwer tego nie zabrania). */}
          {anyDay ? (
            <Input
              type="date"
              value={form.data}
              max={today}
              onChange={(e) => setForm({ ...form, data: e.target.value })}
              required
            />
          ) : (
            <Select
              value={form.data}
              onChange={(e) => setForm({ ...form, data: e.target.value })}
            >
              <option value={today}>dziś</option>
              <option value={yesterday}>wczoraj</option>
            </Select>
          )}
        </SmallField>
        <SmallField label="Od">
          <Input
            type="time"
            value={form.from}
            onChange={(e) => setForm({ ...form, from: e.target.value })}
            required
          />
        </SmallField>
        <SmallField label="Do">
          <Input
            type="time"
            value={form.to}
            onChange={(e) => setForm({ ...form, to: e.target.value })}
            required
          />
        </SmallField>

        <span className="flex gap-2 ml-auto">
          <Button type="submit" disabled={busy}>
            Dodaj
          </Button>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Zwiń
          </Button>
        </span>
      </div>
      <DescriptionOptions descByProject={descByProject} />
    </form>
  );
};

// Lokalna etykieta nad wąskim polem — Field z components/ui rozciąga się na całą
// szerokość, a tu pola daty i godziny mają zostać przy swoich rozmiarach.
const SmallField = ({ label, children }) => (
  <label className="flex flex-col">
    <span className="mb-1 text-xs font-semibold uppercase tracking-signage text-muted">{label}</span>
    {children}
  </label>
);

// --- lista dni --------------------------------------------------------------

const DaySection = ({
  data,
  list,
  label,
  editable,
  projects,
  descByProject,
  busy,
  call,
  running,
  onResume,
}) => {
  const total = list.reduce((sum, e) => sum + (e.seconds || 0), 0);

  return (
    // mt-10, bo przy kilkunastu wpisach dziennie odstęp równy odstępowi między
    // wierszami sprawiał, że "Dziś" i "Wczoraj" ginęły w ścianie tekstu.
    <div className="mt-10">
      <div className="flex items-baseline justify-between border-b border-line pb-2 mb-2">
        {/* first-letter, nie `capitalize`: ten drugi podniósłby też nazwę
            miesiąca ("Środa, 12 Sierpnia"), a po polsku miesiąc piszemy małą. */}
        <h2 className="text-sm font-bold uppercase tracking-signage first-letter:uppercase">{label}</h2>
        <span className="font-mono text-sm tabular-nums text-muted">{formatDuration(total)}</span>
      </div>
      <ul>
        {list.map((e) => (
          <EntryRow
            key={e.id}
            entry={e}
            editable={editable}
            projects={projects}
            descByProject={descByProject}
            busy={busy}
            call={call}
            running={running}
            onResume={onResume}
          />
        ))}
      </ul>
    </div>
  );
};

const EntryRow = ({ entry, editable, projects, descByProject, busy, call, running, onResume }) => {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    projectID: entry.projectID,
    description: entry.description,
    data: entry.data,
    from: hhmm(entry.startedAt),
    to: hhmm(entry.endedAt),
  });

  // Wpis wciąż biegnący pokazuje pasek timera na górze, nie lista.
  if (!entry.endedAt) return null;

  if (editing) {
    return (
      <li className="py-2 px-2 -mx-2 rounded bg-accent-soft border-b border-line-subtle">
        <div className="flex gap-2 flex-wrap items-center">
          <Input
            type="text"
            value={form.description}
            list={`opisy-${form.projectID}`}
            maxLength={200}
            required
            placeholder="Opis zadania"
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="flex-grow w-auto min-w-[8rem] py-1.5"
          />
          {/* Pusta pozycja obsługuje wpis, który wystartował bez projektu i został
              domknięty automatycznie na koniec doby — zapis wymusi jego wybór. */}
          <Select
            value={form.projectID ?? ""}
            required
            onChange={(e) =>
              setForm({ ...form, projectID: e.target.value ? Number(e.target.value) : "" })
            }
            className="py-1.5 w-auto"
          >
            <option value="">— wybierz projekt —</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          {/* W wierszu nie ma miejsca na widoczne etykiety, ale dwa gołe pola
              czasu muszą się dać rozróżnić — stąd aria-label i title. */}
          <Input
            type="time"
            aria-label="Godzina rozpoczęcia"
            title="Od"
            value={form.from}
            onChange={(e) => setForm({ ...form, from: e.target.value })}
            className="py-1.5 w-auto"
          />
          <span className="text-faint text-sm">–</span>
          <Input
            type="time"
            aria-label="Godzina zakończenia"
            title="Do"
            value={form.to}
            onChange={(e) => setForm({ ...form, to: e.target.value })}
            className="py-1.5 w-auto"
          />
          <button
            disabled={busy}
            onClick={() =>
              call(`/api/entries/${entry.id}`, {
                method: "PUT",
                body: JSON.stringify({
                  action: "update",
                  ...form,
                  // Nietknięte godziny lecą z oryginalnymi sekundami — patrz keepSeconds.
                  from: keepSeconds(form.from, entry.startedAt),
                  to: keepSeconds(form.to, entry.endedAt),
                }),
              }).then((ok) => ok && setEditing(false))
            }
            className="inline-flex items-center justify-center gap-2 rounded font-medium whitespace-nowrap transition-colors disabled:opacity-50 bg-accent text-accent-ink hover:bg-accent/90 py-1.5 px-3 text-sm"
          >
            Zapisz
          </button>
          <button onClick={() => setEditing(false)} className="py-1.5 px-2 text-sm text-muted">
            Anuluj
          </button>
        </div>
        <DescriptionOptions descByProject={descByProject} />
      </li>
    );
  }

  return (
    <li
      className={classNames(
        "py-2.5 border-b border-line-subtle",
        entry.autoClosed && "px-2 -mx-2 rounded bg-signal-soft"
      )}
    >
      {/* Rząd BEZ flex-wrap. Wcześniej wiersz był jednym `flex flex-wrap` i długi
          opis wypychał godziny oraz przyciski do drugiej linii — bo `truncate`
          ustawia `white-space: nowrap`, więc naturalna szerokość opisu jest
          ogromna, a flex najpierw ZAWIJA pozostałe elementy, zamiast ŚCISNĄĆ ten
          jeden. Teraz opis się zawija (`break-words`), a prawa kolumna jest
          `shrink-0` i to ona wyznacza prawą krawędź — dla każdego wpisu tak samo.

          `flex-col sm:flex-row`, bo prawa kolumna ma ok. 330px i na telefonie nie
          zmieści się obok opisu; tam schodzi pod niego, dosunięta do prawej. */}
      <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-3">
        <div className="flex gap-2 flex-grow min-w-0">
          {/* mt-1.5 zamiast wyrównania do środka: przy opisie na dwie linie
              znacznik ma stać przy pierwszej z nich, a nie dryfować do połowy
              wysokości. */}
          <ProjectMark color={entry.projectColor} className="mt-1.5" />
          <span className="min-w-0">
            <span
              className={classNames(
                "block break-words",
                entry.description ? "font-medium" : "text-faint"
              )}
            >
              {entry.description || "(bez opisu)"}
            </span>
            <span
              className={classNames("block text-xs", entry.projectName ? "text-muted" : "text-faint")}
            >
              {entry.projectName || NO_PROJECT}
              {entry.editedByName && ` · popr. ${entry.editedByName}`}
            </span>
          </span>
        </div>

        {/* shrink-0 na CAŁEJ prawej kolumnie — godziny, wymiar i przyciski trzymają
            się razem i nigdy nie ustępują miejsca opisowi. */}
        <div className="flex items-center gap-2 shrink-0 self-end sm:self-start">
          {/* Zakres w "HH:mm", bo tak się o godzinach mówi — ale wpis krótszy niż
              minuta wygląda wtedy jak "9:12–9:12". Sekundy siedzą w podpowiedzi,
              a wymiar obok i tak podaje je wprost. */}
          <span
            className="font-mono text-sm text-muted tabular-nums"
            title={`${timePart(entry.startedAt)}–${timePart(entry.endedAt)}`}
          >
            {hhmm(entry.startedAt)}–{hhmm(entry.endedAt)}
          </span>
          {/* Szerokość pod pełny wymiar z sekundami ("12h 05min 30s"), żeby kolumna
              czasu stała w jednej linii pionowej niezależnie od długości wpisu. */}
          <span className="font-mono text-sm font-medium tabular-nums w-28 text-right">
            {formatDuration(entry.seconds)}
          </span>

          <span className="flex gap-1">
            <IconButton
              disabled={busy}
              label={running ? "Przełącz się na to zadanie" : "Wznów to zadanie"}
              onClick={() => onResume(entry)}
            >
              <PlayIcon />
            </IconButton>
            <IconButton
              disabled={busy || !editable}
              label={editable ? "Popraw wpis" : "Poprawka możliwa tylko dla dziś i wczoraj"}
              onClick={() => setEditing(true)}
            >
              <PencilIcon />
            </IconButton>
            <IconButton
              disabled={busy || !editable}
              label={editable ? "Usuń wpis" : "Usuwanie możliwe tylko dla dziś i wczoraj"}
              onClick={() =>
                window.confirm("Usunąć ten wpis?") &&
                call(`/api/entries/${entry.id}`, { method: "DELETE" })
              }
            >
              <TrashIcon />
            </IconButton>
          </span>
        </div>
      </div>

      {/* Poza rzędem flexowym: bez `flex-wrap` sztuczka z `w-full` przestałaby
          działać, a komunikat ma iść pełną szerokością pod całym wpisem. */}
      {entry.autoClosed && (
        <p className="mt-1 text-xs text-signal-strong">
          Timer domknął się automatycznie na koniec doby — sprawdź czas i popraw wpis.
        </p>
      )}
    </li>
  );
};
