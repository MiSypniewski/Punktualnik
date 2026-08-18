import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useRouter } from "next/router";
import { mutate } from "swr";
import { getToken } from "next-auth/jwt";
import classNames from "classnames";
import dayjs from "dayjs";
import "dayjs/locale/pl";
import BaseLayout from "../../components/baseLayout";
import { projectColor } from "../../components/projectColors";
import { listProjects, projectScope } from "../../services/projects";
import { getEntriesForUser, getRunningEntry, closeStaleEntries } from "../../services/taskEntries";
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
  closeStaleEntries();

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
};

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
      <section className="mx-auto p-4 mb-8 max-w-5xl">
        <TimerBar
          running={running}
          projects={projects}
          descByProject={descByProject}
          busy={busy}
          call={call}
          onError={setErr}
        />

        {err && (
          <p className="my-3 p-2 bg-red-50 border border-red-300 text-red-700 text-sm rounded">{err}</p>
        )}

        {info && (
          <p className="my-3 p-2 bg-emerald-50 border border-emerald-300 text-emerald-800 text-sm rounded">
            {info}
          </p>
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
          <p className="mt-8 text-gray-500 text-sm">
            Nie masz jeszcze żadnych wpisów. Wybierz projekt, opisz zadanie i naciśnij Start.
          </p>
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
      </section>
    </BaseLayout>
  );
}

// --- pasek timera -----------------------------------------------------------

const Bar = ({ children }) => (
  <div className="sticky top-0 z-10 -mx-4 px-4 py-3 bg-white border-b-2 border-indigo-500 shadow-sm">
    {children}
  </div>
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

  const stop = async () => {
    await flush();
    call(`/api/entries/${running.id}`, { method: "PUT", body: JSON.stringify({ action: "stop" }) });
  };

  // Projekt zarchiwizowany w trakcie pracy wypadłby z listy, a <select> wskazałby
  // wtedy pierwszą pozycję z brzegu i cicho przeniósł czas na cudzy projekt.
  const options = projects.some((p) => p.id === draft.projectID)
    ? projects
    : [{ id: draft.projectID, name: "— projekt poza listą —" }, ...projects];

  const project = options.find((p) => p.id === draft.projectID);

  return (
    <Bar>
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`w-3 h-3 rounded-full shrink-0 ${projectColor(project?.color).dot}`} />
        {/* Te same pola co przed startem, w tym samym układzie — pasek nie zmienia
            kształtu po naciśnięciu Start, zmienia się tylko przycisk po prawej. */}
        <input
          type="text"
          value={draft.description}
          list={`opisy-${draft.projectID}`}
          maxLength={200}
          placeholder="Nad czym pracujesz?"
          onChange={(e) => edit({ description: e.target.value })}
          onBlur={flush}
          onKeyDown={(e) => e.key === "Enter" && flush()}
          className="flex-grow min-w-[12rem] p-2 border border-indigo-400 rounded text-indigo-500"
        />
        <DescriptionOptions descByProject={descByProject} />

        <select
          value={draft.projectID}
          onChange={(e) => edit({ projectID: Number(e.target.value) }, { now: true })}
          className="p-2 border border-indigo-400 rounded w-full sm:w-56 shrink-0"
        >
          {options.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>

        <span className="font-mono text-xl tabular-nums">{elapsed || "…"}</span>
        <button
          disabled={busy}
          onClick={stop}
          className="text-white bg-rose-500 hover:bg-rose-600 py-2 px-6 rounded font-bold disabled:opacity-50"
        >
          Stop
        </button>
      </div>
      <p className="mt-1 text-xs text-gray-500">
        od {hhmm(running.startedAt)} · opis i projekt zapisują się same
        {saved && <span className="ml-2 text-emerald-700 font-medium">zapisano ✓</span>}
      </p>
    </Bar>
  );
};

const TimerBar = ({ running, projects, descByProject, busy, call, onError }) => {
  const [projectID, setProjectID] = useState(projects[0]?.id ?? "");
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

  const start = () => {
    if (!projectID) return;
    call("/api/entries", {
      method: "POST",
      body: JSON.stringify({ action: "start", projectID, description }),
    }).then((ok) => ok && setDescription(""));
  };

  return (
    <Bar>
      {/* Opis z lewej, projekt z prawej: zdanie zaczyna się od tego, CO się robi,
          a projekt jest doprecyzowaniem. Opis dostaje też całą wolną szerokość,
          bo bywa dłuższy niż nazwa projektu. */}
      <div className="flex items-center gap-2 flex-wrap">
        <input
          type="text"
          value={description}
          list={`opisy-${projectID}`}
          maxLength={200}
          placeholder="Nad czym pracujesz?"
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && start()}
          className="flex-grow min-w-[12rem] p-2 border border-indigo-400 rounded text-indigo-500"
        />
        <DescriptionOptions descByProject={descByProject} />

        {/* Stała szerokość, bo nazwy projektów bywają długie ("Nowe i remontowane
            sklepy") i bez niej select albo rozpycha pasek, albo ucina tekst
            na krawędzi. */}
        <select
          value={projectID}
          onChange={(e) => setProjectID(Number(e.target.value))}
          className="p-2 border border-indigo-400 rounded w-full sm:w-56 shrink-0"
        >
          {projects.length === 0 && <option value="">— brak projektów —</option>}
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>

        <button
          disabled={busy || projects.length === 0}
          onClick={start}
          className="text-white bg-indigo-500 hover:bg-indigo-600 py-2 px-8 rounded font-bold disabled:opacity-50"
        >
          Start
        </button>
      </div>
      {projects.length === 0 && (
        <p className="mt-2 text-sm text-gray-600">
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
    <h2 className="text-sm font-bold text-gray-700 mb-2">{running ? "Przełącz na" : "Wznów"}</h2>
    <div className="flex gap-2 flex-wrap">
      {suggestions.map((s) => (
        <button
          key={`${s.projectID}-${s.description}`}
          disabled={busy}
          title={running ? "Zamknij bieżące zadanie i zacznij to" : "Zacznij to zadanie"}
          onClick={() => onResume(s)}
          className="flex items-center gap-2 max-w-full py-1.5 px-3 border border-gray-300 rounded-full text-sm hover:bg-gray-50 disabled:opacity-50"
        >
          <span className={`w-2 h-2 rounded-full shrink-0 ${projectColor(s.projectColor).dot}`} />
          <span className="truncate text-indigo-500">{s.description}</span>
          <span className="text-gray-500 shrink-0">▶</span>
        </button>
      ))}
    </div>
  </div>
);

// --- formularz ręczny -------------------------------------------------------

const ManualForm = ({ projects, descByProject, busy, call, today, anyDay }) => {
  const [open, setOpen] = useState(false);
  const yesterday = dayjs(today).subtract(1, "day").format("YYYY-MM-DD");
  const [form, setForm] = useState({
    projectID: projects[0]?.id ?? "",
    description: "",
    data: today,
    from: "",
    to: "",
  });

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="mt-6 text-sm text-indigo-600 hover:underline">
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
    <form onSubmit={submit} className="mt-6 p-3 border border-gray-300 rounded bg-gray-50">
      {/* Dwa wyraźne rzędy zamiast jednego flex-wrap z siedmioma polami: przy
          wąskim ekranie tamten zawijał godzinę końca i przyciski w przypadkowe
          miejsca. Tu podział jest stały — "co robiłem" nad "kiedy". */}
      <div className="flex gap-2 flex-col sm:flex-row mb-2">
        <input
          type="text"
          value={form.description}
          list={`opisy-${form.projectID}`}
          maxLength={200}
          placeholder="Opis zadania"
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          className="flex-grow min-w-0 p-2 border border-gray-400 rounded text-indigo-500"
        />
        <select
          value={form.projectID}
          onChange={(e) => setForm({ ...form, projectID: Number(e.target.value) })}
          className="p-2 border border-gray-400 rounded sm:w-56 shrink-0"
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex gap-2 items-end flex-wrap">
        {/* Etykiety nad polami czasu są konieczne: dwa gołe <input type="time">
            obok siebie nie mówią, które jest początkiem, a które końcem. */}
        <SmallField label="Dzień">
          {/* Pracownik ma tylko dziś i wczoraj — wstecz nie sięga. Kierownik dostaje
              pole daty, bo uzupełnia braki z dowolnego okresu; `max` pilnuje jedynie,
              żeby nie wpisać pracy w przyszłość (serwer tego nie zabrania). */}
          {anyDay ? (
            <input
              type="date"
              value={form.data}
              max={today}
              onChange={(e) => setForm({ ...form, data: e.target.value })}
              className="p-2 border border-gray-400 rounded"
              required
            />
          ) : (
            <select
              value={form.data}
              onChange={(e) => setForm({ ...form, data: e.target.value })}
              className="p-2 border border-gray-400 rounded"
            >
              <option value={today}>dziś</option>
              <option value={yesterday}>wczoraj</option>
            </select>
          )}
        </SmallField>
        <SmallField label="Od">
          <input
            type="time"
            value={form.from}
            onChange={(e) => setForm({ ...form, from: e.target.value })}
            className="p-2 border border-gray-400 rounded"
            required
          />
        </SmallField>
        <SmallField label="Do">
          <input
            type="time"
            value={form.to}
            onChange={(e) => setForm({ ...form, to: e.target.value })}
            className="p-2 border border-gray-400 rounded"
            required
          />
        </SmallField>

        <span className="flex gap-2 ml-auto">
          <button
            type="submit"
            disabled={busy}
            className="text-white bg-indigo-500 hover:bg-indigo-600 py-2 px-5 rounded disabled:opacity-50"
          >
            Dodaj
          </button>
          <button type="button" onClick={() => setOpen(false)} className="py-2 px-3 text-gray-600">
            Zwiń
          </button>
        </span>
      </div>
      <DescriptionOptions descByProject={descByProject} />
    </form>
  );
};

const SmallField = ({ label, children }) => (
  <label className="flex flex-col">
    <span className="mb-1 text-xs font-medium text-gray-700">{label}</span>
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
      <div className="flex items-baseline justify-between border-b border-gray-300 pb-2 mb-2">
        {/* first-letter, nie `capitalize`: ten drugi podniósłby też nazwę
            miesiąca ("Środa, 12 Sierpnia"), a po polsku miesiąc piszemy małą. */}
        <h2 className="text-lg font-bold first-letter:uppercase">{label}</h2>
        <span className="text-sm text-gray-600">{formatDuration(total)}</span>
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
      <li className="py-2 border-b border-gray-100">
        <div className="flex gap-2 flex-wrap items-center">
          <input
            type="text"
            value={form.description}
            list={`opisy-${form.projectID}`}
            maxLength={200}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="flex-grow min-w-[8rem] p-1.5 border border-gray-400 rounded text-sm text-indigo-500"
          />
          <select
            value={form.projectID}
            onChange={(e) => setForm({ ...form, projectID: Number(e.target.value) })}
            className="p-1.5 border border-gray-400 rounded text-sm"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {/* W wierszu nie ma miejsca na widoczne etykiety, ale dwa gołe pola
              czasu muszą się dać rozróżnić — stąd aria-label i title. */}
          <input
            type="time"
            aria-label="Godzina rozpoczęcia"
            title="Od"
            value={form.from}
            onChange={(e) => setForm({ ...form, from: e.target.value })}
            className="p-1.5 border border-gray-400 rounded text-sm"
          />
          <span className="text-gray-400 text-sm">–</span>
          <input
            type="time"
            aria-label="Godzina zakończenia"
            title="Do"
            value={form.to}
            onChange={(e) => setForm({ ...form, to: e.target.value })}
            className="p-1.5 border border-gray-400 rounded text-sm"
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
            className="text-white bg-indigo-500 hover:bg-indigo-600 py-1.5 px-4 rounded text-sm disabled:opacity-50"
          >
            Zapisz
          </button>
          <button onClick={() => setEditing(false)} className="py-1.5 px-2 text-sm text-gray-600">
            Anuluj
          </button>
        </div>
        <DescriptionOptions descByProject={descByProject} />
      </li>
    );
  }

  return (
    <li
      className={classNames("py-2.5 border-b border-gray-100", entry.autoClosed && "bg-amber-50")}
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
          {/* mt-1.5 zamiast wyrównania do środka: przy opisie na dwie linie kropka
              ma stać przy pierwszej z nich, a nie dryfować do połowy wysokości. */}
          <span
            className={`w-2.5 h-2.5 mt-1.5 rounded-full shrink-0 ${projectColor(entry.projectColor).dot}`}
          />
          <span className="min-w-0">
            <span
              className={classNames(
                "block break-words",
                entry.description ? "text-indigo-500" : "text-gray-400"
              )}
            >
              {entry.description || "(bez opisu)"}
            </span>
            <span className="block text-xs text-gray-600">
              {entry.projectName}
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
            className="text-sm text-gray-600 tabular-nums"
            title={`${timePart(entry.startedAt)}–${timePart(entry.endedAt)}`}
          >
            {hhmm(entry.startedAt)}–{hhmm(entry.endedAt)}
          </span>
          {/* Szerokość pod pełny wymiar z sekundami ("12h 05min 30s"), żeby kolumna
              czasu stała w jednej linii pionowej niezależnie od długości wpisu. */}
          <span className="text-sm font-medium tabular-nums w-28 text-right">
            {formatDuration(entry.seconds)}
          </span>

          <span className="flex gap-1">
            <button
              disabled={busy}
              title={running ? "Przełącz się na to zadanie" : "Wznów to zadanie"}
              onClick={() => onResume(entry)}
              className="py-1 px-2 border border-gray-300 rounded text-sm hover:bg-gray-50 disabled:opacity-50"
            >
              ▶
            </button>
            <button
              disabled={busy || !editable}
              title={editable ? "Edytuj" : "Edycja możliwa tylko dla dziś i wczoraj"}
              onClick={() => setEditing(true)}
              className="py-1 px-2 border border-gray-300 rounded text-sm hover:bg-gray-50 disabled:opacity-30"
            >
              ✎
            </button>
            <button
              disabled={busy || !editable}
              title={editable ? "Usuń" : "Usuwanie możliwe tylko dla dziś i wczoraj"}
              onClick={() =>
                window.confirm("Usunąć ten wpis?") &&
                call(`/api/entries/${entry.id}`, { method: "DELETE" })
              }
              className="py-1 px-2 border border-gray-300 rounded text-sm hover:bg-gray-50 disabled:opacity-30"
            >
              🗑
            </button>
          </span>
        </div>
      </div>

      {/* Poza rzędem flexowym: bez `flex-wrap` sztuczka z `w-full` przestałaby
          działać, a komunikat ma iść pełną szerokością pod całym wpisem. */}
      {entry.autoClosed && (
        <p className="mt-1 text-xs text-amber-800">
          Timer domknął się automatycznie na koniec doby — sprawdź czas i popraw wpis.
        </p>
      )}
    </li>
  );
};
