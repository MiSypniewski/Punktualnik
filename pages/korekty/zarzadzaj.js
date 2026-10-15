import { useState } from "react";
import { useRouter } from "next/router";
import { getToken } from "next-auth/jwt";
import { mutate } from "swr";
import Link from "next/link";
import BaseLayout from "../../components/baseLayout";
import RequestTabs from "../../components/requestTabs";
import OvertimeBadge from "../../components/overtimeBadge";
import { Alert, EmptyState, Input, PageHeader, Plate } from "../../components/ui";
import { TableWrap, Table, Th, Td, Tr } from "../../components/ui/table";
import { listForManager } from "../../services/cardCorrections";
import { canEditTimes } from "../../services/roles";
import { visibleSections } from "../../services/scope";
import { decisionVerb } from "../../services/overtimeKinds";
import { formatCardSpan, formatDateTime } from "../../utils";
import { PENDING_KEY } from "../../utils/live";

// Zgłoszenia korekty karty od pracowników (services/cardCorrections.js).
//
// Kierownik zatwierdza albo odrzuca — godzin tu nie zmienia. Inną poprawkę
// robi w Kartach czasu (/time/zarzadzaj), a zgłoszenie odrzuca z notatką.

export async function getServerSideProps(ctx) {
  const token = await getToken({ req: ctx.req });
  if (!token) {
    return { redirect: { destination: "/users/signin", permanent: false } };
  }
  if (!canEditTimes(token.role)) {
    return { notFound: true };
  }

  const sections = visibleSections(token);
  const rows = listForManager(sections);

  return {
    props: {
      pending: rows.filter((r) => r.status === "pending"),
      history: rows.filter((r) => r.status !== "pending"),
      sections,
    },
  };
}

const ERRORS = {
  already_decided: "To zgłoszenie zostało już rozpatrzone (np. w innej karcie przeglądarki).",
  permission_denied: "To zgłoszenie nie należy do twoich sekcji.",
  not_found: "Zgłoszenie już nie istnieje.",
};

export default function ZarzadzajKorektami({ pending, history, sections }) {
  const router = useRouter();
  const [note, setNote] = useState({});
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  // Jak w panelu nadgodzin: propsy przez router, licznik w pasku przez SWR.
  const refresh = () =>
    Promise.all([router.replace(router.asPath, undefined, { scroll: false }), mutate(PENDING_KEY)]);

  const decide = async (id, action) => {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch(`/api/corrections/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, note: note[id] || "" }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        // Błędy zapisu karty (np. doba się skończyła) niosą własne zdanie
        // z services/cardCorrections.js — pokazujemy je wprost.
        setErr(ERRORS[body.error] || body.message || "Nie udało się zapisać decyzji.");
      }
      await refresh();
    } catch {
      setErr("Brak połączenia z serwerem.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <BaseLayout width="wide">
      <section>
        <PageHeader
          title="Korekty kart"
          description={
            sections.length > 0 ? `Obsługiwane sekcje: ${sections.join(", ")}` : "Brak przypisanych sekcji"
          }
        />

        <RequestTabs />

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
            description="Wszystkie zgłoszenia z twoich sekcji są rozpatrzone."
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
                  <span className="text-sm font-mono tabular-nums">{r.day}</span>
                  <span className="font-mono tabular-nums text-sm">
                    <span className="text-muted">{formatCardSpan(r.beforeStartHm, r.beforeEndHm, r.beforeOpen)}</span>
                    {" → "}
                    <span className="font-medium">{formatCardSpan(r.startHm, r.endHm, r.open)}</span>
                  </span>
                </div>

                <p className="mt-1 text-sm text-muted">{r.reason}</p>

                <div className="mt-3 flex flex-wrap gap-2 items-center">
                  <Input
                    type="text"
                    placeholder="Notatka do decyzji"
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
                </div>
              </Plate>
            ))}
          </div>
        )}

        <p className="mb-6 text-xs text-muted">
          Inne godziny niż zgłoszone? Odrzuć zgłoszenie z notatką i popraw kartę w{" "}
          <Link href="/time/zarzadzaj">
            <a className="text-accent-strong hover:underline">Kartach czasu</a>
          </Link>
          .
        </p>

        <h2 className="mb-4 text-sm font-bold uppercase tracking-signage">Historia</h2>
        {history.length === 0 ? (
          <EmptyState title="Brak historii" description="Rozpatrzone zgłoszenia pojawią się tutaj." />
        ) : (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>Dzień</Th>
                  <Th>Pracownik</Th>
                  <Th>Było</Th>
                  <Th>Zgłoszone</Th>
                  <Th>Status</Th>
                  <Th>Szczegóły</Th>
                </tr>
              </thead>
              <tbody>
                {history.map((r) => (
                  <Tr key={r.id} className="align-top">
                    <Td className="font-mono tabular-nums whitespace-nowrap">{r.day}</Td>
                    <Td className="whitespace-nowrap">
                      {r.surname} {r.name}
                    </Td>
                    <Td className="font-mono tabular-nums whitespace-nowrap text-muted">
                      {formatCardSpan(r.beforeStartHm, r.beforeEndHm, r.beforeOpen)}
                    </Td>
                    <Td className="font-mono tabular-nums whitespace-nowrap">
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
