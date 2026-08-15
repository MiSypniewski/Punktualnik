import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/router";
import { getToken } from "next-auth/jwt";
import classNames from "classnames";
import dayjs from "dayjs";
import "dayjs/locale/pl";
import BaseLayout from "../../components/baseLayout";
import { projectColor } from "../../components/projectColors";
import { listProjects, projectScope } from "../../services/projects";
import { getEntriesForUser, getRunningEntry, closeStaleEntries } from "../../services/taskEntries";
import { getSuggestions, suggestionsByProject } from "../../services/entrySuggestions";
import { canTrackTasks } from "../../services/roles";
import { workDay, minEditableDay } from "../../services/workday";
import { formatMinutes } from "../../utils";

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
    },
  };
}

const hhmm = (ts) => String(ts ?? "").slice(11, 16);

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
}) {
  const router = useRouter();
  const refresh = () => router.replace(router.asPath, undefined, { scroll: false });

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const call = async (url, options) => {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch(url, {
        headers: { "Content-Type": "application/json" },
        ...options,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErr(body.message || body.error || "Nie udało się zapisać.");
        return false;
      }
      await refresh();
      return true;
    } finally {
      setBusy(false);
    }
  };

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
      <section className="mx-auto p-4 mb-8 max-w-3xl">
        <TimerBar
          running={running}
          projects={projects}
          descByProject={descByProject}
          busy={busy}
          call={call}
        />

        {err && (
          <p className="my-3 p-2 bg-red-50 border border-red-300 text-red-700 text-sm rounded">{err}</p>
        )}

        {suggestions.length > 0 && !running && (
          <Resume suggestions={suggestions} busy={busy} call={call} />
        )}

        <ManualForm projects={projects} descByProject={descByProject} busy={busy} call={call} today={today} />

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
            editable={data >= minEditable}
            projects={projects}
            descByProject={descByProject}
            busy={busy}
            call={call}
          />
        ))}
      </section>
    </BaseLayout>
  );
}

// --- pasek timera -----------------------------------------------------------

const TimerBar = ({ running, projects, descByProject, busy, call }) => {
  const [projectID, setProjectID] = useState(projects[0]?.id ?? "");
  const [description, setDescription] = useState("");
  const [elapsed, setElapsed] = useState("");

  // Licznik startuje dopiero po zamontowaniu — inaczej HTML z serwera
  // i pierwszy render klienta różniłyby się o sekundę (hydration mismatch).
  useEffect(() => {
    if (!running) return undefined;

    const tick = () => {
      const mins = dayjs().diff(dayjs(running.startedAt), "minute");
      const secs = dayjs().diff(dayjs(running.startedAt), "second") % 60;
      setElapsed(`${formatMinutes(mins)} ${String(secs).padStart(2, "0")}s`);
    };

    tick();
    const handle = setInterval(tick, 1000);
    return () => clearInterval(handle);
  }, [running]);

  if (running) {
    const project = projects.find((p) => p.id === running.projectID);
    return (
      <div className="sticky top-0 z-10 -mx-4 px-4 py-3 bg-white border-b-2 border-emerald-500 shadow-sm">
        <div className="flex items-center gap-3 flex-wrap">
          <span className={`w-3 h-3 rounded-full shrink-0 ${projectColor(project?.color).dot}`} />
          <div className="flex-grow min-w-0">
            <p className="font-medium truncate">{running.description || "(bez opisu)"}</p>
            <p className="text-sm text-gray-600">
              {project?.name ?? "—"} · od {hhmm(running.startedAt)}
            </p>
          </div>
          <span className="font-mono text-xl tabular-nums">{elapsed || "…"}</span>
          <button
            disabled={busy}
            onClick={() => call(`/api/entries/${running.id}`, { method: "PUT", body: JSON.stringify({ action: "stop" }) })}
            className="text-white bg-rose-500 hover:bg-rose-600 py-2 px-6 rounded font-bold disabled:opacity-50"
          >
            Stop
          </button>
        </div>
      </div>
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
    <div className="sticky top-0 z-10 -mx-4 px-4 py-3 bg-white border-b-2 border-indigo-500 shadow-sm">
      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={projectID}
          onChange={(e) => setProjectID(Number(e.target.value))}
          className="p-2 border border-indigo-400 rounded"
        >
          {projects.length === 0 && <option value="">— brak projektów —</option>}
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>

        <input
          type="text"
          value={description}
          list={`opisy-${projectID}`}
          maxLength={200}
          placeholder="Nad czym pracujesz?"
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && start()}
          className="flex-grow min-w-[12rem] p-2 border border-indigo-400 rounded"
        />
        <DescriptionOptions descByProject={descByProject} />

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
    </div>
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

const Resume = ({ suggestions, busy, call }) => (
  <div className="mt-4">
    <h2 className="text-sm font-bold text-gray-700 mb-2">Wznów</h2>
    <div className="flex gap-2 flex-wrap">
      {suggestions.map((s) => (
        <button
          key={`${s.projectID}-${s.description}`}
          disabled={busy}
          onClick={() =>
            call("/api/entries", {
              method: "POST",
              body: JSON.stringify({ action: "start", projectID: s.projectID, description: s.description }),
            })
          }
          className="flex items-center gap-2 max-w-full py-1.5 px-3 border border-gray-300 rounded-full text-sm hover:bg-gray-50 disabled:opacity-50"
        >
          <span className={`w-2 h-2 rounded-full shrink-0 ${projectColor(s.projectColor).dot}`} />
          <span className="truncate">{s.description}</span>
          <span className="text-gray-500 shrink-0">▶</span>
        </button>
      ))}
    </div>
  </div>
);

// --- formularz ręczny -------------------------------------------------------

const ManualForm = ({ projects, descByProject, busy, call, today }) => {
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
      <button onClick={() => setOpen(true)} className="mt-4 text-sm text-indigo-600 hover:underline">
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
    <form onSubmit={submit} className="mt-4 p-3 border border-gray-300 rounded bg-gray-50">
      <div className="flex gap-2 flex-wrap items-end">
        <select
          value={form.projectID}
          onChange={(e) => setForm({ ...form, projectID: Number(e.target.value) })}
          className="p-2 border border-gray-400 rounded"
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={form.description}
          list={`opisy-${form.projectID}`}
          maxLength={200}
          placeholder="Opis zadania"
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          className="flex-grow min-w-[10rem] p-2 border border-gray-400 rounded"
        />
        {/* Tylko dziś i wczoraj — wstecz pracownik nie sięga. */}
        <select
          value={form.data}
          onChange={(e) => setForm({ ...form, data: e.target.value })}
          className="p-2 border border-gray-400 rounded"
        >
          <option value={today}>dziś</option>
          <option value={yesterday}>wczoraj</option>
        </select>
        <input
          type="time"
          value={form.from}
          onChange={(e) => setForm({ ...form, from: e.target.value })}
          className="p-2 border border-gray-400 rounded"
          required
        />
        <input
          type="time"
          value={form.to}
          onChange={(e) => setForm({ ...form, to: e.target.value })}
          className="p-2 border border-gray-400 rounded"
          required
        />
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
      </div>
      <DescriptionOptions descByProject={descByProject} />
    </form>
  );
};

// --- lista dni --------------------------------------------------------------

const DaySection = ({ data, list, label, editable, projects, descByProject, busy, call }) => {
  const total = list.reduce((sum, e) => sum + (e.minutes || 0), 0);

  return (
    <div className="mt-6">
      <div className="flex items-baseline justify-between border-b border-gray-300 pb-1 mb-1">
        {/* first-letter, nie `capitalize`: ten drugi podniósłby też nazwę
            miesiąca ("Środa, 12 Sierpnia"), a po polsku miesiąc piszemy małą. */}
        <h2 className="font-bold first-letter:uppercase">{label}</h2>
        <span className="text-sm text-gray-600">{formatMinutes(total)}</span>
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
          />
        ))}
      </ul>
    </div>
  );
};

const EntryRow = ({ entry, editable, projects, descByProject, busy, call }) => {
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
          <input
            type="text"
            value={form.description}
            list={`opisy-${form.projectID}`}
            maxLength={200}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="flex-grow min-w-[8rem] p-1.5 border border-gray-400 rounded text-sm"
          />
          <input
            type="time"
            value={form.from}
            onChange={(e) => setForm({ ...form, from: e.target.value })}
            className="p-1.5 border border-gray-400 rounded text-sm"
          />
          <input
            type="time"
            value={form.to}
            onChange={(e) => setForm({ ...form, to: e.target.value })}
            className="p-1.5 border border-gray-400 rounded text-sm"
          />
          <button
            disabled={busy}
            onClick={() =>
              call(`/api/entries/${entry.id}`, {
                method: "PUT",
                body: JSON.stringify({ action: "update", ...form }),
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
      className={classNames(
        "flex items-center gap-2 py-2 border-b border-gray-100 flex-wrap",
        entry.autoClosed && "bg-amber-50"
      )}
    >
      <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${projectColor(entry.projectColor).dot}`} />
      <span className="flex-grow min-w-0">
        <span className="block truncate">{entry.description || "(bez opisu)"}</span>
        <span className="block text-xs text-gray-600">
          {entry.projectName}
          {entry.editedByName && ` · popr. ${entry.editedByName}`}
        </span>
      </span>

      <span className="text-sm text-gray-600 tabular-nums">
        {hhmm(entry.startedAt)}–{hhmm(entry.endedAt)}
      </span>
      <span className="text-sm font-medium tabular-nums w-20 text-right">{formatMinutes(entry.minutes)}</span>

      <span className="flex gap-1">
        <button
          disabled={busy}
          title="Wznów to zadanie"
          onClick={() =>
            call("/api/entries", {
              method: "POST",
              body: JSON.stringify({
                action: "start",
                projectID: entry.projectID,
                description: entry.description,
              }),
            })
          }
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

      {entry.autoClosed && (
        <p className="w-full text-xs text-amber-800">
          Timer domknął się automatycznie na koniec doby — sprawdź czas i popraw wpis.
        </p>
      )}
    </li>
  );
};
