import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { getToken } from "next-auth/jwt";
import classNames from "classnames";
import dayjs from "dayjs";
import "dayjs/locale/pl";
import BaseLayout from "../../../components/baseLayout";
import { Columns, Donut, Legend, Lines, ShareBar, OTHER_COLOR, SERIES_COUNT, seriesColor } from "../../../components/charts";
import Button, { ButtonLink } from "../../../components/ui/button";
import Field, { Input, Textarea } from "../../../components/ui/field";
import Plate, { PlateHeader } from "../../../components/ui/plate";
import Alert from "../../../components/ui/alert";
import Badge from "../../../components/ui/badge";
import Stat from "../../../components/ui/stat";
import EmptyState from "../../../components/ui/emptyState";
import { TableWrap, Table, Th, Td, Tr, Num } from "../../../components/ui/table";
import { getMonth, getPersonHistory, lastClosedMonth } from "../../../services/monthlyReport";
import { getPreviousReview, getReviewsForUser } from "../../../services/monthlyReview";
import { listSections } from "../../../services/sections";
import { canSeeMonthlyReports } from "../../../services/roles";
import { canSeeSection, visibleSections } from "../../../services/scope";
import { absenceKindLabel, absenceKindShort } from "../../../services/absenceKinds";
import { kindLabel } from "../../../services/overtimeKinds";
import { formatDateRange, formatMinutes } from "../../../utils";
import { MONTH_RE, OVERTIME_OFF } from "../../../utils/monthlyReport";
import {
  MANUAL_CRITERIA,
  WEIGHTS,
  attendanceTone,
  averageTone,
  computeScore,
  monthStars,
  observe,
  privateTone,
  starString,
} from "../../../utils/monthlyScore";

dayjs.locale("pl");

const NO_PROJECT = "(bez projektu)";

export async function getServerSideProps(ctx) {
  const token = await getToken({ req: ctx.req });

  if (!token) {
    return { redirect: { destination: "/users/signin", permanent: false } };
  }
  if (!canSeeMonthlyReports(token.role)) {
    return { notFound: true };
  }

  const { id, miesiac } = ctx.query;
  if (!/^\d+$/.test(id || "")) return { notFound: true };

  const lastClosed = lastClosedMonth();
  const month = MONTH_RE.test(miesiac || "") && miesiac <= lastClosed ? miesiac : lastClosed;

  const history = getPersonHistory(id, month);
  const found = history[history.length - 1] || null;

  // Zasięg sprawdzamy po sekcji Z MIGAWKI. Brak raportu i cudza sekcja dają
  // DOKŁADNIE tę samą odpowiedź (pusty ekran „brak raportu”), żeby adres nie
  // zdradzał, czy pracownik spoza zasięgu w ogóle istnieje.
  const person = found && canSeeSection(token, found.section) ? found : null;

  const labels = Object.fromEntries(listSections({ includeInactive: true }).map((s) => [s.slug, s.label]));

  if (!person) {
    return { props: { month, lastClosed, userID: Number(id), person: null } };
  }

  const reviews = getReviewsForUser(id, history[0].month, month);
  const review = reviews.get(month) || null;

  // Poprzedni miesiąc do porównania — tylko gdy to NAPRAWDĘ poprzedni, a nie
  // najbliższa starsza migawka po przerwie.
  const before = history[history.length - 2];
  const previous = before && before.month === dayjs(`${month}-01`).subtract(1, "month").format("YYYY-MM") ? before : null;

  // Do trendu idzie wycinek migawki — tablica dni i rejestry sześciu miesięcy
  // nie mają po co jechać do przeglądarki.
  const trend = history.map((h) => ({
    month: h.month,
    totalSeconds: h.totalSeconds,
    avgDailySeconds: h.avgDailySeconds,
    teamAvgSeconds: h.team.avgDailySeconds,
    workedDays: h.workedDays,
    workingDays: h.workingDays,
    attendance: h.attendance,
    privateSeconds: h.privateSeconds,
    privateShare: h.privateShare,
    overtimeNet: h.overtime.net,
    projects: h.projects.map((p) => ({ id: p.id, seconds: p.seconds, share: p.share, name: p.name })),
    score: computeScore(h, reviews.get(h.month))?.score ?? null,
  }));

  // Sąsiedzi na liście — kierownik przegląda raporty po kolei, nie wraca po każdy.
  const roster = getMonth(month, visibleSections(token)).map((p) => ({
    userID: p.userID,
    name: `${p.surname} ${p.name}`,
  }));
  const at = roster.findIndex((p) => p.userID === person.userID);

  return {
    props: {
      month,
      lastClosed,
      userID: person.userID,
      person,
      sectionLabel: labels[person.section] || person.section,
      trend,
      review,
      // Podpowiedź do pustego formularza: ostatnia wcześniejsza ocena.
      suggestion: review ? null : getPreviousReview(month, id),
      score: computeScore(person, review),
      observations: observe(person, previous),
      neighbours: { prev: roster[at - 1] || null, next: roster[at + 1] || null },
    },
  };
}

// --- formatowanie -----------------------------------------------------------

const hm = (seconds, opts) => formatMinutes(Math.round((seconds || 0) / 60), opts);
const toHours = (seconds) => (seconds || 0) / 3600;
const num = (value, digits = 1) => Number(value).toFixed(digits).replace(".", ",");
const axisHours = (v) => `${num(v, Number.isInteger(v) ? 0 : 1)} h`;
const tipHours = (v) => hm(v * 3600);
const pct = (value) => `${String(value).replace(".", ",")}%`;
const clock = (min) => (min === null ? "—" : `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`);
const monthShort = (month) => dayjs(`${month}-01`).format("MMM YYYY");
const monthLong = (month) => dayjs(`${month}-01`).format("MMMM YYYY");
const statTone = (tone) => (tone === "neutral" ? "default" : tone);

// Skrót rodzaju nieobecności pod słupkiem dnia — kolumna ma kilkanaście pikseli.
const ABSENCE_CODE = {
  vacation: "U",
  on_demand: "UŻ",
  sick_leave: "L4",
  unpaid: "UB",
  care: "OP",
  occasional: "UO",
  blood_donation: "KR",
  [OVERTIME_OFF]: "ON",
};

const absenceName = (kind) => (kind === OVERTIME_OFF ? "Odbiór nadgodzin" : absenceKindShort(kind));

// --- cegiełki ---------------------------------------------------------------

const SectionTitle = ({ children, id }) => (
  <h2 id={id} className="mt-8 mb-3 pb-2 border-b border-line text-sm font-bold uppercase tracking-signage">
    {children}
  </h2>
);

const Panel = ({ title, aside, className, children }) => (
  <Plate className={classNames("break-inside-avoid", className)}>
    {title && <PlateHeader title={title} aside={aside} />}
    <div className="p-3">{children}</div>
  </Plate>
);

const Mark = ({ color }) => (
  <span aria-hidden="true" className="inline-block w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: color }} />
);

// --- ocena ------------------------------------------------------------------

const ScoreCard = ({ score, review }) => {
  if (!score) {
    return (
      <Plate tone="raised" className="mt-4 p-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <p className="text-sm font-semibold uppercase tracking-signage">Ocena miesiąca — do uzupełnienia</p>
          <p className="mt-1 text-sm text-muted max-w-prose">
            Regularność i dyscyplinę raport liczy sam. Kompetencje techniczne, dokumentację i inicjatywę ocenia
            kierownik — bez nich ocena ogólna nie powstaje.
          </p>
        </div>
        <ButtonLink href="#ocena" external variant="secondary">
          Uzupełnij ocenę
        </ButtonLink>
      </Plate>
    );
  }

  return (
    <div className="mt-4 p-4 flex flex-wrap items-center gap-x-6 gap-y-3 break-inside-avoid rounded bg-surface text-body ring-1 ring-line shadow-plate dark:bg-black dark:text-white dark:ring-line-strong">
      <div className="w-24 h-24 rounded-full border-2 border-body/40 dark:border-white/40 flex flex-col items-center justify-center shrink-0">
        <span className="font-mono text-3xl font-semibold leading-none">{num(score.score)}</span>
        <span className="mt-1 text-xs opacity-80">/ 10</span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs uppercase tracking-signage opacity-80">Ocena ogólna</p>
        <p className="mt-0.5 text-xl font-bold">
          {score.label} <span aria-hidden="true">{starString(Math.round(score.score / 2))}</span>
        </p>
        {review.comment && <p className="mt-2 text-sm leading-relaxed max-w-prose whitespace-pre-line opacity-90">{review.comment}</p>}
        <p className="mt-2 text-xs opacity-70">
          Ocenił(a) {review.updatedByName || "kierownik"} · {review.updatedAt.slice(0, 16)}
        </p>
      </div>
    </div>
  );
};

const CriteriaBar = ({ name, value, weight, auto }) => (
  <div className="mb-3 last:mb-0">
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span>
        {name} <span className="text-xs text-muted">· waga {Math.round(weight * 100)}%{auto ? " · z danych" : ""}</span>
      </span>
      <span className="font-mono tabular-nums font-medium">{num(value)} / 10</span>
    </div>
    <div className="mt-1 h-2 rounded-sm bg-raised overflow-hidden">
      <div className="h-2 rounded-sm" style={{ width: `${value * 10}%`, background: auto ? seriesColor(0) : seriesColor(6) }} />
    </div>
  </div>
);

const lines = (text) =>
  String(text || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

const ReviewForm = ({ month, userID, review, suggestion }) => {
  const router = useRouter();
  const base = review || suggestion || {};
  const [form, setForm] = useState({
    tech: base.tech ?? "",
    docs: base.docs ?? "",
    initiative: base.initiative ?? "",
    // Tekst przenosimy tylko z oceny TEGO miesiąca — uzasadnienie sprzed
    // miesiąca cytowałoby liczby, których już nie ma.
    comment: review?.comment ?? "",
    actions: review?.actions ?? "",
    growth: review?.growth ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState(false);

  const set = (key) => (e) => {
    setSaved(false);
    setForm((f) => ({ ...f, [key]: e.target.value }));
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/report/miesieczny/ocena", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ miesiac: month, userID, ...form }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message || "Nie udało się zapisać oceny.");
      setSaved(true);
      // Strona jest czysto serwerowa (bez SWR), więc odświeżenie propsów wystarcza.
      router.replace(router.asPath, undefined, { scroll: false });
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="print:hidden">
      <SectionTitle id="ocena">Ocena kierownika</SectionTitle>
      <Panel>
        {!review && suggestion && (
          <Alert tone="info" className="mb-3">
            Podoceny podpowiedziane z oceny za {monthLong(suggestion.month)} — nie są zapisane, dopóki ich nie zatwierdzisz.
          </Alert>
        )}
        <div className="grid sm:grid-cols-3 gap-3">
          {MANUAL_CRITERIA.map(([key, label]) => (
            <Field key={key} label={`${label} (0–10)`} htmlFor={`score-${key}`}>
              <Input
                id={`score-${key}`}
                type="number"
                min="0"
                max="10"
                step="0.5"
                required
                value={form[key]}
                onChange={set(key)}
              />
            </Field>
          ))}
        </div>
        <div className="mt-3 grid gap-3">
          <Field label="Uzasadnienie oceny" htmlFor="review-comment" hint="Pokazywane w karcie oceny ogólnej.">
            <Textarea id="review-comment" rows={3} value={form.comment} onChange={set("comment")} />
          </Field>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Działania natychmiastowe" htmlFor="review-actions" hint="Jedna rekomendacja w wierszu.">
              <Textarea id="review-actions" rows={4} value={form.actions} onChange={set("actions")} />
            </Field>
            <Field label="Możliwości rozwoju" htmlFor="review-growth" hint="Jedna rekomendacja w wierszu.">
              <Textarea id="review-growth" rows={4} value={form.growth} onChange={set("growth")} />
            </Field>
          </div>
        </div>
        <Alert className="mt-3">{err}</Alert>
        <div className="mt-3 flex items-center gap-3">
          <Button type="submit" disabled={busy}>
            {busy ? "Zapisywanie…" : review ? "Zapisz zmiany" : "Zapisz ocenę"}
          </Button>
          {saved && <span className="text-sm text-ok-strong">Zapisano.</span>}
        </div>
      </Panel>
    </form>
  );
};

// --- strona -----------------------------------------------------------------

const OBS_TONE = {
  pos: "border-ok bg-ok-soft text-ok-strong",
  neu: "border-line-strong bg-raised text-body",
  neg: "border-danger bg-danger-soft text-danger-strong",
};
const OBS_LABEL = { pos: "Mocna strona", neu: "Do odnotowania", neg: "Do wyjaśnienia" };

export default function MonthlyReport({
  month,
  lastClosed,
  userID,
  person,
  sectionLabel,
  trend,
  review,
  suggestion,
  score,
  observations,
  neighbours,
}) {
  const query = (id, m = month) => ({
    pathname: "/zadania/podsumowanie/[id]",
    query: { id, ...(m !== lastClosed && { miesiac: m }) },
  });
  const listHref = { pathname: "/zadania/podsumowanie", query: month !== lastClosed ? { miesiac: month } : {} };
  const shiftMonth = (n) => dayjs(`${month}-01`).add(n, "month").format("YYYY-MM");

  const toolbar = (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden">
      <div className="flex flex-wrap items-center gap-2">
        <ButtonLink href={listHref} variant="secondary" size="sm">
          ← Lista
        </ButtonLink>
        <ButtonLink href={query(userID, shiftMonth(-1))} variant="ghost" size="sm">
          ‹ {monthShort(shiftMonth(-1))}
        </ButtonLink>
        {month < lastClosed && (
          <ButtonLink href={query(userID, shiftMonth(1))} variant="ghost" size="sm">
            {monthShort(shiftMonth(1))} ›
          </ButtonLink>
        )}
      </div>
      {person && (
        <div className="flex flex-wrap items-center gap-2">
          {neighbours.prev && (
            <ButtonLink href={query(neighbours.prev.userID)} variant="ghost" size="sm">
              ‹ {neighbours.prev.name}
            </ButtonLink>
          )}
          {neighbours.next && (
            <ButtonLink href={query(neighbours.next.userID)} variant="ghost" size="sm">
              {neighbours.next.name} ›
            </ButtonLink>
          )}
          <Button variant="secondary" size="sm" onClick={() => window.print()}>
            Drukuj / PDF
          </Button>
        </div>
      )}
    </div>
  );

  if (!person) {
    return (
      <BaseLayout width="wide">
        {toolbar}
        <Plate>
          <EmptyState
            title={`Brak raportu za ${monthLong(month)}`}
            description="Dla tego pracownika nie ma zapisanego podsumowania za wybrany miesiąc. Podsumowanie generuje się na liście zbiorczej."
            action={
              <Link href={listHref}>
                <a className="underline underline-offset-2">Przejdź do listy</a>
              </Link>
            }
          />
        </Plate>
      </BaseLayout>
    );
  }

  const { team } = person;

  // Barwa idzie za PROJEKTEM, przez cały raport: ten sam projekt ma ten sam
  // kolor na pierścieniu, na słupkach miesięcy i na paskach. Kolejność ustala
  // bieżący miesiąc; czego w nim nie ma w czołówce, zlewa się w „pozostałe”.
  const cap = person.projects.length <= SERIES_COUNT ? SERIES_COUNT : SERIES_COUNT - 1;
  const named = person.projects.slice(0, cap);
  const colorOf = new Map(named.map((p, i) => [String(p.id), seriesColor(i)]));
  const nameOf = (p) => p.name || NO_PROJECT;
  const segmentsOf = (projects) => {
    const byKey = new Map(projects.map((p) => [String(p.id), p.seconds]));
    const known = named.map((p, i) => ({ name: nameOf(p), color: seriesColor(i), value: toHours(byKey.get(String(p.id))) }));
    const rest = projects.filter((p) => !colorOf.has(String(p.id))).reduce((sum, p) => sum + p.seconds, 0);
    return rest > 0 ? [...known, { name: "Pozostałe", color: OTHER_COLOR, value: toHours(rest) }] : known;
  };
  const projectLegend = segmentsOf(person.projects)
    .filter((s) => s.value > 0)
    .map((s) => ({ name: s.name, color: s.color, value: tipHours(s.value) }));

  const diff = person.avgDailySeconds !== null && team.avgDailySeconds !== null ? person.avgDailySeconds - team.avgDailySeconds : null;
  const weekday = (d) => dayjs(`${month}-${String(d).padStart(2, "0")}`).format("dddd, D MMMM");
  const absenceCodes = [...new Set(person.days.filter((d) => d.a).map((d) => d.a))];
  const hasPrivate = person.privateSeconds > 0;

  return (
    <BaseLayout width="wide">
      {toolbar}

      {/* --- nagłówek ------------------------------------------------------ */}
      <Plate className="p-4 sm:p-5 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-signage text-muted">Raport miesięczny</p>
          <h1 className="mt-1 text-2xl sm:text-3xl font-bold leading-tight">
            {person.name} {person.surname}
          </h1>
          <p className="mt-2">
            <Badge tone="accent">{sectionLabel}</Badge>
            {person.outsideTeam && <span className="ml-2 text-xs text-muted">kierownik · poza średnią zespołu</span>}
          </p>
        </div>
        <dl className="text-sm text-right">
          <dt className="text-xs uppercase tracking-signage text-muted">Okres</dt>
          <dd className="font-semibold">{monthLong(month)}</dd>
          <dt className="mt-2 text-xs uppercase tracking-signage text-muted">Zapisano</dt>
          <dd className="font-mono tabular-nums">
            {person.generatedAt.slice(0, 16)} · {person.generatedByName || "automat"}
          </dd>
        </dl>
      </Plate>

      {/* --- wskaźniki ------------------------------------------------------ */}
      <div className="mt-4 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
        <Stat label="Łączne godziny" value={hm(person.totalSeconds)} hint={`obecność wg kart: ${hm(person.presentSeconds)}`} />
        <Stat
          label="Śr. dzienna"
          value={person.avgDailySeconds !== null ? hm(person.avgDailySeconds) : "—"}
          tone={statTone(averageTone(person.avgDailySeconds))}
          hint={
            team.avgDailySeconds !== null
              ? `zespół ${hm(team.avgDailySeconds)}${diff !== null ? ` (${hm(diff, { withSign: true })})` : ""}`
              : "norma: 8 h"
          }
        />
        <Stat
          label="Dni robocze"
          value={`${person.workedDays} / ${person.workingDays}`}
          tone={statTone(attendanceTone(person.attendance))}
          hint={person.attendance !== null ? `frekwencja ${person.attendance}%` : "—"}
        />
        <Stat
          label="Czas prywatny"
          value={pct(person.privateShare)}
          tone={person.totalSeconds > 0 ? statTone(privateTone(person.privateShare)) : "default"}
          hint={`${hm(person.privateSeconds)} · zespół ${pct(team.privateShare)}`}
        />
        <Stat label="Projekty" value={person.projectCount} hint={person.projects[0] ? `najwięcej: ${nameOf(person.projects[0])}` : "brak wpisów"} />
        <Stat
          label="Nadgodziny"
          value={formatMinutes(person.overtime.net, { withSign: true })}
          hint={`zatwierdzone: ${formatMinutes(person.overtime.plus, { withSign: true })} / ${formatMinutes(person.overtime.minus)}`}
        />
      </div>

      <ScoreCard score={score} review={review} />

      {/* --- wydajność ------------------------------------------------------ */}
      <SectionTitle>Wydajność na tle poprzednich miesięcy</SectionTitle>
      <div className="grid lg:grid-cols-2 gap-4">
        <Panel title="Łączne godziny pracy">
          <Columns
            showValues
            format={axisHours}
            items={trend.map((t) => ({
              label: monthShort(t.month),
              title: monthLong(t.month),
              segments: [{ name: "Zaraportowany czas", value: toHours(t.totalSeconds), color: seriesColor(0) }],
            }))}
          />
        </Panel>
        <Panel title="Średnia dzienna a średnia zespołu">
          <Lines
            format={axisHours}
            labels={trend.map((t) => monthShort(t.month))}
            series={[
              { name: "Średnia dzienna", color: seriesColor(0), values: trend.map((t) => (t.avgDailySeconds === null ? null : toHours(t.avgDailySeconds))) },
              { name: "Średnia zespołu", color: OTHER_COLOR, dashed: true, values: trend.map((t) => (t.teamAvgSeconds === null ? null : toHours(t.teamAvgSeconds))) },
            ]}
          />
          <Legend
            className="mt-3"
            items={[
              { name: "Średnia dzienna", color: seriesColor(0), value: person.avgDailySeconds !== null ? hm(person.avgDailySeconds) : "—" },
              { name: "Średnia zespołu", color: OTHER_COLOR, dashed: true, value: team.avgDailySeconds !== null ? hm(team.avgDailySeconds) : "—" },
            ]}
          />
        </Panel>
      </div>

      {/* --- projekty ------------------------------------------------------- */}
      <SectionTitle>Projekty</SectionTitle>
      {person.projects.length === 0 ? (
        <Panel>
          <p className="text-sm text-muted">Brak zaraportowanego czasu w tym miesiącu.</p>
        </Panel>
      ) : (
        <>
          <div className="grid lg:grid-cols-2 gap-4">
            <Panel title={`Rozkład projektów — ${monthLong(month)}`}>
              <div className="flex flex-wrap items-center gap-5">
                <Donut segments={segmentsOf(person.projects)} format={tipHours} value={`${num(toHours(person.totalSeconds))} h`} label="łącznie" />
                <ul className="flex-1 min-w-[12rem] space-y-1 text-sm">
                  {segmentsOf(person.projects)
                    .filter((s) => s.value > 0)
                    .map((s) => (
                      <li key={s.name} className="flex items-center gap-2">
                        <Mark color={s.color} />
                        <span className="flex-1 min-w-0 truncate">{s.name}</span>
                        <span className="font-mono tabular-nums text-muted">{Math.round((s.value * 3600 * 100) / person.totalSeconds)}%</span>
                      </li>
                    ))}
                </ul>
              </div>
            </Panel>
            <Panel title="Czas produktywny i prywatny">
              <Columns
                showValues
                format={axisHours}
                items={trend.map((t) => ({
                  label: monthShort(t.month),
                  title: monthLong(t.month),
                  segments: [
                    { name: "Produktywny", value: toHours(t.totalSeconds - t.privateSeconds), color: seriesColor(0) },
                    { name: "Prywatny", value: toHours(t.privateSeconds), color: seriesColor(1) },
                  ],
                }))}
              />
              <Legend
                className="mt-3"
                items={[
                  { name: "Produktywny", color: seriesColor(0), value: hm(person.totalSeconds - person.privateSeconds) },
                  { name: "Prywatny", color: seriesColor(1), value: hm(person.privateSeconds) },
                ]}
              />
            </Panel>
          </div>

          <Panel title="Godziny na projekt, miesiąc po miesiącu" className="mt-4">
            <Columns
              showValues
              height={260}
              format={axisHours}
              items={trend.map((t) => ({ label: monthShort(t.month), title: monthLong(t.month), segments: segmentsOf(t.projects) }))}
            />
            <Legend className="mt-3" items={projectLegend} />
            <p className="mt-1 text-xs text-muted">Wartości w legendzie dotyczą miesiąca {monthLong(month)}.</p>
          </Panel>

          <Panel title="Zaangażowanie w projekty" aside={`${person.projectCount} projektów`} className="mt-4">
            <div className="space-y-2">
              {person.projects.map((p) => (
                <ShareBar
                  key={String(p.id)}
                  name={nameOf(p)}
                  mark={<Mark color={colorOf.get(String(p.id)) || OTHER_COLOR} />}
                  color={colorOf.get(String(p.id)) || OTHER_COLOR}
                  percent={p.share ?? 0}
                  value={`${hm(p.seconds)} · ${p.share ?? 0}%`}
                />
              ))}
            </div>
          </Panel>
        </>
      )}

      {person.tasks.length > 0 && (
        <Panel title="Najwięcej czasu — zadania" aside="ten sam opis w tym samym projekcie" className="mt-4">
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>Zadanie</Th>
                  <Th>Projekt</Th>
                  <Th align="right">Wpisów</Th>
                  <Th align="right">Czas</Th>
                  <Th align="right">Udział</Th>
                </tr>
              </thead>
              <tbody>
                {person.tasks.map((t, i) => (
                  <Tr key={i}>
                    <Td>{t.description || <span className="text-faint">(bez opisu)</span>}</Td>
                    <Td className="text-muted whitespace-nowrap">{t.project || NO_PROJECT}</Td>
                    <Num>{t.entries}</Num>
                    <Num>{hm(t.seconds)}</Num>
                    <Num className="text-muted">{Math.round((t.seconds * 100) / person.totalSeconds)}%</Num>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        </Panel>
      )}

      {/* --- dzień po dniu -------------------------------------------------- */}
      <SectionTitle>Dzień po dniu</SectionTitle>
      <Panel title="Zaraportowany czas w kolejnych dniach miesiąca">
        <Columns
          height={240}
          format={axisHours}
          reference={{ value: 8, label: "norma 8 h" }}
          markerName="Obecność wg karty"
          items={person.days.map((d) => ({
            label: String(d.d),
            title: weekday(d.d),
            shaded: !d.w,
            note: d.a ? ABSENCE_CODE[d.a] || "N" : d.g ? "?" : undefined,
            noteTone: d.g ? "danger" : undefined,
            marker: toHours(d.p),
            segments: [
              { name: "Zadania", value: toHours(d.r - (d.x || 0)), color: seriesColor(0) },
              { name: "Prywatne", value: toHours(d.x || 0), color: seriesColor(1) },
            ],
          }))}
        />
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
          <Legend
            items={[
              { name: "Zadania", color: seriesColor(0) },
              ...(hasPrivate ? [{ name: "Prywatne", color: seriesColor(1) }] : []),
            ]}
          />
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className="inline-block w-4 border-t-2 border-body" /> obecność wg karty czasu
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className="inline-block w-3 h-3 bg-raised" /> weekend lub święto
          </span>
          {absenceCodes.map((kind) => (
            <span key={kind}>
              <span className="font-semibold">{ABSENCE_CODE[kind] || "N"}</span> — {absenceName(kind)}
            </span>
          ))}
          {person.gapDays > 0 && (
            <span>
              <span className="font-semibold text-danger-strong">?</span> — bez karty, bez wpisów i bez nieobecności
            </span>
          )}
        </div>
      </Panel>

      {/* --- frekwencja i rejestry ------------------------------------------ */}
      <SectionTitle>Frekwencja i rejestry kadrowe</SectionTitle>
      <div className="grid lg:grid-cols-3 gap-4">
        <Panel title="Dni robocze miesiąca">
          <div className="flex flex-wrap items-center gap-5">
            <Donut
              format={(v) => `${v} dni`}
              value={`${person.workedDays} / ${person.workingDays}`}
              label={person.attendance !== null ? `${person.attendance}%` : undefined}
              segments={[
                { name: "Przepracowane", value: person.workedDays, color: seriesColor(0) },
                { name: "Nieobecności", value: person.absenceDays, color: seriesColor(3) },
                { name: "Bez ewidencji", value: person.gapDays, color: seriesColor(7) },
              ]}
            />
            <ul className="space-y-1 text-sm">
              {[
                ["Przepracowane", person.workedDays, seriesColor(0)],
                ["Nieobecności", person.absenceDays, seriesColor(3)],
                ["Bez ewidencji", person.gapDays, seriesColor(7)],
              ].map(([name, value, color]) => (
                <li key={name} className="flex items-center gap-2">
                  <Mark color={color} />
                  <span className="flex-1">{name}</span>
                  <span className="font-mono tabular-nums">{value}</span>
                </li>
              ))}
            </ul>
          </div>
          {person.absenceDays > 0 && (
            <p className="mt-3 text-xs text-muted">
              Nieobecności:{" "}
              {Object.entries(person.absenceByKind)
                .map(([kind, n]) => `${absenceName(kind)} ${n}`)
                .join(" · ")}
            </p>
          )}
          <p className="mt-3 text-xs text-muted">
            Frekwencja = przepracowane / robocze (nieobecności ją obniżają). Zespół: {team.attendance !== null ? `${team.attendance}%` : "—"}.
          </p>
        </Panel>

        <Panel title="Nieobecności" aside="zatwierdzone">
          {person.absences.length === 0 ? (
            <p className="text-sm text-muted">Brak zatwierdzonych nieobecności w tym miesiącu.</p>
          ) : (
            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <Th>Termin</Th>
                    <Th>Rodzaj</Th>
                    <Th align="right">Dni rob.</Th>
                  </tr>
                </thead>
                <tbody>
                  {person.absences.map((a, i) => (
                    <Tr key={i}>
                      <Td className="font-mono tabular-nums whitespace-nowrap">{formatDateRange(a.dateFrom, a.dateTo)}</Td>
                      <Td>{absenceKindLabel(a.kind)}</Td>
                      <Num>{a.days}</Num>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          )}
        </Panel>

        <Panel title="Nadgodziny" aside="zatwierdzone wnioski">
          {person.overtime.items.length === 0 ? (
            <p className="text-sm text-muted">Brak zatwierdzonych wniosków w tym miesiącu.</p>
          ) : (
            <>
              <TableWrap>
                <Table>
                  <thead>
                    <tr>
                      <Th>Data</Th>
                      <Th>Rodzaj / powód</Th>
                      <Th align="right">Wymiar</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {person.overtime.items.map((o, i) => (
                      <Tr key={i} className={o.bookkeeping ? "text-muted" : undefined}>
                        <Td className="font-mono tabular-nums whitespace-nowrap">{o.data}</Td>
                        <Td>
                          {kindLabel(o.kind)}
                          {o.reason && <span className="block text-xs text-muted">{o.reason}</span>}
                          {o.bookkeeping && <span className="block text-xs">rozliczenie dnia — poza sumą miesiąca</span>}
                        </Td>
                        <Num>{formatMinutes(o.minutes, { withSign: true })}</Num>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </TableWrap>
              <p className="mt-2 text-xs text-muted">
                Suma miesiąca: <span className="font-mono text-body">{formatMinutes(person.overtime.net, { withSign: true })}</span>
                {person.overtime.bookkeeping !== 0 && (
                  <> · rozliczenia dni (wnioski od 8 h): {formatMinutes(person.overtime.bookkeeping, { withSign: true })}</>
                )}
              </p>
            </>
          )}
        </Panel>
      </div>

      {/* --- jakość ewidencji ----------------------------------------------- */}
      <SectionTitle>Jakość ewidencji</SectionTitle>
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
        <Stat
          label="Pokrycie obecności"
          value={person.coverage !== null ? `${person.coverage}%` : "—"}
          hint={`zespół ${team.coverage !== null ? `${team.coverage}%` : "—"}`}
        />
        <Stat
          label="Karta bez zadań"
          value={person.cardOnlyDays}
          tone={person.cardOnlyDays >= 3 ? "danger" : "default"}
          hint={`dni · zadania bez karty: ${person.entryOnlyDays}`}
        />
        <Stat label="Wpisy ręczne" value={person.quality.manual} hint={`z ${person.quality.entries} wpisów`} />
        <Stat label="Czas edytowany" value={person.quality.edited} hint="zmienione godziny" />
        <Stat
          label="Zamknięte automatycznie"
          value={person.quality.auto + person.quality.autoClosedCards}
          hint={`wpisy ${person.quality.auto} · karty ${person.quality.autoClosedCards}`}
        />
        <Stat label="Śr. wejście – wyjście" value={`${clock(person.avgStartMin)}–${clock(person.avgEndMin)}`} hint="wg kart czasu" />
      </div>

      {/* --- miesiące w tabeli ---------------------------------------------- */}
      <SectionTitle>Podsumowanie miesięcy</SectionTitle>
      <Plate className="break-inside-avoid">
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th className="pl-3">Miesiąc</Th>
                <Th align="right">Dni (prac. / rob.)</Th>
                <Th align="right">Frekwencja</Th>
                <Th align="right">Godziny</Th>
                <Th align="right">Śr. / dzień</Th>
                <Th align="right">Nadgodziny</Th>
                <Th align="right">Prywatne</Th>
                <Th>Projekt dominujący</Th>
                <Th align="right" className="pr-3">
                  Ocena
                </Th>
              </tr>
            </thead>
            <tbody>
              {trend
                .slice()
                .reverse()
                .map((t) => (
                  <Tr key={t.month} className={t.month === month ? "bg-raised/60" : undefined}>
                    <Td className="pl-3 font-semibold whitespace-nowrap">{monthLong(t.month)}</Td>
                    <Num>
                      {t.workedDays} / {t.workingDays}
                    </Num>
                    <Td className="text-right">
                      {t.attendance !== null ? <Badge tone={attendanceTone(t.attendance)}>{t.attendance}%</Badge> : "—"}
                    </Td>
                    <Num>{hm(t.totalSeconds)}</Num>
                    <Td className="text-right">
                      {t.avgDailySeconds !== null ? (
                        <Badge tone={averageTone(t.avgDailySeconds)} className="font-mono normal-case tracking-normal">
                          {hm(t.avgDailySeconds)}
                        </Badge>
                      ) : (
                        "—"
                      )}
                    </Td>
                    <Num>{formatMinutes(t.overtimeNet, { withSign: true })}</Num>
                    <Td className="text-right">
                      <Badge tone={privateTone(t.privateShare)}>{pct(t.privateShare)}</Badge>
                    </Td>
                    <Td>{t.projects[0] ? `${nameOf(t.projects[0])} (${t.projects[0].share}%)` : "—"}</Td>
                    <Td className="pr-3 text-right whitespace-nowrap">
                      <span aria-hidden="true">{starString(monthStars(t.avgDailySeconds))}</span>
                      {t.score !== null && <span className="ml-2 font-mono tabular-nums">{num(t.score)}</span>}
                    </Td>
                  </Tr>
                ))}
            </tbody>
          </Table>
        </TableWrap>
      </Plate>
      <p className="mt-2 text-xs text-muted">Gwiazdki wynikają wyłącznie ze średniej dziennej; liczba obok to ocena ogólna, jeśli kierownik ją wystawił.</p>

      {/* --- obserwacje ----------------------------------------------------- */}
      <SectionTitle>Obserwacje</SectionTitle>
      <ul className="space-y-2">
        {observations.map((o, i) => (
          <li key={i} className={classNames("px-3 py-2 border-l-4 rounded-sm text-sm leading-relaxed break-inside-avoid", OBS_TONE[o.tone])}>
            <span className="block text-[0.6875rem] font-semibold uppercase tracking-signage opacity-80">{OBS_LABEL[o.tone]}</span>
            {o.text}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted">Obserwacje powstają automatycznie z liczb tego raportu, według stałych progów.</p>

      {review && (lines(review.actions).length > 0 || lines(review.growth).length > 0) && (
        <>
          <SectionTitle>Rekomendacje</SectionTitle>
          <div className="grid md:grid-cols-2 gap-4">
            {[
              ["Działania natychmiastowe", review.actions, "border-t-danger"],
              ["Możliwości rozwoju", review.growth, "border-t-ok"],
            ].map(([title, text, border]) => (
              <Plate key={title} className={classNames("p-3 border-t-4 break-inside-avoid", border)}>
                <h3 className="text-sm font-bold">{title}</h3>
                <ul className="mt-2 space-y-1.5 text-sm text-muted">
                  {lines(text).map((line, i) => (
                    <li key={i} className="pl-5 relative">
                      <span aria-hidden="true" className="absolute left-0 font-bold text-accent-strong">
                        →
                      </span>
                      {line}
                    </li>
                  ))}
                  {lines(text).length === 0 && <li>—</li>}
                </ul>
              </Plate>
            ))}
          </div>
        </>
      )}

      {score && (
        <>
          <SectionTitle>Kryteria oceny</SectionTitle>
          <div className="grid md:grid-cols-3 gap-4">
            <Panel title="Kompetencje techniczne (30%)">
              <CriteriaBar name="Ocena techniczna" value={score.parts.tech} weight={WEIGHTS.tech} />
            </Panel>
            <Panel title="Organizacja pracy (50%)">
              <CriteriaBar
                name={`Regularność (${hm(person.avgDailySeconds)} / dzień)`}
                value={score.parts.regularity}
                weight={WEIGHTS.regularity}
                auto
              />
              <CriteriaBar name="Dokumentacja" value={score.parts.docs} weight={WEIGHTS.docs} />
              <CriteriaBar name="Inicjatywa / rozwój" value={score.parts.initiative} weight={WEIGHTS.initiative} />
            </Panel>
            <Panel title="Dyscyplina (20%)">
              <CriteriaBar
                name={`Czas prywatny (${pct(person.privateShare)})`}
                value={score.parts.discipline}
                weight={WEIGHTS.discipline}
                auto
              />
            </Panel>
          </div>
        </>
      )}

      <ReviewForm key={`${userID}-${month}`} month={month} userID={userID} review={review} suggestion={suggestion} />

      <p className="mt-8 pt-3 border-t border-line-subtle text-xs text-muted">
        Punktualnik · raport za {monthLong(month)} · dane: karty czasu, nieobecności, wnioski o nadgodziny i wpisy zadań. Dni
        robocze to poniedziałek–piątek bez świąt; aplikacja nie zna wymiaru etatu ani daty zatrudnienia.
      </p>
    </BaseLayout>
  );
}
