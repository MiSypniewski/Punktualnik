import { useState } from "react";
import { useRouter } from "next/router";
import { getToken } from "next-auth/jwt";
import classNames from "classnames";
import dayjs from "dayjs";
import BaseLayout from "../../components/baseLayout";
import OvertimeBadge from "../../components/overtimeBadge";
import { Input, Select, Textarea } from "../../components/ui/field";
import Plate from "../../components/ui/plate";
import Alert from "../../components/ui/alert";
import PageHeader from "../../components/ui/pageHeader";
import EmptyState from "../../components/ui/emptyState";
import { TableWrap, Table, Th, Td, Tr } from "../../components/ui/table";
import { DownloadIcon } from "../../components/ui/icons";
import getOvertimeBalance from "../../services/getOvertimeBalance";
import getOvertimeForUser from "../../services/getOvertimeForUser";
import { OVERTIME_KINDS, KIND_KEYS, kindLabel, signedMinutes, requiresReason, decisionVerb } from "../../services/overtimeKinds";
import { formatMinutes, formatDateTime } from "../../utils";

export async function getServerSideProps(ctx) {
  const token = await getToken({ req: ctx.req });

  if (!token) {
    return { redirect: { destination: "/users/signin", permanent: false } };
  }

  // Serwisy wołamy bezpośrednio, bez skoku po HTTP — tak samo jak time/[id].js
  // i utils/eksport.js. Dane dotyczą zawsze zalogowanego, userID bierzemy
  // z tokenu, więc nie ma czego podstawić w URL-u.
  return {
    props: {
      balance: getOvertimeBalance(token.userID),
      requests: getOvertimeForUser(token.userID),
    },
  };
}

export default function Nadgodziny({ balance, requests }) {
  const router = useRouter();

  const [kind, setKind] = useState(KIND_KEYS[0]);
  const [data, setData] = useState(dayjs().format("YYYY-MM-DD"));
  const [hours, setHours] = useState("0");
  const [minutes, setMinutes] = useState("0");
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  // Odświeżenie danych z getServerSideProps bez pełnego przeładowania strony.
  const refresh = () => router.replace(router.asPath, undefined, { scroll: false });

  // Wniosek dopisujący czas do salda musi mówić, za co — wcześniejsze wyjście
  // nie musi. Reguła siedzi w services/overtimeKinds.js i jest ta sama tutaj
  // i w walidatorze na serwerze.
  const reasonRequired = requiresReason(kind);

  const submit = async (e) => {
    e.preventDefault();
    const total = Number(hours || 0) * 60 + Number(minutes || 0);

    if (!data) return setErr("Podaj datę.");
    if (total <= 0) return setErr("Podaj wymiar większy niż zero.");
    // Ten sam warunek co w services/createOvertimeRequest.js. Tutaj nie po to,
    // żeby pilnować danych — od tego jest serwer — tylko żeby nie płacić za
    // odmowę żądaniem i nie kasować wpisanego wymiaru.
    if (reasonRequired && !reason.trim()) {
      return setErr("Opisz, co dokładnie robiłeś na nadgodzinach.");
    }

    setErr("");
    setBusy(true);
    try {
      const res = await fetch("/api/overtime", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, data, hours: Number(hours || 0), minutes: Number(minutes || 0), reason }),
      });
      const body = await res.json();
      if (!res.ok) {
        setErr(body.error || "Nie udało się zapisać wniosku.");
        return;
      }
      setHours("0");
      setMinutes("0");
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
      const res = await fetch(`/api/overtime/${id}`, {
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

  const balanceClass = classNames("font-mono text-4xl font-medium tabular-nums", {
    "text-ok-strong": balance > 0,
    "text-danger-strong": balance < 0,
    "text-muted": balance === 0,
  });

  const pending = requests.filter((r) => r.status === "pending");

  return (
    <BaseLayout>
      <section>
        <PageHeader
          title="Moje nadgodziny"
          description="Saldo rośnie od zatwierdzonych wniosków o dłuższą pracę i maleje od wcześniejszych wyjść."
        />

        <Plate className="mb-8 p-4">
          <p className="text-xs font-semibold uppercase tracking-signage text-muted">Aktualne saldo</p>
          <p className={balanceClass}>{formatMinutes(balance, { withSign: true })}</p>
          <p className="mt-2 text-xs text-muted">
            Liczone tylko z wniosków zatwierdzonych przez kierownika.
            {pending.length > 0 && ` Oczekujących wniosków: ${pending.length}.`}
          </p>
        </Plate>

        <form onSubmit={submit} className="mb-10 flex flex-col">
          <h2 className="mb-4 text-sm font-bold uppercase tracking-signage">Nowe zgłoszenie</h2>

          <label className="mb-1 text-xs font-semibold uppercase tracking-signage text-muted">Rodzaj</label>
          <Select
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className="mb-4"
          >
            {KIND_KEYS.map((k) => (
              <option key={k} value={k}>
                {OVERTIME_KINDS[k].label}
                {OVERTIME_KINDS[k].sign < 0 ? " (odejmuje od salda)" : " (dodaje do salda)"}
              </option>
            ))}
          </Select>

          <label className="mb-1 text-xs font-semibold uppercase tracking-signage text-muted">Data</label>
          <Input
            type="date"
            value={data}
            onChange={(e) => setData(e.target.value)}
            className="mb-4"
          />

          <label className="mb-1 text-xs font-semibold uppercase tracking-signage text-muted">Wymiar</label>
          <div className="mb-4 flex gap-3 items-center">
            <Input
              type="number"
              min="0"
              max="23"
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              className="!w-24"
            />
            <span className="text-sm">godz.</span>
            <Input
              type="number"
              min="0"
              max="59"
              step="5"
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              className="!w-24"
            />
            <span className="text-sm">min.</span>
          </div>

          <label className="mb-1 text-xs font-semibold uppercase tracking-signage text-muted">
            Powód {reasonRequired ? "(wymagany)" : "(nieobowiązkowy)"}
          </label>
          {/* Placeholder jest PYTANIEM, nie przykładem. "np. wdrożenie u klienta"
              podpowiadało długość odpowiedzi — trzy słowa — a kierownik dostawał
              wnioski, z których nie wynikało nic poza tym, że ktoś został dłużej. */}
          <Textarea
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            required={reasonRequired}
            placeholder={
              reasonRequired
                ? "Opisz, co dokładnie robiłeś na nadgodzinach"
                : "Powód wcześniejszego wyjścia — nieobowiązkowo"
            }
            className="mb-6"
          />

          {err && (
            <Alert tone="danger" className="mb-4">
              {err}
            </Alert>
          )}

          <button
            type="submit"
            disabled={busy}
            className="self-start inline-flex items-center justify-center rounded font-medium bg-accent text-accent-ink hover:bg-accent/90 py-2.5 px-6 disabled:opacity-50"
          >
            {busy ? "Wysyłam..." : "Wyślij wniosek"}
          </button>
        </form>

        <div className="mb-4 flex flex-wrap gap-3 items-baseline">
          <h2 className="text-sm font-bold uppercase tracking-signage">Historia</h2>
          {requests.length > 0 && (
            <button
              onClick={() => {
                // Nawigacja, nie fetch — przeglądarka zapisze plik wg
                // Content-Disposition. API i tak zawęzi eksport do własnych
                // wniosków, bo rola user nie widzi cudzych.
                window.location.href = "/api/report/nadgodziny";
              }}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-accent-strong hover:underline"
            >
              <DownloadIcon className="w-3.5 h-3.5" />
              Pobierz CSV
            </button>
          )}
        </div>
        {requests.length === 0 ? (
          <EmptyState
            title="Brak zgłoszeń"
            description="Nie złożyłeś jeszcze żadnego wniosku. Formularz jest wyżej."
          />
        ) : (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>Data</Th>
                  <Th>Rodzaj</Th>
                  <Th align="right">Wymiar</Th>
                  <Th>Status</Th>
                  <Th>Szczegóły</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => (
                  <Tr key={r.id} className="align-top">
                    <Td className="font-mono tabular-nums whitespace-nowrap">{r.data}</Td>
                    <Td>{kindLabel(r.kind)}</Td>
                    <Td
                      className={classNames("font-mono text-right tabular-nums whitespace-nowrap font-medium", {
                        "text-ok-strong": signedMinutes(r) > 0,
                        "text-danger-strong": signedMinutes(r) < 0,
                      })}
                    >
                      {formatMinutes(signedMinutes(r), { withSign: true })}
                    </Td>
                    <Td>
                      <OvertimeBadge status={r.status} />
                    </Td>
                    <Td className="text-muted">
                      {r.reason && <span className="block">{r.reason}</span>}
                      {r.decidedByName && (
                        <span className="block text-xs mt-1">
                          {decisionVerb(r.status)}: {r.decidedByName},{" "}
                          {formatDateTime(r.decidedAt)}
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
