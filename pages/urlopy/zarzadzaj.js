import { Fragment, useState, useEffect } from "react";
import { useRouter } from "next/router";
import { getToken } from "next-auth/jwt";
import classNames from "classnames";
import dayjs from "dayjs";
import BaseLayout from "../../components/baseLayout";
import AbsenceBadge from "../../components/absenceBadge";
import { Input, Select, Textarea } from "../../components/ui/field";
import Button, { IconButton } from "../../components/ui/button";
import Plate from "../../components/ui/plate";
import Alert from "../../components/ui/alert";
import PageHeader from "../../components/ui/pageHeader";
import EmptyState from "../../components/ui/emptyState";
import { TableWrap, Table, Th, Td, Tr, Num } from "../../components/ui/table";
import { TrashIcon } from "../../components/ui/icons";
import { getAbsences, ABSENCE_LIST_LIMIT } from "../../services/getAbsences";
import { getLeaveBalances } from "../../services/leaveBalance";
import getAllUsers from "../../services/getAllUsers";
import {
  ABSENCE_KINDS,
  ABSENCE_KIND_KEYS,
  ABSENCE_STATUSES,
  ABSENCE_STATUS_KEYS,
  absenceKindLabel,
  decisionVerb,
} from "../../services/absenceKinds";
import { countWorkingDays, isWorkingDay } from "../../services/workingDays";
import { canApproveLeave } from "../../services/roles";
import { visibleSections } from "../../services/scope";
import { now as appNow } from "../../services/workday";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function getServerSideProps(ctx) {
  const token = await getToken({ req: ctx.req });

  if (!token) {
    return { redirect: { destination: "/users/signin", permanent: false } };
  }
  // notFound, nie 403: dla pracownika ta strona ma nie istnieć, a nie odmawiać.
  if (!canApproveLeave(token.role)) {
    return { notFound: true };
  }

  // Filtry żyją w query stringu, więc widok da się odświeżyć i zalinkować —
  // ten sam wzorzec co w panelu nadgodzin i w raporcie zadań.
  const { userID = "", kind = "", status = "", from = "", to = "", year = "" } = ctx.query;
  const currentYear = appNow().year();

  const filters = {
    userID: /^\d+$/.test(userID) ? userID : "",
    kind: ABSENCE_KIND_KEYS.includes(kind) ? kind : "",
    status: ABSENCE_STATUS_KEYS.includes(status) ? status : "",
    from: DATE_RE.test(from) ? from : "",
    to: DATE_RE.test(to) ? to : "",
  };
  const balanceYear = /^\d{4}$/.test(year) ? Number(year) : currentYear;
  const sections = visibleSections(token);

  return {
    props: {
      pending: getAbsences({ status: "pending", sections }),
      balances: getLeaveBalances(sections, balanceYear),
      history: getAbsences({ ...filters, sections }),
      historyLimit: ABSENCE_LIST_LIMIT,
      users: getAllUsers(sections),
      filters,
      balanceYear,
      currentYear,
      sections,
    },
  };
}

const dayWord = (n) => (n === 1 ? "dzień" : "dni");

const rangeLabel = (from, to) => {
  const a = dayjs(from).format("DD.MM.YYYY");
  const b = dayjs(to).format("DD.MM.YYYY");
  return a === b ? a : `${a} – ${b}`;
};

const nextWorkingDay = () => {
  let d = dayjs();
  for (let i = 0; i < 14 && !isWorkingDay(d); i += 1) d = d.add(1, "day");
  return d.format("YYYY-MM-DD");
};

export default function Nieobecnosci({
  pending,
  balances,
  history,
  historyLimit,
  users,
  filters,
  balanceYear,
  currentYear,
  sections,
}) {
  const router = useRouter();
  const refresh = () => router.replace(router.asPath, undefined, { scroll: false });

  const [note, setNote] = useState({}); // id wniosku → notatka do decyzji

  // Id wiersza historii z otwartym polem powodu — pole tekstowe w każdym

  // wierszu tabeli byłoby nie do czytania, więc rozwija się pod tym usuwanym.

  const [revoking, setRevoking] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const [fUser, setFUser] = useState(filters.userID);
  const [fKind, setFKind] = useState(filters.kind);
  const [fStatus, setFStatus] = useState(filters.status);
  const [fFrom, setFFrom] = useState(filters.from);
  const [fTo, setFTo] = useState(filters.to);

  // Przy zmianie samego query stringu Next NIE montuje komponentu od nowa,
  // więc pola filtrów trzeba zsynchronizować ręcznie — inaczej po kliknięciu
  // „Wyczyść” zostają wypełnione starymi wartościami.
  useEffect(() => {
    setFUser(filters.userID);
    setFKind(filters.kind);
    setFStatus(filters.status);
    setFFrom(filters.from);
    setFTo(filters.to);
  }, [filters.userID, filters.kind, filters.status, filters.from, filters.to]);

  const call = async (url, body, blad) => {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch(url, {
        method: body.action ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const odp = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(odp.message || blad(odp.error));
        return false;
      }
      await refresh();
      return true;
    } finally {
      setBusy(false);
    }
  };

  const decide = (id, action) =>
    call(`/api/absences/${id}`, { action, note: note[id] || "" }, (code) =>
      code === "already_decided"
        ? "Ten wniosek został już rozpatrzony (np. w innej karcie przeglądarki)."
        : "Nie udało się zapisać decyzji."
    );

  /**
   * Cofnięcie nieobecności przez kierownika.
   *
   * Najczęstszy przypadek: pracownik rezygnuje z ZATWIERDZONEGO urlopu. Sam go
   * już nie anuluje (to działa tylko na wniosku oczekującym), a bez tej akcji
   * pula dni zostawałaby pomniejszona na stałe. Wniosek nie znika z bazy —
   * dostaje status "Cofnięty" z podpisem i powodem.
   */
  const revoke = async (id) => {
    const reason = (note[id] || "").trim();
    // Ta sama reguła stoi w API (422 reason_required); tutaj po to, żeby nie
    // wysyłać żądania, o którym z góry wiadomo, że wróci błędem.
    if (!reason) {
      setErr("Podaj powód usunięcia — trafi do historii wniosku.");
      return;
    }

    const ok = await call(`/api/absences/${id}`, { action: "revoke", note: reason }, (code) =>
      code === "already_revoked"
        ? "Ta nieobecność została już usunięta (np. w innej karcie przeglądarki)."
        : code === "reason_required"
        ? "Podaj powód usunięcia — trafi do historii wniosku."
        : "Nie udało się usunąć nieobecności."
    );
    if (ok) setRevoking(null);
  };

  const applyFilters = (e) => {
    e.preventDefault();
    const q = new URLSearchParams();
    if (fUser) q.set("userID", fUser);
    if (fKind) q.set("kind", fKind);
    if (fStatus) q.set("status", fStatus);
    if (fFrom) q.set("from", fFrom);
    if (fTo) q.set("to", fTo);
    if (balanceYear !== currentYear) q.set("year", String(balanceYear));
    router.push(`/urlopy/zarzadzaj${q.toString() ? `?${q}` : ""}`);
  };

  // Saldo pracownika pod ręką przy rozpatrywaniu wniosku — bez tego kierownik
  // zatwierdza w ciemno i dowiaduje się o przekroczeniu puli po fakcie.
  const leftByUser = Object.fromEntries(balances.map((b) => [b.id, b.left]));

  return (
    <BaseLayout width="wide">
      <section>
        <PageHeader
          title="Nieobecności"
          description={
            sections.length
              ? `Obsługiwane sekcje: ${sections.join(", ")}`
              : "Brak przypisanych sekcji"
          }
        />

        {sections.length === 0 && (
          <Alert tone="warn" className="mb-6">
            Nie masz przypisanej żadnej sekcji, więc nie widzisz niczyich wniosków. Przypisanie
            nadaje się komendą <code>npm run admin -- sections &lt;e-mail&gt; nazwaSekcji</code>.
          </Alert>
        )}

        {err && (
          <Alert tone="danger" className="mb-6">
            {err}
          </Alert>
        )}

        {/* 1. DO ROZPATRZENIA ------------------------------------------------ */}
        <h2 className="mb-3 text-sm font-bold uppercase tracking-signage">
          Do rozpatrzenia ({pending.length})
        </h2>

        {pending.length === 0 ? (
          <EmptyState className="mb-10" title="Brak wniosków" description="Nikt nie czeka na decyzję." />
        ) : (
          <div className="mb-10 flex flex-col gap-3">
            {pending.map((a) => {
              const left = leftByUser[a.userID];
              const usesPoolKind = ABSENCE_KINDS[a.kind]?.usesPool;
              const after = left === undefined || !usesPoolKind ? null : left - a.workDays;

              return (
                <Plate key={a.id} className="p-4">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="font-medium">
                      {a.surname} {a.name}
                    </span>
                    <span className="text-xs text-muted">{a.section}</span>
                    <span className="ml-auto font-mono text-sm tabular-nums">
                      {rangeLabel(a.dateFrom, a.dateTo)}
                    </span>
                  </div>

                  <p className="mt-1 text-sm">
                    {absenceKindLabel(a.kind)} ·{" "}
                    <strong>
                      {a.workDays} {dayWord(a.workDays)} roboczych
                    </strong>
                    {after !== null && (
                      <>
                        {" · po zatwierdzeniu zostanie "}
                        <strong className={after < 0 ? "text-danger-strong" : undefined}>
                          {after} {dayWord(after)}
                        </strong>
                      </>
                    )}
                    {!usesPoolKind && " · nie zdejmuje dni z puli"}
                  </p>

                  {after !== null && after < 0 && (
                    <p className="mt-1 text-xs text-danger-strong">
                      Ten urlop przekracza przydział. Zatwierdzenie jest możliwe — saldo zejdzie poniżej zera.
                    </p>
                  )}

                  {a.reason && <p className="mt-1 text-sm text-muted">{a.reason}</p>}

                  <div className="mt-3 flex flex-wrap gap-2 items-center">
                    <Input
                      type="text"
                      placeholder="Notatka do decyzji (przy usuwaniu obowiązkowa)"
                      value={note[a.id] || ""}
                      maxLength={300}
                      onChange={(e) => setNote({ ...note, [a.id]: e.target.value })}
                      className="flex-grow w-auto min-w-[12rem]"
                    />
                    <Button
                      disabled={busy}
                      onClick={() => decide(a.id, "approve")}
                      className="bg-ok text-ok-ink hover:bg-ok/90"
                    >
                      Zatwierdź
                    </Button>
                    <Button variant="danger" disabled={busy} onClick={() => decide(a.id, "reject")}>
                      Odrzuć
                    </Button>
                    {/* Usunięcie, nie decyzja: wniosek wpisany przez pomyłkę
                        albo wycofany telefonicznie znika z obiegu, zamiast
                        czekać na odrzucenie, którego nikt nie chciał wydawać.
                        Stąd kosz obok dwóch pełnych przycisków, a nie trzeci
                        taki sam. Powód obowiązkowy — przy pustej notatce kosz
                        jest nieaktywny, a tytuł mówi, czego brakuje. */}
                    <IconButton
                      className="h-9 w-9"
                      disabled={busy || !(note[a.id] || "").trim()}
                      onClick={() => revoke(a.id)}
                      label={
                        (note[a.id] || "").trim()
                          ? "Usuń wniosek z obiegu"
                          : "Podaj powód w polu obok, żeby usunąć wniosek"
                      }
                    >
                      <TrashIcon />
                    </IconButton>
                  </div>
                </Plate>
              );
            })}
          </div>
        )}

        {/* 2. WPIS ZA PRACOWNIKA --------------------------------------------- */}
        <ManualAbsence users={users} busy={busy} call={call} />

        {/* 3. PULA DNI -------------------------------------------------------- */}
        <Allowances
          balances={balances}
          users={users}
          year={balanceYear}
          currentYear={currentYear}
          busy={busy}
          call={call}
          onYear={(y) => router.push(`/urlopy/zarzadzaj?year=${y}`)}
        />

        {/* 4. HISTORIA -------------------------------------------------------- */}
        <h2 className="mb-3 text-sm font-bold uppercase tracking-signage">Historia</h2>

        <form onSubmit={applyFilters} className="mb-4 flex flex-wrap gap-2 items-end">
          <label className="flex flex-col">
            <span className="mb-1 text-xs font-semibold uppercase tracking-signage text-muted">Pracownik</span>
            <Select value={fUser} onChange={(e) => setFUser(e.target.value)} className="!w-52">
              <option value="">— wszyscy —</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.surname} {u.name}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col">
            <span className="mb-1 text-xs font-semibold uppercase tracking-signage text-muted">Rodzaj</span>
            <Select value={fKind} onChange={(e) => setFKind(e.target.value)} className="!w-52">
              <option value="">— wszystkie —</option>
              {ABSENCE_KIND_KEYS.map((k) => (
                <option key={k} value={k}>
                  {ABSENCE_KINDS[k].label}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col">
            <span className="mb-1 text-xs font-semibold uppercase tracking-signage text-muted">Status</span>
            <Select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className="!w-40">
              <option value="">— wszystkie —</option>
              {ABSENCE_STATUS_KEYS.map((s) => (
                <option key={s} value={s}>
                  {ABSENCE_STATUSES[s]}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col">
            <span className="mb-1 text-xs font-semibold uppercase tracking-signage text-muted">Od</span>
            <Input type="date" value={fFrom} onChange={(e) => setFFrom(e.target.value)} className="!w-44" />
          </label>
          <label className="flex flex-col">
            <span className="mb-1 text-xs font-semibold uppercase tracking-signage text-muted">Do</span>
            <Input type="date" value={fTo} onChange={(e) => setFTo(e.target.value)} className="!w-44" />
          </label>

          <Button type="submit">Filtruj</Button>
          <Button variant="ghost" onClick={() => router.push("/urlopy/zarzadzaj")}>
            Wyczyść
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              const q = new URLSearchParams(window.location.search);
              window.location.href = `/api/report/urlopy?${q}`;
            }}
          >
            Pobierz CSV
          </Button>
        </form>

        {history.length >= historyLimit && (
          <Alert tone="warn" className="mb-4">
            Lista jest przycięta do {historyLimit} pozycji — zawęź filtry albo pobierz CSV, który
            zawsze zawiera komplet.
          </Alert>
        )}

        {history.length === 0 ? (
          <EmptyState title="Brak wpisów" description="Zmień filtry albo wyczyść je w całości." />
        ) : (
          <TableWrap>
            <Table>
              <thead>
                <Tr>
                  <Th>Termin</Th>
                  <Th>Pracownik</Th>
                  <Th>Rodzaj</Th>
                  <Th align="right">Dni</Th>
                  <Th>Status</Th>
                  <Th>Szczegóły</Th>
                  <Th />
                </Tr>
              </thead>
              <tbody>
                {history.map((a) => (
                  <Fragment key={a.id}>
                  <Tr>
                    <Td className="font-mono tabular-nums whitespace-nowrap">
                      {rangeLabel(a.dateFrom, a.dateTo)}
                    </Td>
                    <Td>
                      {a.surname} {a.name}
                      <span className="block text-xs text-muted">{a.section}</span>
                    </Td>
                    <Td>{absenceKindLabel(a.kind)}</Td>
                    <Num>{a.workDays}</Num>
                    <Td>
                      <AbsenceBadge status={a.status} />
                    </Td>
                    <Td className="text-muted">
                      {a.reason && <span className="block">{a.reason}</span>}
                      {a.createdBy !== a.userID && a.createdByName && (
                        <span className="block text-xs">Wpisał: {a.createdByName}</span>
                      )}
                      {a.decidedByName && (
                        <span className="block text-xs">
                          {decisionVerb(a.status)}: {a.decidedByName},{" "}
                          {dayjs(a.decidedAt).format("DD.MM.YYYY HH:mm")}
                        </span>
                      )}
                      {a.decisionNote && <span className="block text-xs italic">„{a.decisionNote}”</span>}
                    </Td>
                    <Td className="text-right">
                      {/* Cofniętej nieobecności nie ma czego cofać drugi raz —
                          API i tak odpowiedziałoby 409. */}
                      {a.status !== "revoked" && (
                        <IconButton
                          disabled={busy}
                          label={revoking === a.id ? "Zrezygnuj z usuwania" : "Usuń nieobecność"}
                          onClick={() => setRevoking(revoking === a.id ? null : a.id)}
                        >
                          <TrashIcon />
                        </IconButton>
                      )}
                    </Td>
                  </Tr>

                  {/* Pole powodu rozwija się POD wierszem: w tabeli o siedmiu
                      kolumnach nie ma na nie miejsca, a powód bywa zdaniem. */}
                  {revoking === a.id && (
                    <tr className="border-b border-line-subtle bg-raised">
                      <td colSpan={7} className="p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <Input
                            type="text"
                            autoFocus
                            placeholder="Powód usunięcia (obowiązkowy)"
                            maxLength={300}
                            value={note[a.id] || ""}
                            onChange={(e) => setNote({ ...note, [a.id]: e.target.value })}
                            className="flex-grow w-auto min-w-[12rem]"
                          />
                          <Button
                            variant="danger"
                            disabled={busy || !(note[a.id] || "").trim()}
                            onClick={() => revoke(a.id)}
                          >
                            Usuń nieobecność
                          </Button>
                          <Button variant="ghost" disabled={busy} onClick={() => setRevoking(null)}>
                            Anuluj
                          </Button>
                        </div>
                        {a.status === "approved" && ABSENCE_KINDS[a.kind]?.usesPool && (
                          <p className="mt-2 text-xs text-muted">
                            Nieobecność jest zatwierdzona — po usunięciu {a.workDays}{" "}
                            {dayWord(a.workDays)} wróci do puli pracownika.
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

// --- wpis za pracownika -----------------------------------------------------

/**
 * L4 ze zwolnienia i urlop zgłoszony telefonem. Zapisuje się od razu
 * zatwierdzony — zakłada go osoba, która i tak by go akceptowała.
 */
const ManualAbsence = ({ users, busy, call }) => {
  const [form, setForm] = useState({
    userID: "",
    kind: "sick_leave",
    dateFrom: nextWorkingDay(),
    dateTo: nextWorkingDay(),
    reason: "",
  });

  const workDays = countWorkingDays(form.dateFrom, form.dateTo);

  const submit = async (e) => {
    e.preventDefault();
    const ok = await call(
      "/api/absences",
      { ...form, userID: Number(form.userID) },
      () => "Nie udało się zapisać nieobecności."
    );
    if (ok) setForm({ ...form, reason: "" });
  };

  return (
    <>
      <h2 className="mb-1 text-sm font-bold uppercase tracking-signage">Wpisz nieobecność</h2>
      <p className="mb-3 text-xs text-muted">
        Zwolnienie lekarskie albo urlop zgłoszony telefonicznie. Zapisuje się od razu jako
        zatwierdzony — nie trafia do wniosków do rozpatrzenia.
      </p>

      <form onSubmit={submit} className="mb-10 p-4 border border-line rounded bg-raised">
        <div className="flex flex-wrap gap-2 items-end">
          <label className="flex flex-col">
            <span className="mb-1 text-xs font-semibold uppercase tracking-signage text-muted">Pracownik</span>
            <Select
              value={form.userID}
              required
              onChange={(e) => setForm({ ...form, userID: e.target.value })}
              className="!w-52"
            >
              <option value="">— wybierz —</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.surname} {u.name}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col">
            <span className="mb-1 text-xs font-semibold uppercase tracking-signage text-muted">Rodzaj</span>
            {/* Kierownik ma PEŁNĄ listę, także rodzaje niedostępne dla pracownika. */}
            <Select
              value={form.kind}
              onChange={(e) => setForm({ ...form, kind: e.target.value })}
              className="!w-64"
            >
              {ABSENCE_KIND_KEYS.map((k) => (
                <option key={k} value={k}>
                  {ABSENCE_KINDS[k].label}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col">
            <span className="mb-1 text-xs font-semibold uppercase tracking-signage text-muted">Od</span>
            <Input
              type="date"
              value={form.dateFrom}
              required
              onChange={(e) =>
                setForm({
                  ...form,
                  dateFrom: e.target.value,
                  dateTo: form.dateTo < e.target.value ? e.target.value : form.dateTo,
                })
              }
              className="!w-44"
            />
          </label>
          <label className="flex flex-col">
            <span className="mb-1 text-xs font-semibold uppercase tracking-signage text-muted">Do</span>
            <Input
              type="date"
              value={form.dateTo}
              min={form.dateFrom}
              required
              onChange={(e) => setForm({ ...form, dateTo: e.target.value })}
              className="!w-44"
            />
          </label>
          <Button type="submit" disabled={busy || !form.userID}>
            Zapisz
          </Button>
        </div>

        <p className="mt-2 text-sm">
          {workDays > 0 ? (
            <>
              To{" "}
              <strong>
                {workDays} {dayWord(workDays)}
              </strong>{" "}
              roboczych
              {!ABSENCE_KINDS[form.kind]?.usesPool && " · nie zdejmuje dni z puli"}
            </>
          ) : (
            <span className="text-muted">W wybranym zakresie nie ma dnia roboczego.</span>
          )}
        </p>

        <Textarea
          rows={2}
          value={form.reason}
          maxLength={500}
          placeholder="Notatka (nieobowiązkowa) — np. numer zwolnienia"
          onChange={(e) => setForm({ ...form, reason: e.target.value })}
          className="mt-3"
        />
      </form>
    </>
  );
};

// --- pula dni ---------------------------------------------------------------

const Allowances = ({ balances, users, year, currentYear, busy, call, onYear }) => {
  const [form, setForm] = useState({ userID: "", days: "", note: "" });

  const submit = async (e) => {
    e.preventDefault();
    const ok = await call(
      "/api/absences/allowance",
      { userID: Number(form.userID), year, days: Number(form.days), note: form.note },
      () => "Nie udało się dopisać dni."
    );
    if (ok) setForm({ userID: "", days: "", note: "" });
  };

  // Kilka lat wstecz i jeden do przodu — tyle wystarcza, żeby dopisać zaległości
  // i przygotować przydział na styczeń.
  const years = [currentYear + 1, currentYear, currentYear - 1, currentYear - 2];

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-bold uppercase tracking-signage">Pula dni urlopowych</h2>
        <Select value={year} onChange={(e) => onYear(e.target.value)} className="!w-28">
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </Select>
      </div>

      <form onSubmit={submit} className="mb-4 p-4 border border-line rounded bg-raised">
        <div className="flex flex-wrap gap-2 items-end">
          <label className="flex flex-col">
            <span className="mb-1 text-xs font-semibold uppercase tracking-signage text-muted">Pracownik</span>
            <Select
              value={form.userID}
              required
              onChange={(e) => setForm({ ...form, userID: e.target.value })}
              className="!w-52"
            >
              <option value="">— wybierz —</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.surname} {u.name}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col">
            <span className="mb-1 text-xs font-semibold uppercase tracking-signage text-muted">
              Dni na {year}
            </span>
            <Input
              type="number"
              value={form.days}
              required
              onChange={(e) => setForm({ ...form, days: e.target.value })}
              className="!w-28"
            />
          </label>
          <label className="flex flex-col flex-grow min-w-[12rem]">
            <span className="mb-1 text-xs font-semibold uppercase tracking-signage text-muted">Opis</span>
            <Input
              type="text"
              value={form.note}
              maxLength={200}
              placeholder="np. wymiar podstawowy albo zaległe z poprzedniego roku"
              onChange={(e) => setForm({ ...form, note: e.target.value })}
            />
          </label>
          <Button type="submit" disabled={busy || !form.userID}>
            Dopisz
          </Button>
        </div>
        {/* Ujemna liczba jest DOZWOLONA i to jest jedyny sposób na korektę —
            przydziałów się nie nadpisuje, bo pula ma mieć historię. */}
        <p className="mt-2 text-xs text-muted">
          Dni dopisują się do puli. Aby ją pomniejszyć, podaj liczbę ujemną — np. −2 po zmianie
          wymiaru etatu. Poprzednie przydziały zostają w historii.
        </p>
      </form>

      {balances.length === 0 ? (
        <EmptyState className="mb-10" title="Brak pracowników" description="W obsługiwanych sekcjach nie ma nikogo." />
      ) : (
        <TableWrap className="mb-10">
          <Table>
            <thead>
              <Tr>
                <Th>Pracownik</Th>
                <Th>Sekcja</Th>
                <Th align="right">Przydzielone</Th>
                <Th align="right">Wykorzystane</Th>
                <Th align="right">Pozostało</Th>
                <Th align="right">Oczekujące</Th>
              </Tr>
            </thead>
            <tbody>
              {balances.map((u) => (
                <Tr key={u.id}>
                  <Td>
                    {u.surname} {u.name}
                  </Td>
                  <Td className="text-muted">{u.section}</Td>
                  <Num>{u.granted}</Num>
                  <Num>{u.used}</Num>
                  <Num className={classNames(u.left < 0 && "text-danger-strong font-medium")}>{u.left}</Num>
                  <Num className={classNames(u.pendingCount > 0 && "text-signal-strong")}>
                    {u.pendingCount || "—"}
                  </Num>
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      )}
    </>
  );
};
