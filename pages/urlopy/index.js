import { useState } from "react";
import { useRouter } from "next/router";
import { getToken } from "next-auth/jwt";
import classNames from "classnames";
import dayjs from "dayjs";
import BaseLayout from "../../components/baseLayout";
import AbsenceBadge from "../../components/absenceBadge";
import { Input, Select, Textarea } from "../../components/ui/field";
import Button from "../../components/ui/button";
import Plate from "../../components/ui/plate";
import Alert from "../../components/ui/alert";
import PageHeader from "../../components/ui/pageHeader";
import EmptyState from "../../components/ui/emptyState";
import { TableWrap, Table, Th, Td, Tr, Num } from "../../components/ui/table";
import { DownloadIcon } from "../../components/ui/icons";
import getAbsencesForUser from "../../services/getAbsencesForUser";
import { getLeaveBalance } from "../../services/leaveBalance";
import {
  ABSENCE_KINDS,
  SELF_SERVICE_KINDS,
  absenceKindLabel,
  usesPool,
} from "../../services/absenceKinds";
import { countWorkingDays, isWorkingDay } from "../../services/workingDays";
import { now as appNow } from "../../services/workday";

export async function getServerSideProps(ctx) {
  const token = await getToken({ req: ctx.req });

  if (!token) {
    return { redirect: { destination: "/users/signin", permanent: false } };
  }

  // appNow(), nie dayjs(): rok bierzemy w strefie firmy, żeby 1 stycznia nad
  // ranem serwer w innej strefie nie pokazał puli z poprzedniego roku.
  const year = appNow().year();

  return {
    props: {
      year,
      balance: getLeaveBalance(token.userID, year),
      absences: getAbsencesForUser(token.userID),
    },
  };
}

const dayWord = (n) => {
  if (n === 1) return "dzień";
  return "dni";
};

/** Dzisiaj, a jeśli dziś jest wolne — najbliższy dzień roboczy. */
const nextWorkingDay = () => {
  let d = dayjs();
  // Pętla domknięta z zapasem: najdłuższa seria wolnego w polskim kalendarzu to
  // kilka dni (Boże Narodzenie w weekend), a warunek chroni przed nieskończoną
  // pętlą, gdyby kalendarz kiedyś zwrócił coś nieoczekiwanego.
  for (let i = 0; i < 14 && !isWorkingDay(d); i += 1) d = d.add(1, "day");
  return d.format("YYYY-MM-DD");
};

/** Zakres dat po ludzku — jeden dzień pisany raz, nie jako "05.09–05.09". */
const rangeLabel = (from, to) => {
  const a = dayjs(from).format("DD.MM.YYYY");
  const b = dayjs(to).format("DD.MM.YYYY");
  return a === b ? a : `${a} – ${b}`;
};

export default function Urlopy({ year, balance, absences }) {
  const router = useRouter();
  const refresh = () => router.replace(router.asPath, undefined, { scroll: false });

  // Formularz otwiera się na najbliższym dniu ROBOCZYM, nie na dzisiaj.
  // Wniosek składany w sobotę zaczynałby się inaczej od weekendu i witał
  // komunikatem „w tym zakresie nie ma dnia roboczego” — czyli czymś, co
  // wygląda jak błąd, zanim ktokolwiek cokolwiek zrobił.
  const [kind, setKind] = useState(SELF_SERVICE_KINDS[0]);
  const [dateFrom, setDateFrom] = useState(nextWorkingDay);
  const [dateTo, setDateTo] = useState(nextWorkingDay);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  // Ile dni ZEJDZIE — policzone w przeglądarce, zanim wniosek pojedzie na
  // serwer. To jest odpowiedź na pytanie, które pracownik zadaje sobie przy
  // każdym wniosku obejmującym weekend: "to mi zabierze pięć dni czy siedem?".
  // services/workingDays.js nie dotyka bazy, więc wchodzi do bundla i liczy
  // dokładnie tak samo jak serwer przy zapisie.
  const workDays = countWorkingDays(dateFrom, dateTo);
  const poolKind = usesPool(kind);
  const afterRequest = balance.left - (poolKind ? workDays : 0);

  const submit = async (e) => {
    e.preventDefault();

    if (!dateFrom || !dateTo) return setErr("Podaj obie daty.");
    if (dateTo < dateFrom) return setErr("Data „do” jest wcześniejsza niż „od”.");
    // Te same warunki co w services/createAbsence.js — tutaj po to, żeby nie
    // płacić żądaniem za odmowę, którą widać na miejscu.
    if (workDays === 0) return setErr("W tym zakresie nie ma ani jednego dnia roboczego.");
    if (dateFrom.slice(0, 4) !== dateTo.slice(0, 4)) {
      return setErr("Nieobecność nie może przechodzić przez koniec roku — podziel ją na dwa wnioski.");
    }

    setErr("");
    setBusy(true);
    try {
      const res = await fetch("/api/absences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, dateFrom, dateTo, reason }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(body.message || "Nie udało się złożyć wniosku.");
        return;
      }
      setReason("");
      await refresh();
    } catch {
      setErr("Brak połączenia z serwerem.");
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (id) => {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch(`/api/absences/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      });
      if (!res.ok) {
        setErr("Nie udało się anulować — wniosek mógł zostać już rozpatrzony.");
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const leftClass = classNames("font-mono text-3xl font-medium tabular-nums", {
    "text-danger-strong": balance.left < 0,
    "text-body": balance.left > 0,
    "text-muted": balance.left === 0,
  });

  return (
    <BaseLayout>
      <section>
        <PageHeader
          title="Moje urlopy"
          description="Pula liczy się na rok kalendarzowy: dni przydzielone przez kierownika minus wykorzystane. Zwolnienia lekarskie i urlop bezpłatny puli nie ruszają."
        />

        <Plate className="mb-8 p-4">
          <p className="text-xs font-semibold uppercase tracking-signage text-muted">
            Urlop wypoczynkowy — pozostało na {year}
          </p>
          <p className={leftClass}>
            {balance.left} {dayWord(balance.left)}
          </p>
          {/* Trzy liczby zamiast jednej: "zostało 21" bez "z 26" nie mówi, czy
              to dużo, czy mało, a bez "wykorzystano 5" nie da się sprawdzić, czy
              zgadza się z własną pamięcią. */}
          <p className="mt-2 text-xs text-muted">
            Przydzielone: {balance.granted} · wykorzystane: {balance.used}
            {balance.pendingCount > 0 &&
              ` · w oczekiwaniu: ${balance.pendingDays} ${dayWord(balance.pendingDays)} (${balance.pendingCount})`}
          </p>
          {balance.left < 0 && (
            <p className="mt-2 text-xs text-danger-strong">
              Saldo jest ujemne — urlop został udzielony ponad przydział.
            </p>
          )}
        </Plate>

        <form onSubmit={submit} className="mb-10 flex flex-col">
          <h2 className="mb-4 text-sm font-bold uppercase tracking-signage">Nowy wniosek</h2>

          <label className="mb-1 text-xs font-semibold uppercase tracking-signage text-muted">Rodzaj</label>
          {/* Tylko rodzaje, które pracownik zgłasza sam. L4 wpisuje kierownik po
              otrzymaniu zwolnienia, a urlop na żądanie — po telefonie; gdyby
              stały na tej liście, wniosek i tak odbiłby się od API. */}
          <Select value={kind} onChange={(e) => setKind(e.target.value)} className="mb-4">
            {SELF_SERVICE_KINDS.map((k) => (
              <option key={k} value={k}>
                {ABSENCE_KINDS[k].label}
                {ABSENCE_KINDS[k].usesPool ? "" : " (nie zdejmuje dni z puli)"}
              </option>
            ))}
          </Select>

          <div className="mb-4 flex gap-3 flex-wrap">
            <label className="flex flex-col">
              <span className="mb-1 text-xs font-semibold uppercase tracking-signage text-muted">Od</span>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => {
                  setDateFrom(e.target.value);
                  // Data końca idzie za początkiem, dopóki jest wcześniejsza —
                  // inaczej przesunięcie startu zostawiało niemożliwy zakres.
                  if (dateTo < e.target.value) setDateTo(e.target.value);
                }}
                className="!w-44"
                required
              />
            </label>
            <label className="flex flex-col">
              <span className="mb-1 text-xs font-semibold uppercase tracking-signage text-muted">Do</span>
              <Input
                type="date"
                value={dateTo}
                min={dateFrom}
                onChange={(e) => setDateTo(e.target.value)}
                className="!w-44"
                required
              />
            </label>
          </div>

          {/* Wymiar liczony na bieżąco. Bez tego pracownik dowiadywał się, ile
              dni schodzi, dopiero z salda po zatwierdzeniu wniosku. */}
          <p className="mb-4 text-sm">
            {workDays > 0 ? (
              <>
                To <strong>{workDays}</strong> {dayWord(workDays)} roboczych
                {poolKind ? (
                  <>
                    {" "}
                    · po zatwierdzeniu zostanie{" "}
                    <strong className={afterRequest < 0 ? "text-danger-strong" : undefined}>
                      {afterRequest} {dayWord(afterRequest)}
                    </strong>
                  </>
                ) : (
                  " · ten rodzaj nie zdejmuje dni z puli"
                )}
              </>
            ) : (
              <span className="text-muted">W wybranym zakresie nie ma dnia roboczego.</span>
            )}
          </p>

          <label className="mb-1 text-xs font-semibold uppercase tracking-signage text-muted">
            Powód (nieobowiązkowy)
          </label>
          <Textarea
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            placeholder="np. wyjazd rodzinny"
            className="mb-6"
          />

          {err && (
            <Alert tone="danger" className="mb-4">
              {err}
            </Alert>
          )}

          <Button type="submit" size="lg" disabled={busy} className="self-start">
            {busy ? "Wysyłam…" : "Wyślij wniosek"}
          </Button>
        </form>

        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-signage">Historia</h2>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              // Nawigacja, nie fetch — inaczej nagłówek Content-Disposition
              // nie ma jak zadziałać i plik nie zaczyna się pobierać.
              window.location.href = "/api/report/urlopy";
            }}
          >
            <DownloadIcon className="w-4 h-4" />
            Pobierz CSV
          </Button>
        </div>

        {absences.length === 0 ? (
          <EmptyState
            title="Brak wniosków"
            description="Złóż pierwszy wniosek formularzem powyżej."
          />
        ) : (
          <TableWrap>
            <Table>
              <thead>
                <Tr>
                  <Th>Termin</Th>
                  <Th>Rodzaj</Th>
                  <Th align="right">Dni</Th>
                  <Th>Status</Th>
                  <Th>Szczegóły</Th>
                  <Th />
                </Tr>
              </thead>
              <tbody>
                {absences.map((a) => (
                  <Tr key={a.id}>
                    <Td>{rangeLabel(a.dateFrom, a.dateTo)}</Td>
                    <Td>{absenceKindLabel(a.kind)}</Td>
                    <Num>{a.workDays}</Num>
                    <Td>
                      <AbsenceBadge status={a.status} />
                    </Td>
                    <Td>
                      {a.reason && <span className="block">{a.reason}</span>}
                      {/* Kto wpisał, jeśli nie sam pracownik — L4 i urlopy
                          telefoniczne zakłada kierownik i to ma być widoczne. */}
                      {a.createdBy !== a.userID && a.createdByName && (
                        <span className="block text-xs text-muted">Wpisał: {a.createdByName}</span>
                      )}
                      {a.decidedByName && (
                        <span className="block text-xs text-muted">
                          {a.status === "approved" ? "Zatwierdził" : "Odrzucił"}: {a.decidedByName},{" "}
                          {dayjs(a.decidedAt).format("DD.MM.YYYY HH:mm")}
                        </span>
                      )}
                      {a.decisionNote && <span className="block text-xs italic">„{a.decisionNote}”</span>}
                    </Td>
                    <Td>
                      {a.status === "pending" && (
                        <Button variant="ghost" size="sm" disabled={busy} onClick={() => cancel(a.id)}>
                          Anuluj
                        </Button>
                      )}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </section>
    </BaseLayout>
  );
}
