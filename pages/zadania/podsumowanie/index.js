import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { getToken } from "next-auth/jwt";
import useSWR from "swr";
import dayjs from "dayjs";
import "dayjs/locale/pl";
import BaseLayout from "../../../components/baseLayout";
import Button, { IconButton } from "../../../components/ui/button";
import { Input } from "../../../components/ui/field";
import Plate, { PlateHeader } from "../../../components/ui/plate";
import Alert from "../../../components/ui/alert";
import Badge from "../../../components/ui/badge";
import PageHeader from "../../../components/ui/pageHeader";
import EmptyState from "../../../components/ui/emptyState";
import { TableWrap, Table, Th, Td, Tr, Num } from "../../../components/ui/table";
import { ChevronLeftIcon, ChevronRightIcon } from "../../../components/ui/icons";
import { lastClosedMonth, listMonth } from "../../../services/monthlyReport";
import { listSections } from "../../../services/sections";
import { canSeeMonthlyReports } from "../../../services/roles";
import { visibleSections } from "../../../services/scope";
import { formatMinutes, jsonFetcher } from "../../../utils";
import { MONTH_RE } from "../../../utils/monthlyReport";
import { attendanceTone, averageTone, privateTone } from "../../../utils/monthlyScore";

dayjs.locale("pl");

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
      initial: { month, people: listMonth(month, visibleSections(token)) },
    },
  };
}

// Średnie i sumy pokazujemy w minutach, nie w sekundach: to wielkości z całego
// miesiąca i "6h 41min 07s" udawałoby dokładność, której ta liczba nie ma.
const hm = (seconds, opts) => formatMinutes(Math.round((seconds || 0) / 60), opts);
const pct = (value) => `${String(value).replace(".", ",")}%`;

const signature = (people) => {
  // Sekcje kierownika powstają razem, ale przeliczyć mógł je każdy z osobna —
  // podpis bierzemy z najświeższego wiersza sekcji.
  const latest = people.reduce((a, b) => (b.generatedAt > a.generatedAt ? b : a));
  return `${latest.generatedAt.slice(0, 16)} · ${latest.generatedByName || "automat"}`;
};

const Row = ({ person, href }) => {
  const diff =
    person.avgDailySeconds !== null && person.team.avgDailySeconds !== null
      ? person.avgDailySeconds - person.team.avgDailySeconds
      : null;

  return (
    <Tr>
      <Td className="pl-3 whitespace-nowrap">
        <Link href={href}>
          <a className="font-semibold underline decoration-line-strong underline-offset-2 hover:decoration-body">
            {person.surname} {person.name}
          </a>
        </Link>
      </Td>
      <Num>
        {person.workedDays} / {person.workingDays}
      </Num>
      <Td className="text-right">
        {person.attendance !== null ? <Badge tone={attendanceTone(person.attendance)}>{person.attendance}%</Badge> : "—"}
      </Td>
      <Num>{person.absenceDays || "—"}</Num>
      <Num className={person.gapDays > 0 ? "text-danger-strong font-medium" : undefined}>{person.gapDays || "—"}</Num>
      <Num>{person.totalSeconds > 0 ? hm(person.totalSeconds) : "—"}</Num>
      <Td className="text-right">
        {person.avgDailySeconds !== null ? (
          <Badge tone={averageTone(person.avgDailySeconds)} className="font-mono normal-case tracking-normal">
            {hm(person.avgDailySeconds)}
          </Badge>
        ) : (
          "—"
        )}
      </Td>
      <Num className="text-muted">{diff !== null ? hm(diff, { withSign: true }) : "—"}</Num>
      <Td className="text-right">
        {person.totalSeconds > 0 ? <Badge tone={privateTone(person.privateShare)}>{pct(person.privateShare)}</Badge> : "—"}
      </Td>
      <Num>{person.overtime.net ? formatMinutes(person.overtime.net, { withSign: true }) : "—"}</Num>
      <Td className="pr-3 text-right whitespace-nowrap">
        {person.score !== null ? (
          <span className="font-mono tabular-nums font-medium">{person.score.toFixed(1).replace(".", ",")} / 10</span>
        ) : (
          <Link href={`${href}#ocena`}>
            <a className="text-xs text-muted underline underline-offset-2">do oceny</a>
          </Link>
        )}
      </Td>
    </Tr>
  );
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
  const reportHref = (person) => ({
    pathname: "/zadania/podsumowanie/[id]",
    query: { id: person.userID, ...(month !== lastClosed && { miesiac: month }) },
  });

  return (
    <BaseLayout width="wide">
      <PageHeader
        title="Podsumowania miesięczne"
        description="Raport miesiąca dla każdego pracownika: obecność z kart czasu, nieobecności, zaraportowany czas i projekty. Zapisywany automatycznie 1. dnia miesiąca — nazwisko otwiera pełny raport."
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
                <TableWrap>
                  <Table>
                    <thead>
                      <tr>
                        <Th className="pl-3">Pracownik</Th>
                        <Th align="right">Dni</Th>
                        <Th align="right">Frekwencja</Th>
                        <Th align="right">Nieob.</Th>
                        <Th align="right">Bez ewid.</Th>
                        <Th align="right">Godziny</Th>
                        <Th align="right">Śr. / dzień</Th>
                        <Th align="right">Do zespołu</Th>
                        <Th align="right">Prywatne</Th>
                        <Th align="right">Nadgodz.</Th>
                        <Th align="right" className="pr-3">
                          Ocena
                        </Th>
                      </tr>
                    </thead>
                    <tbody>
                      {members.map((person) => (
                        <Row key={person.userID} person={person} href={reportHref(person)} />
                      ))}
                    </tbody>
                  </Table>
                </TableWrap>
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
