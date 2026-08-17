import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/router";
import { getToken } from "next-auth/jwt";
import classNames from "classnames";
import dayjs from "dayjs";
import "dayjs/locale/pl";
import BaseLayout from "../../components/baseLayout";
import LiveBoard from "../../components/liveBoard";
import { projectColor } from "../../components/projectColors";
import { listProjects, projectScope } from "../../services/projects";
import { getSummary, getByProject, getByUser, getEntries } from "../../services/entryStats";
import { getLiveBoard } from "../../services/liveBoard";
import { closeStaleEntries } from "../../services/taskEntries";
import getAllUsers from "../../services/getAllUsers";
import { canSeeTeamTasks, canExportTasks } from "../../services/roles";
import { now as appNow } from "../../services/workday";
import { visibleSections } from "../../services/scope";
import { formatDuration, hhmm, keepSeconds, timePart, TASK_QUERY_MAX } from "../../utils";

dayjs.locale("pl");

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function getServerSideProps(ctx) {
  const token = await getToken({ req: ctx.req });

  if (!token) {
    return { redirect: { destination: "/users/signin", permanent: false } };
  }
  if (!canSeeTeamTasks(token.role)) {
    return { notFound: true };
  }

  // Żeby raport nie pomijał czasu wiszącego w zapomnianym timerze.
  closeStaleEntries();

  // Filtry żyją w query stringu, więc widok da się odświeżyć i zalinkować —
  // ten sam wzorzec co w panelu nadgodzin.
  const { from, to, projectID, userID, minMinutes, q } = ctx.query;
  const filters = {
    // appNow(), nie dayjs(): to biegnie na serwerze, który może stać w innej
    // strefie niż firma — inaczej domyślny zakres potrafiłby zaczynać się
    // od złego dnia (zob. services/workday.js).
    from: DATE_RE.test(from || "") ? from : appNow().date(1).format("YYYY-MM-DD"),
    to: DATE_RE.test(to || "") ? to : appNow().format("YYYY-MM-DD"),
    projectID: /^\d+$/.test(projectID || "") ? projectID : "",
    userID: /^\d+$/.test(userID || "") ? userID : "",
    minMinutes: /^\d+$/.test(minMinutes || "") ? minMinutes : "",
    // Fraza szukana w opisie zadania. Bez wzorca — to ma być zwykły tekst,
    // z polskimi znakami włącznie; przycięcie pilnuje tylko rozsądnej długości.
    q: String(q ?? "").trim().slice(0, TASK_QUERY_MAX),
  };

  const sections = visibleSections(token);
  const query = { ...filters, sections };

  return {
    props: {
      filters,
      sections,
      canExport: canExportTasks(token.role),
      // Migawka bieżącej pracy. Świadomie liczona z samych `sections`, bez
      // `filters`: to stan na teraz, a nie wycinek okresu — zakres dat czy
      // wybrany projekt nie mają tu czego zawężać. Dalej odświeża ją już
      // /api/entries/running, ten props służy pierwszemu renderowi.
      live: getLiveBoard(sections),
      currentUserID: Number(token.userID),
      summary: getSummary(query),
      byProject: getByProject(query),
      byUser: getByUser(query),
      detail: getEntries(query),
      projects: listProjects({ sections: projectScope(token), includeArchived: true }),
      // Do EDYCJI wpisu potrzebne są projekty widziane oczami PRACOWNIKA, a nie
      // kierownika: API sprawdza wybór jego zasięgiem (pages/api/entries/[id].js),
      // więc lista z sekcji kierownika podsuwałaby pozycje kończące się odmową.
      // Sekcji są jednostki, więc trzymanie osobnej listy dla każdej jest tańsze
      // niż liczenie tego per wiersz.
      projectsBySection: Object.fromEntries(
        sections.map((s) => [s, listProjects({ sections: [s] })])
      ),
      users: getAllUsers(sections),
    },
  };
}

// Endpoint zwraca same kody; wiadomość z serwera przychodzi tylko dla błędów
// walidacji z services/taskEntries.js (kolizja, zły zakres). Resztę tłumaczymy tu.
const ERRORS = {
  project_out_of_scope: "Ten projekt nie jest dostępny dla sekcji tego pracownika.",
  project_not_found: "Wybranego projektu już nie ma.",
  permission_denied: "Ten wpis jest poza twoim zasięgiem.",
  not_found: "Tego wpisu już nie ma — odśwież raport.",
  bad_project: "Wybierz projekt.",
};

export default function ZarzadzajZadaniami({
  filters,
  sections,
  canExport,
  live,
  currentUserID,
  summary,
  byProject,
  byUser,
  detail,
  projects,
  projectsBySection,
  users,
}) {
  const router = useRouter();

  const [form, setForm] = useState(filters);
  const [editingID, setEditingID] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // Przy zmianie samego query stringu Next nie montuje komponentu od nowa,
  // więc useState zostałby z poprzednimi wartościami i pola filtrów
  // pokazywałyby co innego niż tabela pod spodem.
  useEffect(() => setForm(filters), [filters]);

  const apply = (e) => {
    e.preventDefault();
    const qs = new URLSearchParams();
    Object.entries(form).forEach(([k, v]) => v && qs.set(k, v));
    router.push(`/zadania/zarzadzaj?${qs.toString()}`);
  };

  /**
   * Zapis poprawionego wpisu. Kierownika nie obowiązuje okno "dziś i wczoraj" —
   * decyduje o tym API (pages/api/entries/[id].js), nie ten formularz.
   *
   * Po udanym zapisie przeładowujemy propsy z serwera zamiast łatać wiersz
   * w stanie: zmiana czasu rusza też sumy, udziały projektów i zestawienie
   * z obecnością nad tabelą.
   */
  const saveEntry = async (id, body) => {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch(`/api/entries/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update", ...body }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        setErr(payload.message || ERRORS[payload.error] || "Nie udało się zapisać zmiany.");
        return false;
      }
      await router.replace(router.asPath, undefined, { scroll: false });
      return true;
    } finally {
      setBusy(false);
    }
  };

  // Nawigacja, nie fetch — przeglądarka sama zapisze plik zgodnie
  // z Content-Disposition, a ciasteczko sesji leci automatycznie.
  const download = (tryb) => {
    const qs = new URLSearchParams({ tryb });
    Object.entries(filters).forEach(([k, v]) => v && qs.set(k, v));
    window.location.href = `/api/report/zadania?${qs.toString()}`;
  };

  const maxSeconds = byProject[0]?.seconds || 1;

  if (sections.length === 0) {
    return (
      <BaseLayout>
        <section className="mx-auto p-4 mt-6 max-w-2xl">
          <h1 className="text-2xl font-bold mb-4">Raport zadań</h1>
          <p className="p-3 bg-amber-50 border border-amber-300 rounded text-sm">
            Nie masz przypisanej żadnej sekcji, więc nie widzisz niczyich danych. Przypisanie nadaje się
            komendą <code className="font-mono">npm run admin -- sections &lt;e-mail&gt; &lt;sekcje&gt;</code>.
          </p>
        </section>
      </BaseLayout>
    );
  }

  return (
    <BaseLayout>
      <section className="mx-auto p-4 mt-6 mb-10 max-w-6xl">
        <h1 className="text-2xl font-bold mb-4">Raport zadań</h1>

        <LiveBoard initial={live} currentUserID={currentUserID} />

        <form onSubmit={apply} className="mb-6 p-3 border border-gray-300 rounded bg-gray-50">
          <div className="flex gap-3 flex-wrap items-end">
            <Field label="Od">
              <input
                type="date"
                value={form.from}
                onChange={(e) => setForm({ ...form, from: e.target.value })}
                className="p-2 border border-gray-400 rounded"
              />
            </Field>
            <Field label="Do">
              <input
                type="date"
                value={form.to}
                onChange={(e) => setForm({ ...form, to: e.target.value })}
                className="p-2 border border-gray-400 rounded"
              />
            </Field>
            <Field label="Projekt">
              <select
                value={form.projectID}
                onChange={(e) => setForm({ ...form, projectID: e.target.value })}
                className="p-2 border border-gray-400 rounded"
              >
                <option value="">— wszystkie —</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.isActive ? "" : " (archiwalny)"}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Pracownik">
              <select
                value={form.userID}
                onChange={(e) => setForm({ ...form, userID: e.target.value })}
                className="p-2 border border-gray-400 rounded"
              >
                <option value="">— wszyscy —</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.surname} {u.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Zadanie">
              {/* Fragment opisu, wielkość liter bez znaczenia (także dla polskich
                  znaków — porównanie robi plContains w services/entryStats.js). */}
              <input
                type="search"
                value={form.q}
                maxLength={TASK_QUERY_MAX}
                placeholder="fragment opisu"
                onChange={(e) => setForm({ ...form, q: e.target.value })}
                className="p-2 border border-gray-400 rounded w-48"
              />
            </Field>
            <Field label="Wpisy dłuższe niż">
              <select
                value={form.minMinutes}
                onChange={(e) => setForm({ ...form, minMinutes: e.target.value })}
                className="p-2 border border-gray-400 rounded"
              >
                <option value="">— bez progu —</option>
                <option value="15">15 min</option>
                <option value="30">30 min</option>
                <option value="60">1 h</option>
                <option value="240">4 h</option>
              </select>
            </Field>

            <button type="submit" className="text-white bg-indigo-500 hover:bg-indigo-600 py-2 px-6 rounded">
              Pokaż
            </button>
            <button
              type="button"
              onClick={() => router.push("/zadania/zarzadzaj")}
              className="py-2 px-4 border border-gray-400 rounded"
            >
              Wyczyść
            </button>
          </div>
        </form>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
          <Kpi label="Zaraportowany czas" value={formatDuration(summary.seconds)} />
          <Kpi label="Liczba wpisów" value={summary.entries} />
          <Kpi label="Raportujących osób" value={summary.people} />
          <Kpi
            label="Domknięte automatycznie"
            value={summary.autoClosed}
            warn={summary.autoClosed > 0}
            hint={summary.autoClosed > 0 ? "wymagają sprawdzenia" : null}
          />
        </div>

        <h2 className="font-bold mb-2">Wg projektów</h2>
        {byProject.length === 0 ? (
          <p className="text-sm text-gray-500 mb-8">Brak wpisów w tym zakresie.</p>
        ) : (
          <table className="w-full mb-8 text-sm">
            <thead>
              <tr className="text-left border-b border-gray-300">
                <Th>Projekt</Th>
                <Th>Klient</Th>
                <Th className="text-right">Osób</Th>
                <Th className="text-right">Wpisów</Th>
                <Th className="text-right">Czas</Th>
                <Th className="w-1/3">Udział</Th>
              </tr>
            </thead>
            <tbody>
              {byProject.map((p) => (
                <tr key={p.id} className="border-b border-gray-100">
                  <Td>
                    <span className="flex items-center">
                      <span className={`w-2.5 h-2.5 rounded-full mr-2 shrink-0 ${projectColor(p.color).dot}`} />
                      {p.name}
                    </span>
                  </Td>
                  <Td className="text-gray-600">{p.client || "—"}</Td>
                  <Td className="text-right tabular-nums">{p.people}</Td>
                  <Td className="text-right tabular-nums">{p.entries}</Td>
                  <Td className="text-right tabular-nums font-medium whitespace-nowrap">
                    {formatDuration(p.seconds)}
                  </Td>
                  <Td>
                    {/* Pasek proporcjonalny zamiast biblioteki wykresów —
                        czytelny, a nie dokłada nic do bundla. */}
                    <span className="flex items-center gap-2">
                      <span className="flex-grow bg-gray-200 rounded h-2 overflow-hidden">
                        <span
                          className={`block h-2 ${projectColor(p.color).bar}`}
                          style={{ width: `${Math.max(2, (p.seconds / maxSeconds) * 100)}%` }}
                        />
                      </span>
                      <span className="text-xs text-gray-600 tabular-nums w-10 text-right">
                        {Math.round((p.seconds / summary.seconds) * 100)}%
                      </span>
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <h2 className="font-bold mb-1">Wg pracowników</h2>
        <p className="text-xs text-gray-600 mb-2">
          „Obecność” pochodzi z kart czasu pracy (odbicia na kiosku), „Zaraportowano” z wpisów zadań. To dwie
          niezależne ewidencje — różnica jest wskazówką, gdzie brakuje raportowania, a nie podstawą rozliczeń.
        </p>
        {byUser.length === 0 ? (
          <p className="text-sm text-gray-500 mb-8">Brak wpisów w tym zakresie.</p>
        ) : (
          <table className="w-full mb-8 text-sm">
            <thead>
              <tr className="text-left border-b border-gray-300">
                <Th>Pracownik</Th>
                <Th>Sekcja</Th>
                <Th className="text-right">Obecność</Th>
                <Th className="text-right">Zaraportowano</Th>
                <Th className="text-right">Różnica</Th>
                <Th className="text-right">Pokrycie</Th>
              </tr>
            </thead>
            <tbody>
              {byUser.map((u) => (
                <tr key={u.id} className="border-b border-gray-100">
                  <Td>
                    {u.surname} {u.name}
                  </Td>
                  <Td className="text-gray-600">{u.section}</Td>
                  <Td className="text-right tabular-nums whitespace-nowrap">
                    {u.present ? formatDuration(u.present) : "—"}
                  </Td>
                  <Td className="text-right tabular-nums font-medium whitespace-nowrap">
                    {formatDuration(u.reported)}
                  </Td>
                  <Td
                    className={classNames(
                      "text-right tabular-nums whitespace-nowrap",
                      u.present === 0 ? "text-gray-400" : u.diff < 0 ? "text-red-600" : "text-emerald-700"
                    )}
                  >
                    {u.present === 0 ? "—" : formatDuration(u.diff, { withSign: true })}
                  </Td>
                  <Td className="text-right tabular-nums">{u.coverage === null ? "—" : `${u.coverage}%`}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="flex items-baseline justify-between mb-2 flex-wrap gap-2">
          <h2 className="font-bold">Wpisy</h2>
          {canExport && (
            <span className="flex gap-2">
              <ExportButton onClick={() => download("wpisy")}>CSV: wpisy</ExportButton>
              <ExportButton onClick={() => download("projekty")}>CSV: wg projektów</ExportButton>
              <ExportButton onClick={() => download("porownanie")}>CSV: porównanie</ExportButton>
            </span>
          )}
        </div>

        <p className="text-xs text-gray-600 mb-2">
          Ołówek otwiera wpis do poprawki — projekt, opis, data i godziny. Okno „dziś i wczoraj”, które
          obowiązuje pracownika, kierownika nie dotyczy: poprawisz wpis z dowolnego okresu, także swój
          własny. Przy cudzym wpisie zostaje twoje nazwisko jako „popr.”.
        </p>

        {detail.total > detail.limit && (
          <p className="mb-2 p-2 bg-amber-50 border border-amber-300 rounded text-sm">
            Pokazano {detail.limit} z {detail.total} wpisów. Zawęź filtry albo pobierz CSV — eksport obejmuje
            komplet.
          </p>
        )}

        {err && (
          <p className="mb-2 p-2 bg-red-50 border border-red-300 text-red-700 text-sm rounded">{err}</p>
        )}

        {detail.rows.length === 0 ? (
          <p className="text-sm text-gray-500">Brak wpisów w tym zakresie.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b border-gray-300">
                <Th>Data</Th>
                <Th>Pracownik</Th>
                <Th>Projekt</Th>
                <Th>Zadanie</Th>
                <Th className="text-right">Godziny</Th>
                <Th className="text-right">Czas</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {detail.rows.map((r) =>
                r.id === editingID ? (
                  <EntryEditor
                    key={r.id}
                    entry={r}
                    projects={projectsBySection[r.userSection] ?? []}
                    busy={busy}
                    onCancel={() => {
                      setEditingID(null);
                      setErr("");
                    }}
                    onSave={(body) => saveEntry(r.id, body).then((ok) => ok && setEditingID(null))}
                  />
                ) : (
                  <EntryRow
                    key={r.id}
                    entry={r}
                    busy={busy}
                    onEdit={() => {
                      setEditingID(r.id);
                      setErr("");
                    }}
                  />
                )
              )}
            </tbody>
          </table>
        )}
      </section>
    </BaseLayout>
  );
}

// --- wiersz wpisu -----------------------------------------------------------

// Rok w dacie jest tu potrzebny, inaczej niż na stronie pracownika: raport
// filtruje po nazwie zadania „nieważne z jakiego okresu”, więc w jednej tabeli
// potrafią wylądować wpisy z dwóch lat i samo „14.08” nic nie rozstrzyga.
const dayLabel = (data) => dayjs(data).format("DD.MM.YY");

const EntryRow = ({ entry, busy, onEdit }) => (
  <tr className={classNames("border-b border-gray-100", entry.autoClosed && "bg-amber-50")}>
    <Td className="whitespace-nowrap">{dayLabel(entry.data)}</Td>
    <Td className="whitespace-nowrap">
      {entry.surname} {entry.name}
    </Td>
    <Td>
      <span className="flex items-center">
        <span className={`w-2 h-2 rounded-full mr-2 shrink-0 ${projectColor(entry.projectColor).dot}`} />
        {entry.projectName}
      </span>
    </Td>
    <Td>
      {entry.description || <span className="text-gray-400">(bez opisu)</span>}
      {entry.autoClosed && <span className="ml-2 text-xs text-amber-800">auto</span>}
      {entry.editedByName && <span className="ml-2 text-xs text-gray-500">popr. {entry.editedByName}</span>}
    </Td>
    <Td
      className="text-right tabular-nums whitespace-nowrap text-gray-600"
      title={`${timePart(entry.startedAt)}–${timePart(entry.endedAt)}`}
    >
      {hhmm(entry.startedAt)}–{hhmm(entry.endedAt)}
    </Td>
    <Td className="text-right tabular-nums font-medium whitespace-nowrap">{formatDuration(entry.seconds)}</Td>
    <Td className="text-right">
      <button
        disabled={busy}
        title="Popraw wpis"
        onClick={onEdit}
        className="py-1 px-2 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-30"
      >
        ✎
      </button>
    </Td>
  </tr>
);

/**
 * Lista projektów do wyboru przy poprawianiu wpisu.
 *
 * Do aktywnych projektów sekcji pracownika dokładamy ten, na którym wpis już
 * wisi — bywa archiwalny albo z sekcji, w której pracownik dziś nie pracuje.
 * Bez tego <select> nie znalazłby swojej wartości, wskazałby pierwszą pozycję
 * z brzegu i zapis po cichu przeniósłby cudzą pracę na inny projekt.
 */
const projectOptions = (available, entry) =>
  available.some((p) => p.id === entry.projectID)
    ? available
    : [
        { id: entry.projectID, name: entry.projectName, isActive: entry.projectIsActive },
        ...available,
      ];

const EntryEditor = ({ entry, projects, busy, onCancel, onSave }) => {
  const [form, setForm] = useState({
    projectID: entry.projectID,
    description: entry.description,
    data: entry.data,
    from: hhmm(entry.startedAt),
    to: hhmm(entry.endedAt),
  });

  const options = useMemo(() => projectOptions(projects, entry), [projects, entry]);

  const submit = (e) => {
    e.preventDefault();
    // Nietknięte godziny lecą z oryginalnymi sekundami — patrz keepSeconds.
    onSave({
      ...form,
      from: keepSeconds(form.from, entry.startedAt),
      to: keepSeconds(form.to, entry.endedAt),
    });
  };

  return (
    <tr className="border-b border-gray-300 bg-indigo-50">
      {/* Formularz przez całą szerokość wiersza, a nie pole w każdej komórce:
          sześć wąskich kolumn nie pomieściłoby ani selecta z nazwą projektu,
          ani opisu, a na telefonie rozjechałoby tabelę. */}
      <td colSpan={7} className="py-3">
        <form onSubmit={submit}>
          <p className="mb-2 text-xs text-gray-600">
            {entry.surname} {entry.name} · wpis z {dayjs(entry.data).format("D MMMM YYYY")}
          </p>

          <div className="flex gap-2 flex-col sm:flex-row mb-2">
            <select
              value={form.projectID}
              onChange={(e) => setForm({ ...form, projectID: Number(e.target.value) })}
              className="p-2 border border-gray-400 rounded sm:w-56 shrink-0 bg-white"
            >
              {options.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.isActive ? "" : " (archiwalny)"}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={form.description}
              maxLength={200}
              placeholder="Opis zadania"
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="flex-grow min-w-0 p-2 border border-gray-400 rounded"
            />
          </div>

          <div className="flex gap-2 items-end flex-wrap">
            {/* Bez min/max: kierownik poprawia wpisy z dowolnego okresu. */}
            <Field label="Data">
              <input
                type="date"
                value={form.data}
                onChange={(e) => setForm({ ...form, data: e.target.value })}
                className="p-2 border border-gray-400 rounded"
                required
              />
            </Field>
            <Field label="Od">
              <input
                type="time"
                value={form.from}
                onChange={(e) => setForm({ ...form, from: e.target.value })}
                className="p-2 border border-gray-400 rounded"
                required
              />
            </Field>
            <Field label="Do">
              <input
                type="time"
                value={form.to}
                onChange={(e) => setForm({ ...form, to: e.target.value })}
                className="p-2 border border-gray-400 rounded"
                required
              />
            </Field>

            <span className="flex gap-2 ml-auto">
              <button
                type="submit"
                disabled={busy}
                className="text-white bg-indigo-500 hover:bg-indigo-600 py-2 px-5 rounded disabled:opacity-50"
              >
                Zapisz
              </button>
              <button type="button" onClick={onCancel} className="py-2 px-3 text-gray-600">
                Anuluj
              </button>
            </span>
          </div>
        </form>
      </td>
    </tr>
  );
};

const Field = ({ label, children }) => (
  <label className="flex flex-col">
    <span className="mb-1 text-xs font-medium text-gray-700">{label}</span>
    {children}
  </label>
);

const Kpi = ({ label, value, warn, hint }) => (
  <div className={classNames("p-3 rounded border", warn ? "bg-amber-50 border-amber-300" : "border-gray-300")}>
    <p className="text-xs text-gray-600">{label}</p>
    <p className="text-xl font-bold tabular-nums">{value}</p>
    {hint && <p className="text-xs text-amber-800">{hint}</p>}
  </div>
);

const Th = ({ children, className }) => <th className={classNames("py-2 pr-3 font-medium", className)}>{children}</th>;
const Td = ({ children, className, title }) => (
  <td className={classNames("py-2 pr-3", className)} title={title}>
    {children}
  </td>
);

const ExportButton = ({ onClick, children }) => (
  <button onClick={onClick} className="text-sm py-1.5 px-3 border border-gray-400 rounded hover:bg-gray-50">
    {children}
  </button>
);
