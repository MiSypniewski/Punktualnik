import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/router";
import { getToken } from "next-auth/jwt";
import classNames from "classnames";
import dayjs from "dayjs";
import "dayjs/locale/pl";
import BaseLayout from "../../components/baseLayout";
import LiveBoard from "../../components/liveBoard";
import { projectColor, ProjectMark } from "../../components/projectColors";
import Button, { IconButton } from "../../components/ui/button";
import { Input, Select } from "../../components/ui/field";
import Plate from "../../components/ui/plate";
import Alert from "../../components/ui/alert";
import Stat from "../../components/ui/stat";
import PageHeader from "../../components/ui/pageHeader";
import EmptyState from "../../components/ui/emptyState";
import { TableWrap, Table as UiTable, Th as UiTh, Td as UiTd } from "../../components/ui/table";
import { PencilIcon, DownloadIcon } from "../../components/ui/icons";
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

// Wpis, który wystartował bez projektu i nikt go jeszcze nie przypisał. Panel
// kierownika jest miejscem, w którym takie wpisy da się posprzątać — poprawka
// wymusza wybór projektu, bo zamknięty wpis musi go mieć.
const NO_PROJECT = "(bez projektu)";

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
        <section>
          <PageHeader title="Raport zadań" />
          <Alert tone="warn">
            Nie masz przypisanej żadnej sekcji, więc nie widzisz niczyich danych. Przypisanie nadaje się
            komendą <code className="font-mono">npm run admin -- sections &lt;e-mail&gt; &lt;sekcje&gt;</code>.
          </Alert>
        </section>
      </BaseLayout>
    );
  }

  return (
    <BaseLayout>
      <section>
        <PageHeader
          title="Raport zadań"
          description="Czas zaraportowany przez pracowników twoich sekcji. Stan bieżący jest u góry, reszta idzie za filtrami."
        />

        <LiveBoard initial={live} currentUserID={currentUserID} />

        <form onSubmit={apply} className="mb-6 p-3 border border-line rounded bg-raised">
          {/* Na telefonie każde pole zajmuje całą szerokość i idzie w osobnym
              rzędzie: przy flex-wrap z siedmioma polami selecty z długimi nazwami
              projektów ucinały tekst na krawędzi ekranu. Od `sm` układ jest ten
              sam co dotąd — pola jedno za drugim, zawijane. */}
          <div className="flex gap-3 flex-col sm:flex-row sm:flex-wrap sm:items-end">
            <Field label="Od">
              <Input
                type="date"
                value={form.from}
                onChange={(e) => setForm({ ...form, from: e.target.value })}
                className="w-full sm:w-auto"
              />
            </Field>
            <Field label="Do">
              <Input
                type="date"
                value={form.to}
                onChange={(e) => setForm({ ...form, to: e.target.value })}
                className="w-full sm:w-auto"
              />
            </Field>
            <Field label="Projekt">
              <Select
                value={form.projectID}
                onChange={(e) => setForm({ ...form, projectID: e.target.value })}
                className="w-full sm:w-auto"
              >
                <option value="">— wszystkie —</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.isActive ? "" : " (archiwalny)"}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Pracownik">
              <Select
                value={form.userID}
                onChange={(e) => setForm({ ...form, userID: e.target.value })}
                className="w-full sm:w-auto"
              >
                <option value="">— wszyscy —</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.surname} {u.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Zadanie">
              {/* Fragment opisu, wielkość liter bez znaczenia (także dla polskich
                  znaków — porównanie robi plContains w services/entryStats.js). */}
              <Input
                type="search"
                value={form.q}
                maxLength={TASK_QUERY_MAX}
                placeholder="fragment opisu"
                onChange={(e) => setForm({ ...form, q: e.target.value })}
                className="w-full sm:w-48"
              />
            </Field>
            <Field label="Wpisy dłuższe niż">
              <Select
                value={form.minMinutes}
                onChange={(e) => setForm({ ...form, minMinutes: e.target.value })}
                className="w-full sm:w-auto"
              >
                <option value="">— bez progu —</option>
                <option value="15">15 min</option>
                <option value="30">30 min</option>
                <option value="60">1 h</option>
                <option value="240">4 h</option>
              </Select>
            </Field>

            {/* Oba przyciski w jednym rzędzie także na telefonie — "Wyczyść" pod
                "Pokaż" wyglądałoby jak trzecie pole formularza. */}
            <span className="flex gap-2 w-full sm:w-auto">
              <button
                type="submit"
                className="flex-grow sm:flex-grow-0 inline-flex items-center justify-center rounded font-medium bg-accent text-accent-ink hover:bg-accent/90 py-2 px-6 text-sm"
              >
                Pokaż
              </button>
              <button
                type="button"
                onClick={() => router.push("/zadania/zarzadzaj")}
                className="py-2 px-4 text-sm rounded border border-line-strong bg-surface hover:bg-raised"
              >
                Wyczyść
              </button>
            </span>
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

        <h2 className="mb-2 text-sm font-bold uppercase tracking-signage">Wg projektów</h2>
        {byProject.length === 0 ? (
          <p className="mb-8 text-sm text-muted">Brak wpisów w tym zakresie.</p>
        ) : (
          // Sześć kolumn z liczbami nie zmieści się na telefonie, a bez tego
          // kontenera tabela rozpychała cały dokument szerzej niż ekran i strona
          // przewijała się w poziomie (wzorzec z pages/nadgodziny/zarzadzaj.js).
          // min-w jest konieczne: w samym overflow-x-auto tabela `w-full` zwęża się
          // do kontenera i ściska nazwy projektów zamiast pozwolić się przewinąć.
          <TableWrap className="mb-8">
          <UiTable className="min-w-[32rem]">
            <thead>
              <tr>
                <Th>Projekt</Th>
                <Th>Klient</Th>
                <Th align="right">Osób</Th>
                <Th align="right">Wpisów</Th>
                <Th align="right">Czas</Th>
                <Th className="w-1/3">Udział</Th>
              </tr>
            </thead>
            <tbody>
              {byProject.map((p) => (
                // Wiersz bez id to zbiorczy "(bez projektu)" z LEFT JOIN-a
                // w services/entryStats.js — klucz Reacta musi go przeżyć.
                <tr key={p.id ?? "none"} className="border-b border-line-subtle">
                  <Td>
                    <span className="flex items-center">
                      <ProjectMark color={p.color} className="mr-2" />
                      {p.name || NO_PROJECT}
                    </span>
                  </Td>
                  <Td className="text-muted">{p.client || "—"}</Td>
                  <Td className="font-mono text-right tabular-nums">{p.people}</Td>
                  <Td className="font-mono text-right tabular-nums">{p.entries}</Td>
                  <Td className="font-mono text-right tabular-nums font-medium whitespace-nowrap">
                    {formatDuration(p.seconds)}
                  </Td>
                  <Td>
                    {/* Pasek proporcjonalny zamiast biblioteki wykresów —
                        czytelny, a nie dokłada nic do bundla. */}
                    <span className="flex items-center gap-2">
                      <span className="flex-grow bg-raised rounded h-2 overflow-hidden">
                        <span
                          className={`block h-2 ${projectColor(p.color).bar}`}
                          style={{ width: `${Math.max(2, (p.seconds / maxSeconds) * 100)}%` }}
                        />
                      </span>
                      <span className="font-mono text-xs text-muted tabular-nums w-10 text-right">
                        {Math.round((p.seconds / summary.seconds) * 100)}%
                      </span>
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </UiTable>
          </TableWrap>
        )}

        <h2 className="mb-1 text-sm font-bold uppercase tracking-signage">Wg pracowników</h2>
        <p className="text-xs text-muted mb-2">
          „Obecność” pochodzi z kart czasu pracy (odbicia na kiosku), „Zaraportowano” z wpisów zadań. To dwie
          niezależne ewidencje — różnica jest wskazówką, gdzie brakuje raportowania, a nie podstawą rozliczeń.
        </p>
        {byUser.length === 0 ? (
          <p className="mb-8 text-sm text-muted">Brak wpisów w tym zakresie.</p>
        ) : (
          <TableWrap className="mb-8">
          <UiTable className="min-w-[34rem]">
            <thead>
              <tr>
                <Th>Pracownik</Th>
                <Th>Sekcja</Th>
                <Th align="right">Obecność</Th>
                <Th align="right">Zaraportowano</Th>
                <Th align="right">Różnica</Th>
                <Th align="right">Pokrycie</Th>
              </tr>
            </thead>
            <tbody>
              {byUser.map((u) => (
                <tr key={u.id} className="border-b border-line-subtle">
                  <Td>
                    {u.surname} {u.name}
                  </Td>
                  <Td className="text-muted">{u.section}</Td>
                  <Td className="font-mono text-right tabular-nums whitespace-nowrap">
                    {u.present ? formatDuration(u.present) : "—"}
                  </Td>
                  <Td className="font-mono text-right tabular-nums font-medium whitespace-nowrap">
                    {formatDuration(u.reported)}
                  </Td>
                  <Td
                    className={classNames(
                      "text-right tabular-nums whitespace-nowrap",
                      u.present === 0 ? "text-faint" : u.diff < 0 ? "text-danger-strong" : "text-ok-strong"
                    )}
                  >
                    {u.present === 0 ? "—" : formatDuration(u.diff, { withSign: true })}
                  </Td>
                  <Td className="font-mono text-right tabular-nums">{u.coverage === null ? "—" : `${u.coverage}%`}</Td>
                </tr>
              ))}
            </tbody>
          </UiTable>
          </TableWrap>
        )}

        <div className="flex items-baseline justify-between mb-2 flex-wrap gap-2">
          <h2 className="text-sm font-bold uppercase tracking-signage">Wpisy</h2>
          {canExport && (
            <span className="flex gap-2 flex-wrap">
              <ExportButton onClick={() => download("wpisy")}>CSV: wpisy</ExportButton>
              <ExportButton onClick={() => download("projekty")}>CSV: wg projektów</ExportButton>
              <ExportButton onClick={() => download("porownanie")}>CSV: porównanie</ExportButton>
            </span>
          )}
        </div>

        <p className="text-xs text-muted mb-2">
          Ołówek otwiera wpis do poprawki — projekt, opis, data i godziny. Okno „dziś i wczoraj”, które
          obowiązuje pracownika, kierownika nie dotyczy: poprawisz wpis z dowolnego okresu, także swój
          własny. Przy cudzym wpisie zostaje twoje nazwisko jako „popr.”.
        </p>

        {detail.total > detail.limit && (
          <Alert tone="warn" className="mb-2">
            Pokazano {detail.limit} z {detail.total} wpisów. Zawęź filtry albo pobierz CSV — eksport obejmuje
            komplet.
          </Alert>
        )}

        {err && (
          <Alert tone="danger" className="mb-2">{err}</Alert>
        )}

        {detail.rows.length === 0 ? (
          <EmptyState
            title="Brak wpisów"
            description="W tym zakresie nikt nie zaraportował czasu. Poszerz zakres dat albo zdejmij filtry."
          />
        ) : (
          <>
            {/* Siedem kolumn na telefonie nie ma szans — nawet przewijana w poziomie
                tabela zmuszałaby do wodzenia palcem przy każdym wierszu. Poniżej `sm`
                te same dane idą więc kartami, jak lista wpisów na /zadania. Oba układy
                dzielą stan (editingID, saveEntry) i formularz (EntryForm). */}
            <UiTable className="hidden sm:table">
              <thead>
                <tr>
                  <Th>Data</Th>
                  <Th>Pracownik</Th>
                  <Th>Projekt</Th>
                  <Th>Zadanie</Th>
                  <Th align="right">Godziny</Th>
                  <Th align="right">Czas</Th>
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
            </UiTable>

            <ul className="sm:hidden flex flex-col gap-2">
              {detail.rows.map((r) => (
                <EntryCard
                  key={r.id}
                  entry={r}
                  projects={projectsBySection[r.userSection] ?? []}
                  busy={busy}
                  editing={r.id === editingID}
                  onEdit={() => {
                    setEditingID(r.id);
                    setErr("");
                  }}
                  onCancel={() => {
                    setEditingID(null);
                    setErr("");
                  }}
                  onSave={(body) => saveEntry(r.id, body).then((ok) => ok && setEditingID(null))}
                />
              ))}
            </ul>
          </>
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
  <tr className={classNames("border-b border-line-subtle", entry.autoClosed && "bg-signal-soft")}>
    <Td className="whitespace-nowrap">{dayLabel(entry.data)}</Td>
    <Td className="whitespace-nowrap">
      {entry.surname} {entry.name}
    </Td>
    <Td>
      <span className="flex items-center">
        <ProjectMark color={entry.projectColor} size="sm" className="mr-2" />
        {entry.projectName || NO_PROJECT}
      </span>
    </Td>
    <Td>
      {entry.description || <span className="text-faint">(bez opisu)</span>}
      {entry.autoClosed && <span className="ml-2 text-xs font-semibold uppercase tracking-signage text-signal-strong">auto</span>}
      {entry.editedByName && <span className="ml-2 text-xs text-muted">popr. {entry.editedByName}</span>}
    </Td>
    <Td
      className="font-mono text-right tabular-nums whitespace-nowrap text-muted"
      title={`${timePart(entry.startedAt)}–${timePart(entry.endedAt)}`}
    >
      {hhmm(entry.startedAt)}–{hhmm(entry.endedAt)}
    </Td>
    <Td className="font-mono text-right tabular-nums font-medium whitespace-nowrap">{formatDuration(entry.seconds)}</Td>
    <Td className="text-right">
      <PencilButton busy={busy} onClick={onEdit} />
    </Td>
  </tr>
);

const PencilButton = ({ busy, onClick }) => (
  <button
    disabled={busy}
    title="Popraw wpis"
    onClick={onClick}
    className="py-1 px-2 border border-line rounded hover:bg-raised disabled:opacity-40"
  >
    ✎
  </button>
);

/**
 * Ten sam wpis na telefonie: cztery krótkie rzędy zamiast siedmiu kolumn.
 *
 * Kolejność jest inna niż w tabeli i to jest celowe. W tabeli oko jedzie po
 * kolumnach, więc data jest pierwsza; tutaj czyta się kartę z góry na dół i pierwsze
 * pytanie brzmi "co to za praca", a nie "z którego dnia". Data i wymiar stoją
 * z prawej, gdzie wzrok wraca po nazwisku.
 */
const EntryCard = ({ entry, projects, busy, editing, onEdit, onCancel, onSave }) => {
  if (editing) {
    return (
      <li className="p-3 border border-line rounded bg-accent-soft">
        <EntryForm entry={entry} projects={projects} busy={busy} onCancel={onCancel} onSave={onSave} />
      </li>
    );
  }

  return (
    <li
      className={classNames(
        "p-3 border border-line rounded",
        entry.autoClosed && "bg-signal-soft border-signal/40"
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="flex items-baseline min-w-0">
          <ProjectMark color={entry.projectColor} className="mr-2" />
          <span className="text-sm text-muted truncate">{entry.projectName || NO_PROJECT}</span>
        </span>
        <span className="font-mono text-sm text-muted tabular-nums whitespace-nowrap">{dayLabel(entry.data)}</span>
      </div>

      <p className="mt-1 font-medium break-words">
        {entry.description || <span className="text-faint">(bez opisu)</span>}
        {entry.autoClosed && <span className="ml-2 text-xs font-semibold uppercase tracking-signage text-signal-strong">auto</span>}
      </p>

      <p className="text-sm text-body">
        {entry.surname} {entry.name}
        {entry.editedByName && <span className="ml-2 text-xs text-muted">popr. {entry.editedByName}</span>}
      </p>

      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="font-mono text-sm text-muted tabular-nums" title={`${timePart(entry.startedAt)}–${timePart(entry.endedAt)}`}>
          {hhmm(entry.startedAt)}–{hhmm(entry.endedAt)}
        </span>
        <span className="flex items-center gap-2">
          <span className="font-mono text-sm font-medium tabular-nums">{formatDuration(entry.seconds)}</span>
          <PencilButton busy={busy} onClick={onEdit} />
        </span>
      </div>
    </li>
  );
};

/**
 * Lista projektów do wyboru przy poprawianiu wpisu.
 *
 * Do aktywnych projektów sekcji pracownika dokładamy ten, na którym wpis już
 * wisi — bywa archiwalny albo z sekcji, w której pracownik dziś nie pracuje.
 * Bez tego <select> nie znalazłby swojej wartości, wskazałby pierwszą pozycję
 * z brzegu i zapis po cichu przeniósłby cudzą pracę na inny projekt.
 */
const projectOptions = (available, entry) =>
  // Wpis bez projektu nie ma czego dokładać do listy — dostaje pustą pozycję
  // w samym <select> i musi zostać przypisany, żeby dało się go zapisać.
  !entry.projectID || available.some((p) => p.id === entry.projectID)
    ? available
    : [
        { id: entry.projectID, name: entry.projectName, isActive: entry.projectIsActive },
        ...available,
      ];

/**
 * Wpis otwarty do poprawki w tabeli. Sam formularz siedzi w EntryForm, bo ten sam
 * służy karcie na telefonie — obwoluta różni się wyłącznie tym, w co go opakować.
 */
const EntryEditor = ({ entry, projects, busy, onCancel, onSave }) => (
  <tr className="border-b border-line bg-accent-soft">
    {/* Formularz przez całą szerokość wiersza, a nie pole w każdej komórce:
        sześć wąskich kolumn nie pomieściłoby ani selecta z nazwą projektu,
        ani opisu. */}
    <td colSpan={7} className="py-3">
      <EntryForm entry={entry} projects={projects} busy={busy} onCancel={onCancel} onSave={onSave} />
    </td>
  </tr>
);

const EntryForm = ({ entry, projects, busy, onCancel, onSave }) => {
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
    <form onSubmit={submit}>
      <p className="mb-2 text-xs text-muted">
        {entry.surname} {entry.name} · wpis z {dayjs(entry.data).format("D MMMM YYYY")}
      </p>

      <div className="flex gap-2 flex-col sm:flex-row mb-2">
        <Select
          value={form.projectID ?? ""}
          required
          onChange={(e) =>
            setForm({ ...form, projectID: e.target.value ? Number(e.target.value) : "" })
          }
          className="sm:w-56 shrink-0"
        >
          <option value="">— wybierz projekt —</option>
          {options.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.isActive ? "" : " (archiwalny)"}
            </option>
          ))}
        </Select>
        <Input
          type="text"
          value={form.description}
          maxLength={200}
          placeholder="Opis zadania"
          required
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          className="flex-grow w-auto min-w-0"
        />
      </div>

      <div className="flex gap-2 items-end flex-wrap">
        {/* Bez min/max: kierownik poprawia wpisy z dowolnego okresu. */}
        <Field label="Data">
          <Input
            type="date"
            value={form.data}
            onChange={(e) => setForm({ ...form, data: e.target.value })}
            className="w-full sm:w-auto"
            required
          />
        </Field>
        {/* Od i Do obok siebie także na telefonie — to jedna informacja, zakres. */}
        <span className="flex gap-2 w-full sm:w-auto">
          <Field label="Od">
            <Input
              type="time"
              value={form.from}
              onChange={(e) => setForm({ ...form, from: e.target.value })}
              className="w-full sm:w-auto"
              required
            />
          </Field>
          <Field label="Do">
            <Input
              type="time"
              value={form.to}
              onChange={(e) => setForm({ ...form, to: e.target.value })}
              className="w-full sm:w-auto"
              required
            />
          </Field>
        </span>

        <span className="flex gap-2 w-full sm:w-auto sm:ml-auto">
          <button
            type="submit"
            disabled={busy}
            className="flex-grow sm:flex-grow-0 inline-flex items-center justify-center rounded font-medium bg-accent text-accent-ink hover:bg-accent/90 py-2 px-5 text-sm disabled:opacity-50"
          >
            Zapisz
          </button>
          <Button variant="ghost" onClick={onCancel}>
            Anuluj
          </Button>
        </span>
      </div>
    </form>
  );
};

// w-full na telefonie, bo pola stoją tam jedno pod drugim (patrz komentarz
// w formularzu filtrów); od `sm` etykieta zwęża się do swojej zawartości.
const Field = ({ label, children }) => (
  <label className="flex flex-col w-full sm:w-auto">
    <span className="mb-1 text-xs font-semibold uppercase tracking-signage text-muted">{label}</span>
    {children}
  </label>
);

const Kpi = ({ label, value, warn, hint }) => (
  <Stat label={label} value={value} hint={hint} tone={warn ? "signal" : "default"} />
);

// Cienkie opakowania na wspólne komórki: zostają, bo strona woła je w kilkunastu
// miejscach, a `align` czyta się w tabeli lepiej niż klasa.
const Th = UiTh;
const Td = UiTd;

const ExportButton = ({ onClick, children }) => (
  <Button variant="secondary" size="sm" onClick={onClick}>
    <DownloadIcon />
    {children}
  </Button>
);
