import { useState } from "react";
import { useRouter } from "next/router";
import { getToken } from "next-auth/jwt";
import classNames from "classnames";
import dayjs from "dayjs";
import BaseLayout from "../../components/baseLayout";
import OvertimeBadge from "../../components/overtimeBadge";
import getOvertimeBalance from "../../services/getOvertimeBalance";
import getOvertimeForUser from "../../services/getOvertimeForUser";
import { OVERTIME_KINDS, KIND_KEYS, kindLabel, signedMinutes } from "../../services/overtimeKinds";
import { formatMinutes } from "../../utils";

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

  const submit = async (e) => {
    e.preventDefault();
    const total = Number(hours || 0) * 60 + Number(minutes || 0);

    if (!data) return setErr("Podaj datę.");
    if (total <= 0) return setErr("Podaj wymiar większy niż zero.");

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

  const balanceClass = classNames("text-4xl font-bold", {
    "text-green-600 dark:text-green-300": balance > 0,
    "text-red-600 dark:text-red-300": balance < 0,
    "text-muted": balance === 0,
  });

  const pending = requests.filter((r) => r.status === "pending");

  return (
    <BaseLayout>
      <section className="mx-auto p-4 mt-6 mb-8 max-w-3xl">
        <h1 className="text-2xl font-bold mb-6">Moje nadgodziny</h1>

        <div className="mb-8 p-4 border border-indigo-200 dark:border-indigo-500/40 rounded shadow-sm">
          <p className="text-sm text-muted mb-1">Aktualne saldo</p>
          <p className={balanceClass}>{formatMinutes(balance, { withSign: true })}</p>
          <p className="text-xs text-muted mt-2">
            Liczone tylko z wniosków zatwierdzonych przez kierownika.
            {pending.length > 0 && ` Oczekujących wniosków: ${pending.length}.`}
          </p>
        </div>

        <form onSubmit={submit} className="mb-10 flex flex-col">
          <h2 className="text-xl font-bold mb-4">Nowe zgłoszenie</h2>

          <label className="mb-1 text-sm font-medium">Rodzaj</label>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className="mb-4 p-2 border border-indigo-400 rounded"
          >
            {KIND_KEYS.map((k) => (
              <option key={k} value={k}>
                {OVERTIME_KINDS[k].label}
                {OVERTIME_KINDS[k].sign < 0 ? " (odejmuje od salda)" : " (dodaje do salda)"}
              </option>
            ))}
          </select>

          <label className="mb-1 text-sm font-medium">Data</label>
          <input
            type="date"
            value={data}
            onChange={(e) => setData(e.target.value)}
            className="mb-4 p-2 border border-indigo-400 rounded"
          />

          <label className="mb-1 text-sm font-medium">Wymiar</label>
          <div className="mb-4 flex gap-3 items-center">
            <input
              type="number"
              min="0"
              max="23"
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              className="p-2 border border-indigo-400 rounded w-24"
            />
            <span className="text-sm">godz.</span>
            <input
              type="number"
              min="0"
              max="59"
              step="5"
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              className="p-2 border border-indigo-400 rounded w-24"
            />
            <span className="text-sm">min.</span>
          </div>

          <label className="mb-1 text-sm font-medium">Powód</label>
          <textarea
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            placeholder="np. wdrożenie u klienta"
            className="mb-6 p-2 border border-indigo-400 rounded"
          />

          {err && <p className="mb-4 text-red-600 dark:text-red-300 text-sm">{err}</p>}

          <button
            type="submit"
            disabled={busy}
            className="self-start text-white bg-indigo-500 border-0 py-2 px-8 hover:bg-indigo-600 disabled:bg-faint rounded text-lg"
          >
            {busy ? "Wysyłam..." : "Wyślij wniosek"}
          </button>
        </form>

        <div className="mb-4 flex flex-wrap gap-3 items-baseline">
          <h2 className="text-xl font-bold">Historia</h2>
          {requests.length > 0 && (
            <button
              onClick={() => {
                // Nawigacja, nie fetch — przeglądarka zapisze plik wg
                // Content-Disposition. API i tak zawęzi eksport do własnych
                // wniosków, bo rola user nie widzi cudzych.
                window.location.href = "/api/report/nadgodziny";
              }}
              className="text-sm text-indigo-600 dark:text-indigo-300 hover:underline"
            >
              Pobierz CSV
            </button>
          )}
        </div>
        {requests.length === 0 ? (
          <p className="text-muted">Brak zgłoszeń.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-line">
                  <th className="py-2 pr-3">Data</th>
                  <th className="py-2 pr-3">Rodzaj</th>
                  <th className="py-2 pr-3 text-right">Wymiar</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Szczegóły</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => (
                  <tr key={r.id} className="border-b border-line-subtle align-top">
                    <td className="py-2 pr-3 whitespace-nowrap">{r.data}</td>
                    <td className="py-2 pr-3">{kindLabel(r.kind)}</td>
                    <td
                      className={classNames("py-2 pr-3 text-right whitespace-nowrap font-medium", {
                        "text-green-600 dark:text-green-300": signedMinutes(r) > 0,
                        "text-red-600 dark:text-red-300": signedMinutes(r) < 0,
                      })}
                    >
                      {formatMinutes(signedMinutes(r), { withSign: true })}
                    </td>
                    <td className="py-2 pr-3">
                      <OvertimeBadge status={r.status} />
                    </td>
                    <td className="py-2 pr-3 text-muted">
                      {r.reason && <span className="block">{r.reason}</span>}
                      {r.decidedByName && (
                        <span className="block text-xs mt-1">
                          {r.status === "approved" ? "Zatwierdził" : "Odrzucił"}: {r.decidedByName},{" "}
                          {dayjs(r.decidedAt).format("DD.MM.YYYY HH:mm")}
                        </span>
                      )}
                      {r.decisionNote && <span className="block text-xs italic mt-1">„{r.decisionNote}”</span>}
                    </td>
                    <td className="py-2 text-right">
                      {r.status === "pending" && (
                        <button
                          onClick={() => cancel(r.id)}
                          disabled={busy}
                          className="text-xs text-red-600 dark:text-red-300 hover:underline disabled:text-faint"
                        >
                          Anuluj
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </BaseLayout>
  );
}
