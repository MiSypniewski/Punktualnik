import { useState } from "react";
import { useRouter } from "next/router";
import { getActiveToken } from "../../services/session";
import dayjs from "dayjs";
import BaseLayout from "../../components/baseLayout";
import OvertimeBadge from "../../components/overtimeBadge";
import { Alert, Button, Checkbox, EmptyState, Field, Input, PageHeader, Plate, Textarea } from "../../components/ui";
import { TableWrap, Table, Th, Td, Tr } from "../../components/ui/table";
import { getTodayCard, listForUser } from "../../services/cardCorrections";
import { todayStamp } from "../../services/manageTime";
import { canTrackTasks } from "../../services/roles";
import { decisionVerb } from "../../services/overtimeKinds";
import { CORRECTION_REASON_MAX, formatCardSpan, formatDate, formatDateTime } from "../../utils";

// Zgłoszenie korekty DZISIEJSZEJ karty pracy (services/cardCorrections.js).
//
// Pracownik nie ma innego widoku własnej karty niż kafelek na kiosku, więc
// strona zaczyna się od tego, co jest teraz w ewidencji — formularz poprawia
// TEN stan, a nie godziny wpisane z pamięci w próżnię.

export async function getServerSideProps(ctx) {
  const token = await getActiveToken(ctx.req);
  if (!token) {
    return { redirect: { destination: "/users/signin", permanent: false } };
  }
  // Kiosk to konto współdzielone — zgłoszenie nie miałoby właściciela.
  if (!canTrackTasks(token.role)) {
    return { redirect: { destination: `/time/${token.section}`, permanent: false } };
  }

  // "Dziś" wyznacza serwer, tą samą kotwicą co kiosk (todayStamp) — zegar
  // przeglądarki mógłby wskazać inny dzień niż ten, pod którym leży karta.
  return {
    props: {
      day: todayStamp().slice(0, 10),
      today: getTodayCard(token.userID),
      requests: listForUser(token.userID),
    },
  };
}

const ERRORS = {
  cannot_cancel: "Nie udało się anulować — zgłoszenie mogło zostać już rozpatrzone.",
};

export default function Korekty({ day, today, requests }) {
  const router = useRouter();

  // Formularz startuje od stanu karty: najczęstsza poprawka dotyczy jednej
  // godziny, a nie wszystkich naraz. Bez karty — "praca trwa", bo tak wygląda
  // typowy przypadek: ktoś przyszedł, nie odbił się i właśnie to zauważył.
  const [start, setStart] = useState(today?.startHm ?? "");
  const [open, setOpen] = useState(today ? today.open : true);
  const [end, setEnd] = useState(today?.endHm ?? dayjs().format("HH:mm"));
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = () => router.replace(router.asPath, undefined, { scroll: false });
  const pending = requests.find((r) => r.status === "pending" && r.day === day);

  const submit = async (e) => {
    e.preventDefault();
    if (!start) return setErr("Podaj godzinę wejścia.");
    if (!open && !end) return setErr("Podaj godzinę wyjścia albo zaznacz, że praca jeszcze trwa.");
    if (!reason.trim()) return setErr("Napisz krótko, co się stało.");

    setErr("");
    setBusy(true);
    try {
      const res = await fetch("/api/corrections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ start, end: open ? null : end, open, reason }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(body.message || "Nie udało się wysłać zgłoszenia.");
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
    try {
      const res = await fetch(`/api/corrections/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setErr(ERRORS[body.error] || "Nie udało się anulować zgłoszenia.");
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <BaseLayout>
      <section>
        <PageHeader
          title="Korekta karty"
          description="Odbiłeś wyjście za wcześnie albo zapomniałeś odbić wejście? Zgłoś poprawne godziny dzisiejszej karty — zmiana wejdzie po zatwierdzeniu przez kierownika."
        />

        <Plate className="mb-8 p-4">
          <p className="text-xs font-semibold uppercase tracking-signage text-muted">
            Dzisiejsza karta · {formatDate(day)}
          </p>
          <p className="font-mono text-3xl font-medium tabular-nums">
            {formatCardSpan(today?.startHm, today?.endHm, today?.open)}
          </p>
          {today?.autoClosed && <p className="mt-2 text-xs text-muted">Kartę domknął system.</p>}
        </Plate>

        {pending ? (
          <Alert tone="info" className="mb-10">
            Zgłoszenie „{formatCardSpan(pending.startHm, pending.endHm, pending.open)}” czeka na decyzję kierownika.
            Jeśli chcesz zgłosić inne godziny, najpierw je anuluj (niżej, w historii).
          </Alert>
        ) : (
          <form onSubmit={submit} className="mb-10 flex flex-col gap-4 max-w-md">
            <h2 className="text-sm font-bold uppercase tracking-signage">Poprawne godziny</h2>

            <Field label="Wejście" htmlFor="korekta-start">
              <Input
                id="korekta-start"
                type="time"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                className="!w-36"
                required
              />
            </Field>

            <Checkbox
              label="Praca jeszcze trwa"
              checked={open}
              onChange={(e) => setOpen(e.target.checked)}
            />

            {!open && (
              <Field label="Wyjście" htmlFor="korekta-end">
                <Input
                  id="korekta-end"
                  type="time"
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                  className="!w-36"
                  required
                />
              </Field>
            )}

            <Field label="Co się stało" htmlFor="korekta-reason">
              <Textarea
                id="korekta-reason"
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={CORRECTION_REASON_MAX}
                required
                placeholder="np. przypadkiem dotknąłem kafelka, pracuję dalej"
              />
            </Field>

            {err && <Alert tone="danger">{err}</Alert>}

            <Button type="submit" size="lg" disabled={busy} className="self-start">
              {busy ? "Wysyłam..." : "Wyślij zgłoszenie"}
            </Button>
          </form>
        )}

        {pending && err && (
          <Alert tone="danger" className="mb-4">
            {err}
          </Alert>
        )}

        <h2 className="mb-4 text-sm font-bold uppercase tracking-signage">Historia</h2>
        {requests.length === 0 ? (
          <EmptyState title="Brak zgłoszeń" description="Nie zgłaszałeś jeszcze korekty karty." />
        ) : (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>Dzień</Th>
                  <Th>Było</Th>
                  <Th>Zgłoszone</Th>
                  <Th>Status</Th>
                  <Th>Szczegóły</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => (
                  <Tr key={r.id} className="align-top">
                    <Td className="font-mono tabular-nums whitespace-nowrap">{r.day}</Td>
                    <Td className="font-mono tabular-nums whitespace-nowrap text-muted">
                      {formatCardSpan(r.beforeStartHm, r.beforeEndHm, r.beforeOpen)}
                    </Td>
                    <Td className="font-mono tabular-nums whitespace-nowrap font-medium">
                      {formatCardSpan(r.startHm, r.endHm, r.open)}
                    </Td>
                    <Td>
                      <OvertimeBadge status={r.status} />
                    </Td>
                    <Td className="text-muted">
                      <span className="block">{r.reason}</span>
                      {r.decidedByName && (
                        <span className="block text-xs mt-1">
                          {decisionVerb(r.status)}: {r.decidedByName}, {formatDateTime(r.decidedAt)}
                        </span>
                      )}
                      {r.decisionNote && <span className="block text-xs italic mt-1">„{r.decisionNote}”</span>}
                    </Td>
                    <Td className="text-right">
                      {r.status === "pending" && (
                        <button
                          onClick={() => cancel(r.id)}
                          disabled={busy}
                          className="text-xs font-medium text-danger-strong hover:underline disabled:text-faint"
                        >
                          Anuluj
                        </button>
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
