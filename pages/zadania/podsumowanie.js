import { useState } from "react";
import { useRouter } from "next/router";
import { getToken } from "next-auth/jwt";
import useSWR from "swr";
import dayjs from "dayjs";
import "dayjs/locale/pl";
import BaseLayout from "../../components/baseLayout";
import { projectColor, ProjectMark } from "../../components/projectColors";
import Button, { IconButton } from "../../components/ui/button";
import { Input } from "../../components/ui/field";
import Plate, { PlateHeader } from "../../components/ui/plate";
import Alert from "../../components/ui/alert";
import Stat from "../../components/ui/stat";
import PageHeader from "../../components/ui/pageHeader";
import EmptyState from "../../components/ui/emptyState";
import { ChevronLeftIcon, ChevronRightIcon } from "../../components/ui/icons";
import { getMonth, lastClosedMonth } from "../../services/monthlyReport";
import { listSections } from "../../services/sections";
import { canSeeMonthlyReports } from "../../services/roles";
import { visibleSections } from "../../services/scope";
import { absenceKindShort } from "../../services/absenceKinds";
import { formatMinutes, jsonFetcher } from "../../utils";
import { MONTH_RE } from "../../utils/monthlyReport";

dayjs.locale("pl");

const NO_PROJECT = "(bez projektu)";

const apiKey = (month) => `/api/report/miesieczny?miesiac=${month}`;

export async function getServerSideProps(ctx) {
  const token = await getToken({ req: ctx.req });

  if (!token) {
    return { redirect: { destination: "/users/signin", permanent: false } };
  }
  if (!canSeeMonthlyReports(token.role)) {
    return { notFound: true };
  }

  // Ostatni zamknięty miesiąc liczy SERWER (doba robocza, strefa aplikacji) —
  // przeglądarka 1. dnia o 1:00 w nocy uznałaby, że miesiąc już się skończył.
  const lastClosed = lastClosedMonth();
  const { miesiac } = ctx.query;
  const month = MONTH_RE.test(miesiac || "") && miesiac <= lastClosed ? miesiac : lastClosed;

  const labels = Object.fromEntries(listSections({ includeInactive: true }).map((s) => [s.slug, s.label]));

  return {
    props: {
      month,
      lastClosed,
      labels,
      initial: { month, people: getMonth(month, visibleSections(token)) },
    },
  };
}

// Średnie pokazujemy w minutach, nie w sekundach: to iloraz z całego miesiąca
// i "6h 41min 07s" udawałoby dokładność, której ta liczba nie ma.
const hm = (seconds, opts) => formatMinutes(Math.round((seconds || 0) / 60), opts);

const absenceHint = (byKind) =>
  Object.entries(byKind)
    .map(([kind, days]) => `${absenceKindShort(kind)} ${days}`)
    .join(" · ");

const projectLabel = (p) => (p.id === "rest" ? `pozostałe (${p.rest})` : p.name || NO_PROJECT);

const Projects = ({ projects }) => {
  if (projects.length === 0) {
    return <p className="text-sm text-muted">Brak zaraportowanego czasu w tym miesiącu.</p>;
  }

  return (
    <ul className="space-y-1.5">
      {projects.map((p) => (
        <li key={String(p.id)} className="grid grid-cols-[minmax(0,1fr)_5.5rem_2.5rem] sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_5.5rem_2.5rem] items-center gap-x-3 text-sm">
          <span className="flex items-center gap-2 min-w-0">
            <ProjectMark color={p.id === "rest" ? "slate" : p.color} />
            <span className="truncate">{projectLabel(p)}</span>
          </span>
          {/* Pasek proporcjonalny do UDZIAŁU, nie do największego projektu —
              długość ma się zgadzać z procentem stojącym obok. */}
          <span className="hidden sm:block bg-raised rounded h-2 overflow-hidden">
            <span
              className={`block h-2 ${p.id === "rest" ? "bg-line-strong" : projectColor(p.color).bar}`}
              style={{ width: `${Math.max(2, p.share ?? 0)}%` }}
            />
          </span>
          <span className="font-mono tabular-nums text-right whitespace-nowrap">{hm(p.seconds)}</span>
          <span className="font-mono tabular-nums text-right text-xs text-muted">{p.share ?? 0}%</span>
        </li>
      ))}
    </ul>
  );
};

const Person = ({ person }) => {
  const { team } = person;
  const hasAvg = person.avgDailySeconds !== null;
  const diff = hasAvg && team.avgDailySeconds !== null ? person.avgDailySeconds - team.avgDailySeconds : null;

  const avgHint = [
    team.avgDailySeconds !== null && `zespół ${hm(team.avgDailySeconds)}`,
    diff !== null && `różnica ${hm(diff, { withSign: true })}`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section className="px-3 py-4 border-b border-line-subtle last:border-b-0">
      <h3 className="font-semibold">
        {person.surname} {person.name}
      </h3>

      <div className="mt-2 grid grid-cols-2 lg:grid-cols-4 gap-2">
        <Stat
          label="Dni przepracowane"
          value={`${person.workedDays} / ${person.workingDays}`}
          hint={person.attendance !== null ? `frekwencja ${person.attendance}%` : undefined}
        />
        <Stat
          label="Nieobecności"
          value={person.absenceDays}
          hint={person.absenceDays > 0 ? absenceHint(person.absenceByKind) : "brak zatwierdzonych"}
        />
        <Stat
          label="Dni bez ewidencji"
          value={person.gapDays}
          tone={person.gapDays > 0 ? "signal" : "default"}
          hint="bez karty i bez nieobecności"
        />
        <Stat label="Średnia dzienna" value={hasAvg ? hm(person.avgDailySeconds) : "—"} hint={avgHint || undefined} />
      </div>

      <div className="mt-3">
        <Projects projects={person.projects} />
      </div>

      {person.off.days > 0 && (
        <p className="mt-2 text-xs text-muted">
          Poza dniami roboczymi: {hm(person.off.seconds)} w {person.off.days}{" "}
          {person.off.days === 1 ? "dniu" : "dniach"} — poza średnią dzienną.
        </p>
      )}
    </section>
  );
};

const signature = (people) => {
  // Sekcje kierownika powstają razem, ale przeliczyć mógł je każdy z osobna —
  // podpis bierzemy z najświeższego wiersza sekcji.
  const latest = people.reduce((a, b) => (b.generatedAt > a.generatedAt ? b : a));
  return `${latest.generatedAt.slice(0, 16)} · ${latest.generatedByName || "automat"}`;
};

export default function MonthlySummary({ month, lastClosed, labels, initial }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const { data, mutate } = useSWR(apiKey(month), jsonFetcher, { fallbackData: initial });
  const people = data?.people ?? [];

  const go = (next) => {
    if (!MONTH_RE.test(next) || next > lastClosed) return;
    setErr("");
    const query = next === lastClosed ? {} : { miesiac: next };
    router.push({ pathname: router.pathname, query }, undefined, { scroll: false });
  };
  const shift = (months) => go(dayjs(`${month}-01`).add(months, "month").format("YYYY-MM"));

  const recalc = async () => {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/report/miesieczny", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ miesiac: month }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message || "Nie udało się przeliczyć podsumowania.");
      // mutate, nie router.replace: przy `data ?? initial` świeże propsy SSR
      // nie nadpisują wpisu, który już siedzi w cache'u SWR.
      mutate(body, false);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const sections = [...new Set(people.map((p) => p.section))];

  return (
    <BaseLayout width="wide">
      <PageHeader
        title="Podsumowania miesięczne"
        description="Miesiąc każdego pracownika z osobna: obecność z kart czasu, zatwierdzone nieobecności i zaraportowany czas. Zapisywane automatycznie 1. dnia miesiąca."
        actions={
          <Button variant="secondary" onClick={recalc} disabled={busy}>
            {busy ? "Przeliczanie…" : people.length ? "Przelicz ponownie" : "Wygeneruj"}
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex items-center gap-1">
          <IconButton label="Miesiąc wcześniej" onClick={() => shift(-1)}>
            <ChevronLeftIcon />
          </IconButton>
          <IconButton label="Miesiąc później" onClick={() => shift(1)} disabled={month >= lastClosed}>
            <ChevronRightIcon />
          </IconButton>
        </div>
        <Input
          type="month"
          value={month}
          max={lastClosed}
          aria-label="Wybierz miesiąc"
          onChange={(e) => e.target.value && go(e.target.value)}
          className="!w-44"
        />
        <p className="text-sm text-muted">{dayjs(`${month}-01`).format("MMMM YYYY")}</p>
      </div>

      <Alert className="mb-4">{err}</Alert>

      {people.length === 0 ? (
        <Plate>
          <EmptyState
            title="Brak podsumowania za ten miesiąc"
            description="Automat zapisuje podsumowanie 1. dnia miesiąca, licząc od wdrożenia tej zakładki. Wcześniejszy miesiąc można wygenerować ręcznie przyciskiem u góry."
          />
        </Plate>
      ) : (
        <div className="space-y-6">
          {sections.map((section) => {
            const members = people.filter((p) => p.section === section);
            const { team, workingDays } = members[0];
            return (
              <Plate key={section}>
                <PlateHeader title={labels[section] || section} aside={`zapisano ${signature(members)}`}>
                  <p className="text-xs text-muted">
                    {workingDays} dni roboczych · osób: {team.people} · średnia zespołu{" "}
                    <span className="font-mono tabular-nums text-body">
                      {team.avgDailySeconds !== null ? hm(team.avgDailySeconds) : "—"}
                    </span>
                  </p>
                </PlateHeader>
                {members.map((person) => (
                  <Person key={person.userID} person={person} />
                ))}
              </Plate>
            );
          })}

          <p className="text-xs text-muted max-w-prose">
            Dni robocze to poniedziałek–piątek bez świąt, jednakowo dla wszystkich: aplikacja nie zna wymiaru etatu ani
            daty zatrudnienia, więc u osoby na część etatu albo przyjętej w trakcie miesiąca „dni bez ewidencji” są
            zawyżone. Średnia dzienna to czas zaraportowany w dni robocze podzielony przez dni przepracowane.
          </p>
        </div>
      )}
    </BaseLayout>
  );
}
