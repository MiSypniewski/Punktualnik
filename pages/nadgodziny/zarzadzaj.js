import { Fragment, useState, useEffect } from "react";
import { useRouter } from "next/router";
import { getToken } from "next-auth/jwt";
import classNames from "classnames";
import BaseLayout from "../../components/baseLayout";
import OvertimeBadge from "../../components/overtimeBadge";
import Button, { IconButton } from "../../components/ui/button";
import { Input, Select } from "../../components/ui/field";
import Plate from "../../components/ui/plate";
import Alert from "../../components/ui/alert";
import PageHeader from "../../components/ui/pageHeader";
import EmptyState from "../../components/ui/emptyState";
import FormatChoice from "../../components/ui/formatChoice";
import UserOptions from "../../components/ui/userOptions";
import { TableWrap, Table, Th, Td, Tr } from "../../components/ui/table";
import { DownloadIcon, TrashIcon } from "../../components/ui/icons";
import getOvertimeRequests, { OVERTIME_LIST_LIMIT } from "../../services/getOvertimeRequests";
import getOvertimeBalances from "../../services/getOvertimeBalances";
import getAllUsers from "../../services/getAllUsers";
import {
  kindLabel,
  signedMinutes,
  decisionVerb,
  OVERTIME_STATUSES,
  STATUS_KEYS,
} from "../../services/overtimeKinds";
import { canApproveOvertime } from "../../services/roles";
import { visibleSections } from "../../services/scope";
import { formatMinutes, formatDateTime } from "../../utils";

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

  // Wszystko, co ta strona pokazuje, jest zawężone do sekcji przypisanych
  // temu kierownikowi. Brak przypisań = pusty panel (i komunikat niżej).
  const sections = visibleSections(token);

  return {
    props: {
      pending: getOvertimeRequests({ status: "pending", sections }),
      balances: getOvertimeBalances(sections),
      // Historia przycięta do OVERTIME_LIST_LIMIT — te wiersze jadą do HTML-a
      // jako props SSR, więc nie może ich być dowolnie wiele. Komplet daje eksport.
      history: getOvertimeRequests({ ...filters, sections }),
      historyLimit: OVERTIME_LIST_LIMIT,
      users: getAllUsers(sections),
      filters,
      sections,
    },
  };
}

export default function ZarzadzajNadgodzinami({ pending, balances, history, historyLimit, users, filters, sections }) {
  const router = useRouter();

  const [note, setNote] = useState({}); // id wniosku → notatka do decyzji

  // Id wiersza historii z otwartym polem powodu — w tabeli nie ma miejsca na

  // pole tekstowe w każdym wierszu, więc rozwija się ono pod tym, który usuwamy.

  const [revoking, setRevoking] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const [userID, setUserID] = useState(filters.userID);
  const [status, setStatus] = useState(filters.status);
  const [from, setFrom] = useState(filters.from);
  const [to, setTo] = useState(filters.to);
  const [format, setFormat] = useState("csv");

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

  /**
   * Cofnięcie wniosku — jedyna akcja działająca na wniosku już rozpatrzonym.
   *
   * Wniosek nie znika z bazy, tylko dostaje status "Cofnięty" z podpisem
   * i powodem (services/revokeOvertimeRequest.js). Saldo liczy wyłącznie
   * wnioski zatwierdzone, więc poprawia się samo.
   */
  const revoke = async (id) => {
    const reason = (note[id] || "").trim();
    // Ta sama reguła stoi w API (422 reason_required) — tutaj tylko po to, żeby
    // nie wysyłać żądania, o którym z góry wiadomo, że wróci błędem.
    if (!reason) {
      setErr("Podaj powód usunięcia — trafi do historii wniosku.");
      return;
    }

    setBusy(true);
    setErr("");
    try {
      const res = await fetch(`/api/overtime/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "revoke", note: reason }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErr(
          body.error === "already_revoked"
            ? "Ten wniosek został już cofnięty (np. w innej karcie przeglądarki)."
            : body.error === "reason_required"
            ? "Podaj powód usunięcia — trafi do historii wniosku."
            : "Nie udało się usunąć wniosku."
        );
      } else {
        setRevoking(null);
      }
      await router.replace(router.asPath, undefined, { scroll: false });
    } finally {
      setBusy(false);
    }
  };

  // Zwykła nawigacja, nie fetch — przeglądarka sama zapisze plik zgodnie
  // z Content-Disposition, a ciasteczko sesji leci automatycznie (ten sam origin).
  // Tak samo działa eksport czasów w time/zarzadzaj.js.
  const download = (tryb) => {
    const qs = new URLSearchParams({ tryb, format });
    if (tryb === "wnioski") {
      if (userID) qs.set("userID", userID);
      if (status) qs.set("status", status);
      if (from) qs.set("from", from);
      if (to) qs.set("to", to);
    }
    window.location.href = `/api/report/nadgodziny?${qs.toString()}`;
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
    classNames("font-mono text-right tabular-nums font-medium whitespace-nowrap", {
      "text-ok-strong": v > 0,
      "text-danger-strong": v < 0,
      "text-muted": v === 0,
    });

  return (
    <BaseLayout>
      <section>
        <PageHeader
          title="Wnioski o nadgodziny"
          description={
            sections.length > 0 ? `Obsługiwane sekcje: ${sections.join(", ")}` : "Brak przypisanych sekcji"
          }
        />

        {sections.length === 0 && (
          <Alert tone="warn" className="mb-6">
            Nie masz przypisanej żadnej sekcji, więc panel jest pusty. Przypisanie nadaje się z linii poleceń:{" "}
            <code className="font-mono">npm run admin -- sections &lt;e-mail&gt; nazwaSekcji</code>
          </Alert>
        )}

        {err && (
          <Alert tone="danger" className="mb-4">
            {err}
          </Alert>
        )}

        <h2 className="mb-4 text-sm font-bold uppercase tracking-signage">
          Do rozpatrzenia{" "}
          {pending.length > 0 && <span className="font-mono text-accent-strong">({pending.length})</span>}
        </h2>

        {pending.length === 0 ? (
          <EmptyState
            className="mb-10"
            title="Nic nie czeka"
            description="Wszystkie wnioski z twoich sekcji są rozpatrzone."
          />
        ) : (
          <div className="mb-10 flex flex-col gap-3">
            {pending.map((r) => (
              <Plate key={r.id} className="p-3">
                <div className="flex flex-wrap gap-x-4 gap-y-1 items-baseline">
                  <span className="font-bold">
                    {r.surname} {r.name}
                  </span>
                  <span className="text-sm text-muted">{r.section}</span>
                  <span className="text-sm">{r.data}</span>
                  <span className="text-sm">{kindLabel(r.kind)}</span>
                  <span
                    className={classNames("font-medium", {
                      "text-ok-strong": signedMinutes(r) > 0,
                      "text-danger-strong": signedMinutes(r) < 0,
                    })}
                  >
                    {formatMinutes(signedMinutes(r), { withSign: true })}
                  </span>
                </div>

                {r.reason && <p className="mt-1 text-sm text-muted">{r.reason}</p>}

                <div className="mt-3 flex flex-wrap gap-2 items-center">
                  <Input
                    type="text"
                    placeholder="Notatka do decyzji (przy usuwaniu obowiązkowa)"
                    maxLength={300}
                    value={note[r.id] || ""}
                    onChange={(e) => setNote({ ...note, [r.id]: e.target.value })}
                    className="flex-grow w-auto min-w-[12rem]"
                  />
                  <button
                    onClick={() => decide(r.id, "approve")}
                    disabled={busy}
                    className="inline-flex items-center justify-center rounded font-medium bg-ok text-ok-ink hover:bg-ok/90 py-2 px-6 text-sm disabled:opacity-50"
                  >
                    Zatwierdź
                  </button>
                  <button
                    onClick={() => decide(r.id, "reject")}
                    disabled={busy}
                    className="inline-flex items-center justify-center rounded font-medium bg-danger text-danger-ink hover:bg-danger/90 py-2 px-6 text-sm disabled:opacity-50"
                  >
                    Odrzuć
                  </button>
                  {/* Usunięcie, nie decyzja — stąd kosz obok dwóch pełnych
                      przycisków, a nie trzeci taki sam: zgłoszenie wpisane
                      przez pomyłkę albo "dla zabawy" znika z obiegu zamiast
                      czekać na odrzucenie, którego nikt nie chciał wydawać.
                      Powód jest obowiązkowy, więc przy pustej notatce kosz
                      jest nieaktywny, a tytuł mówi, czego brakuje. */}
                  <IconButton
                    className="h-9 w-9"
                    onClick={() => revoke(r.id)}
                    disabled={busy || !(note[r.id] || "").trim()}
                    label={
                      (note[r.id] || "").trim()
                        ? "Usuń wniosek z obiegu"
                        : "Podaj powód w polu obok, żeby usunąć wniosek"
                    }
                  >
                    <TrashIcon />
                  </IconButton>
                </div>
              </Plate>
            ))}
          </div>
        )}

        <h2 className="mb-4 text-sm font-bold uppercase tracking-signage">Salda pracowników</h2>
        <TableWrap className="mb-10">
          <Table>
            <thead>
              <tr>
                <Th>Pracownik</Th>
                <Th>Sekcja</Th>
                <Th align="right">Saldo</Th>
                <Th align="right">Oczekujące</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {balances.map((u) => (
                <Tr key={u.id}>
                  <Td>
                    {u.surname} {u.name}
                  </Td>
                  <Td className="text-muted">{u.section}</Td>
                  <Td className={balanceClass(u.balance)}>{formatMinutes(u.balance, { withSign: true })}</Td>
                  <Td className="font-mono text-right tabular-nums text-muted">{u.pendingCount || ""}</Td>
                  <Td className="text-right">
                    <button
                      onClick={() => router.push(`/nadgodziny/zarzadzaj?userID=${u.id}`)}
                      className="text-xs font-medium text-accent-strong hover:underline"
                    >
                      Historia
                    </button>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>

        <h2 className="mb-4 text-sm font-bold uppercase tracking-signage">Historia wniosków</h2>

        <form onSubmit={applyFilters} className="mb-4 flex flex-wrap gap-3 items-end">
          <div className="flex flex-col">
            <label className="mb-1 text-xs font-semibold uppercase tracking-signage text-muted">Pracownik</label>
            <Select
              value={userID}
              onChange={(e) => setUserID(e.target.value)}
              
            >
              <option value="">— wszyscy —</option>
              <UserOptions users={users} includeInactive showSection />
            </Select>
          </div>

          <div className="flex flex-col">
            <label className="mb-1 text-xs font-semibold uppercase tracking-signage text-muted">Status</label>
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              
            >
              <option value="">— wszystkie —</option>
              {Object.entries(OVERTIME_STATUSES).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </Select>
          </div>

          <div className="flex flex-col">
            <label className="mb-1 text-xs font-semibold uppercase tracking-signage text-muted">Od</label>
            <Input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              
            />
          </div>

          <div className="flex flex-col">
            <label className="mb-1 text-xs font-semibold uppercase tracking-signage text-muted">Do</label>
            <Input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              
            />
          </div>

          <Button type="submit">Filtruj</Button>
          <Button variant="ghost" onClick={() => router.push("/nadgodziny/zarzadzaj")}>
            Wyczyść
          </Button>
          <FormatChoice value={format} onChange={setFormat} />
          <Button variant="secondary" onClick={() => download("wnioski")}>
            <DownloadIcon />
            Pobierz
          </Button>
        </form>

        {history.length >= historyLimit && (
          <Alert tone="warn" className="mb-4">
            Lista jest przycięta do {historyLimit} najnowszych wniosków. Zawęź zakres dat
            albo pobierz plik — eksport obejmuje komplet.
          </Alert>
        )}

        <p className="mb-4 text-xs text-muted">
          „Pobierz” eksportuje listę wniosków wg ustawionych wyżej filtrów.{" "}
          <button type="button" onClick={() => download("salda")} className="font-medium text-accent-strong hover:underline">
            Pobierz zestawienie sald wszystkich pracowników
          </button>
          .
        </p>

        {history.length === 0 ? (
          <EmptyState
            title="Brak wniosków"
            description="Dla tych filtrów nie ma nic do pokazania. Zdejmij filtry albo poszerz zakres dat."
          />
        ) : (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>Data</Th>
                  <Th>Pracownik</Th>
                  <Th>Rodzaj</Th>
                  <Th align="right">Wymiar</Th>
                  <Th>Status</Th>
                  <Th>Szczegóły</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {history.map((r) => (
                  <Fragment key={r.id}>
                  <Tr className="align-top">
                    <Td className="font-mono tabular-nums whitespace-nowrap">{r.data}</Td>
                    <Td className="whitespace-nowrap">
                      {r.surname} {r.name}
                    </Td>
                    <Td>{kindLabel(r.kind)}</Td>
                    <Td className={balanceClass(signedMinutes(r))}>
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
                      {/* Wniosek już cofnięty nie ma czego cofać drugi raz —
                          API i tak odpowiedziałoby 409. */}
                      {r.status !== "revoked" && (
                        <IconButton
                          disabled={busy}
                          label={revoking === r.id ? "Zrezygnuj z usuwania" : "Usuń wniosek"}
                          onClick={() => setRevoking(revoking === r.id ? null : r.id)}
                        >
                          <TrashIcon />
                        </IconButton>
                      )}
                    </Td>
                  </Tr>

                  {/* Pole powodu rozwija się POD wierszem, a nie w kolumnie:
                      przy siedmiu kolumnach nie ma na nie miejsca, a powód
                      bywa zdaniem, nie słowem. */}
                  {revoking === r.id && (
                    <tr className="border-b border-line-subtle bg-raised">
                      <td colSpan={7} className="p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <Input
                            type="text"
                            autoFocus
                            placeholder="Powód usunięcia (obowiązkowy)"
                            maxLength={300}
                            value={note[r.id] || ""}
                            onChange={(e) => setNote({ ...note, [r.id]: e.target.value })}
                            className="flex-grow w-auto min-w-[12rem]"
                          />
                          <Button
                            variant="danger"
                            disabled={busy || !(note[r.id] || "").trim()}
                            onClick={() => revoke(r.id)}
                          >
                            Usuń wniosek
                          </Button>
                          <Button variant="ghost" disabled={busy} onClick={() => setRevoking(null)}>
                            Anuluj
                          </Button>
                        </div>
                        {r.status === "approved" && (
                          <p className="mt-2 text-xs text-muted">
                            Wniosek jest zatwierdzony — po usunięciu jego wymiar zniknie z salda
                            pracownika.
                          </p>
                        )}
                      </td>
                    </tr>
                  )}
                  </Fragment>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </section>
    </BaseLayout>
  );
}
