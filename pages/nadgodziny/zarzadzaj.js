import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import { getToken } from "next-auth/jwt";
import classNames from "classnames";
import dayjs from "dayjs";
import BaseLayout from "../../components/baseLayout";
import OvertimeBadge from "../../components/overtimeBadge";
import getOvertimeRequests from "../../services/getOvertimeRequests";
import getOvertimeBalances from "../../services/getOvertimeBalances";
import getAllUsers from "../../services/getAllUsers";
import { kindLabel, signedMinutes, OVERTIME_STATUSES, STATUS_KEYS } from "../../services/overtimeKinds";
import { canApproveOvertime } from "../../services/roles";
import { formatMinutes } from "../../utils";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Dwuwarstwowe zabezpieczenie, tak jak przy eksporcie CSV: tu blokujemy wejście
// na stronę, a /api/overtime niezależnie blokuje same dane i decyzje.
export async function getServerSideProps(ctx) {
  const token = await getToken({ req: ctx.req });

  if (!token) {
    return { redirect: { destination: "/users/signin", permanent: false } };
  }
  if (!canApproveOvertime(token.role)) {
    return { notFound: true };
  }

  // Filtry historii żyją w query stringu, więc widok da się odświeżyć i zalinkować.
  const { userID = "", status = "", from = "", to = "" } = ctx.query;
  const filters = {
    userID: /^\d+$/.test(userID) ? userID : "",
    status: STATUS_KEYS.includes(status) ? status : "",
    from: DATE_RE.test(from) ? from : "",
    to: DATE_RE.test(to) ? to : "",
  };

  return {
    props: {
      pending: getOvertimeRequests({ status: "pending" }),
      balances: getOvertimeBalances(),
      history: getOvertimeRequests(filters),
      users: getAllUsers(),
      filters,
    },
  };
}

export default function ZarzadzajNadgodzinami({ pending, balances, history, users, filters }) {
  const router = useRouter();

  const [note, setNote] = useState({}); // id wniosku → notatka do decyzji
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const [userID, setUserID] = useState(filters.userID);
  const [status, setStatus] = useState(filters.status);
  const [from, setFrom] = useState(filters.from);
  const [to, setTo] = useState(filters.to);

  // Przy zmianie samego query stringu (np. klik „Historia" w tabeli sald)
  // Next nie montuje komponentu od nowa, więc useState zostałby z poprzednimi
  // wartościami i pola filtrów pokazywałyby co innego niż faktycznie widać.
  useEffect(() => {
    setUserID(filters.userID);
    setStatus(filters.status);
    setFrom(filters.from);
    setTo(filters.to);
  }, [filters.userID, filters.status, filters.from, filters.to]);

  const decide = async (id, action) => {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch(`/api/overtime/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, note: note[id] || "" }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErr(
          body.error === "already_decided"
            ? "Ten wniosek został już rozpatrzony (np. w innej karcie przeglądarki)."
            : "Nie udało się zapisać decyzji."
        );
      }
      await router.replace(router.asPath, undefined, { scroll: false });
    } finally {
      setBusy(false);
    }
  };

  const applyFilters = (e) => {
    e.preventDefault();
    const qs = new URLSearchParams();
    if (userID) qs.set("userID", userID);
    if (status) qs.set("status", status);
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    router.push(`/nadgodziny/zarzadzaj?${qs.toString()}`);
  };

  const balanceClass = (v) =>
    classNames("text-right font-medium whitespace-nowrap", {
      "text-green-600": v > 0,
      "text-red-600": v < 0,
      "text-gray-500": v === 0,
    });

  return (
    <BaseLayout>
      <section className="mx-auto p-4 mt-6 mb-8 max-w-5xl">
        <h1 className="text-2xl font-bold mb-6">Nadgodziny — panel kierownika</h1>

        {err && <p className="mb-4 p-2 bg-red-100 text-red-700 text-sm rounded">{err}</p>}

        <h2 className="text-xl font-bold mb-4">
          Do rozpatrzenia {pending.length > 0 && <span className="text-indigo-600">({pending.length})</span>}
        </h2>

        {pending.length === 0 ? (
          <p className="mb-10 text-gray-500">Brak wniosków oczekujących na decyzję.</p>
        ) : (
          <div className="mb-10 flex flex-col gap-3">
            {pending.map((r) => (
              <div key={r.id} className="p-3 border border-indigo-200 rounded shadow-sm">
                <div className="flex flex-wrap gap-x-4 gap-y-1 items-baseline">
                  <span className="font-bold">
                    {r.surname} {r.name}
                  </span>
                  <span className="text-sm text-gray-500">{r.section}</span>
                  <span className="text-sm">{r.data}</span>
                  <span className="text-sm">{kindLabel(r.kind)}</span>
                  <span
                    className={classNames("font-medium", {
                      "text-green-600": signedMinutes(r) > 0,
                      "text-red-600": signedMinutes(r) < 0,
                    })}
                  >
                    {formatMinutes(signedMinutes(r), { withSign: true })}
                  </span>
                </div>

                {r.reason && <p className="mt-1 text-sm text-gray-600">{r.reason}</p>}

                <div className="mt-3 flex flex-wrap gap-2 items-center">
                  <input
                    type="text"
                    placeholder="Notatka do decyzji (opcjonalna)"
                    value={note[r.id] || ""}
                    onChange={(e) => setNote({ ...note, [r.id]: e.target.value })}
                    className="p-2 border border-gray-300 rounded text-sm flex-grow min-w-[12rem]"
                  />
                  <button
                    onClick={() => decide(r.id, "approve")}
                    disabled={busy}
                    className="text-white bg-green-600 hover:bg-green-700 disabled:bg-gray-400 border-0 py-2 px-6 rounded"
                  >
                    Zatwierdź
                  </button>
                  <button
                    onClick={() => decide(r.id, "reject")}
                    disabled={busy}
                    className="text-white bg-red-600 hover:bg-red-700 disabled:bg-gray-400 border-0 py-2 px-6 rounded"
                  >
                    Odrzuć
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <h2 className="text-xl font-bold mb-4">Salda pracowników</h2>
        <div className="mb-10 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b border-gray-300">
                <th className="py-2 pr-3">Pracownik</th>
                <th className="py-2 pr-3">Sekcja</th>
                <th className="py-2 pr-3 text-right">Saldo</th>
                <th className="py-2 pr-3 text-right">Oczekujące</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {balances.map((u) => (
                <tr key={u.id} className="border-b border-gray-100">
                  <td className="py-2 pr-3">
                    {u.surname} {u.name}
                  </td>
                  <td className="py-2 pr-3 text-gray-500">{u.section}</td>
                  <td className={`py-2 pr-3 ${balanceClass(u.balance)}`}>
                    {formatMinutes(u.balance, { withSign: true })}
                  </td>
                  <td className="py-2 pr-3 text-right text-gray-500">{u.pendingCount || ""}</td>
                  <td className="py-2 text-right">
                    <button
                      onClick={() => router.push(`/nadgodziny/zarzadzaj?userID=${u.id}`)}
                      className="text-xs text-indigo-600 hover:underline"
                    >
                      Historia
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h2 className="text-xl font-bold mb-4">Historia wniosków</h2>

        <form onSubmit={applyFilters} className="mb-4 flex flex-wrap gap-3 items-end">
          <div className="flex flex-col">
            <label className="mb-1 text-sm font-medium">Pracownik</label>
            <select
              value={userID}
              onChange={(e) => setUserID(e.target.value)}
              className="p-2 border border-indigo-400 rounded"
            >
              <option value="">— wszyscy —</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.surname} {u.name} ({u.section})
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col">
            <label className="mb-1 text-sm font-medium">Status</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="p-2 border border-indigo-400 rounded"
            >
              <option value="">— wszystkie —</option>
              {Object.entries(OVERTIME_STATUSES).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col">
            <label className="mb-1 text-sm font-medium">Od</label>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="p-2 border border-indigo-400 rounded"
            />
          </div>

          <div className="flex flex-col">
            <label className="mb-1 text-sm font-medium">Do</label>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="p-2 border border-indigo-400 rounded"
            />
          </div>

          <button
            type="submit"
            className="text-white bg-indigo-500 border-0 py-2 px-6 hover:bg-indigo-600 rounded"
          >
            Filtruj
          </button>
          <button
            type="button"
            onClick={() => router.push("/nadgodziny/zarzadzaj")}
            className="py-2 px-4 text-sm text-gray-600 hover:underline"
          >
            Wyczyść
          </button>
        </form>

        {history.length === 0 ? (
          <p className="text-gray-500">Brak wniosków dla wybranych filtrów.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-gray-300">
                  <th className="py-2 pr-3">Data</th>
                  <th className="py-2 pr-3">Pracownik</th>
                  <th className="py-2 pr-3">Rodzaj</th>
                  <th className="py-2 pr-3 text-right">Wymiar</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Szczegóły</th>
                </tr>
              </thead>
              <tbody>
                {history.map((r) => (
                  <tr key={r.id} className="border-b border-gray-100 align-top">
                    <td className="py-2 pr-3 whitespace-nowrap">{r.data}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">
                      {r.surname} {r.name}
                    </td>
                    <td className="py-2 pr-3">{kindLabel(r.kind)}</td>
                    <td className={`py-2 pr-3 ${balanceClass(signedMinutes(r))}`}>
                      {formatMinutes(signedMinutes(r), { withSign: true })}
                    </td>
                    <td className="py-2 pr-3">
                      <OvertimeBadge status={r.status} />
                    </td>
                    <td className="py-2 pr-3 text-gray-600">
                      {r.reason && <span className="block">{r.reason}</span>}
                      {r.decidedByName && (
                        <span className="block text-xs mt-1">
                          {r.status === "approved" ? "Zatwierdził" : "Odrzucił"}: {r.decidedByName},{" "}
                          {dayjs(r.decidedAt).format("DD.MM.YYYY HH:mm")}
                        </span>
                      )}
                      {r.decisionNote && <span className="block text-xs italic mt-1">„{r.decisionNote}”</span>}
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
