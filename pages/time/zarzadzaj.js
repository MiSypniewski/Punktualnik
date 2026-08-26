import { useState } from "react";
import { getToken } from "next-auth/jwt";
import useSWR from "swr";
import dayjs from "dayjs";
import "dayjs/locale/pl";
import classNames from "classnames";
import BaseLayout from "../../components/baseLayout";
import getAllUsers from "../../services/getAllUsers";
import getSectionTimes from "../../services/getSectionTimes";
import { canEditTimes } from "../../services/roles";
import { visibleSections } from "../../services/scope";
import { formatDate, TIME_LIST_LIMIT } from "../../utils";
import {
  Alert,
  Button,
  Field,
  IconButton,
  Input,
  Plate,
  PlateHeader,
  Select,
  Table,
  TableWrap,
  Td,
  Th,
  Tr,
  Num,
  EmptyState,
  PageHeader,
  CheckIcon,
  CloseIcon,
  PencilIcon,
  TrashIcon,
} from "../../components/ui";

dayjs.locale("pl");

// Panel korekty kart czasu — narzędzie kierownika do naprawiania ewidencji
// po fakcie: karty domkniętej automatycznie o 3:00, godziny odbitej pomyłkowo
// i dnia, w którym ktoś w ogóle nie dotknął kafelka.
//
// Świadomie OSOBNA strona, a nie edycja wprost na tablicy /time/[sekcja]:
// tamten ekran wisi w hali na widoku publicznym i klika go byle kto stojący
// przed tabletem. Poprawianie cudzych dniówek nie ma prawa być o jedno
// dotknięcie od odbicia karty.

const listKey = ({ from, to, userID }) => {
  const qs = new URLSearchParams({ from, to });
  if (userID) qs.set("userID", userID);
  return `/api/time/manage?${qs.toString()}`;
};

const fetcher = (url) => fetch(url).then((r) => r.json());

export async function getServerSideProps(ctx) {
  const token = await getToken({ req: ctx.req });

  if (!token) {
    return { redirect: { destination: "/users/signin", permanent: false } };
  }
  // Dwuwarstwowo, jak przy eksporcie: tu blokujemy wejście na stronę, a obie
  // trasy /api/time/manage niezależnie blokują sam zapis.
  if (!canEditTimes(token.role)) {
    return { notFound: true };
  }

  const sections = visibleSections(token);
  const from = dayjs().date(1).format("YYYY-MM-DD");
  const to = dayjs().format("YYYY-MM-DD");

  return {
    props: {
      users: getAllUsers(sections),
      hasSections: sections.length > 0,
      initial: { cards: getSectionTimes({ from, to, sections }) },
      from,
      to,
    },
  };
}

/** "2026-08-26T07:12:00+02:00" → "07:12" do pola <input type="time">. */
const hhmm = (stamp) => (stamp ? dayjs(stamp).format("HH:mm") : "");

const errorText = (payload, fallback) => payload?.message || payload?.error || fallback;

// --- wiersz -----------------------------------------------------------------

const CardRow = ({ card, onChanged, onError }) => {
  const [editing, setEditing] = useState(false);
  const [start, setStart] = useState(hhmm(card.startTime));
  const [end, setEnd] = useState(hhmm(card.endTime));
  const [busy, setBusy] = useState(false);

  const cancel = () => {
    setStart(hhmm(card.startTime));
    setEnd(hhmm(card.endTime));
    setEditing(false);
  };

  const save = async () => {
    setBusy(true);
    const res = await fetch(`/api/time/manage/${card.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ start, end }),
    });
    const payload = await res.json().catch(() => ({}));
    setBusy(false);

    if (!res.ok) {
      onError(errorText(payload, "Nie udało się zapisać korekty."));
      return;
    }
    setEditing(false);
    onChanged();
  };

  const remove = async () => {
    // Usunięcie karty jest nieodwracalne — Times nie ma statusów, więc nie ma
    // czego cofnąć. Stąd potwierdzenie i obowiązkowy powód, który idzie do logu.
    const reason = window.prompt("Usuwasz kartę bezpowrotnie. Podaj powód (trafi do logu serwera):");
    if (reason === null) return;

    setBusy(true);
    const res = await fetch(`/api/time/manage/${card.id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    setBusy(false);

    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      onError(errorText(payload, "Nie udało się usunąć karty."));
      return;
    }
    onChanged();
  };

  return (
    <Tr className={classNames(card.autoClosed && "bg-signal-soft")}>
      <Td className="whitespace-nowrap">{formatDate(card.data)}</Td>
      <Td>
        <span className="font-medium">{card.surname}</span> {card.name}
        {card.autoClosed && (
          <span className="ml-2 text-xs font-semibold uppercase tracking-signage text-signal-strong">auto</span>
        )}
        {card.editedByName && !card.autoClosed && (
          <span className="ml-2 text-xs text-muted" title={`Poprawił: ${card.editedByName}`}>
            popr.
          </span>
        )}
      </Td>

      {editing ? (
        <>
          <Td className="w-28">
            <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} aria-label="Wejście" />
          </Td>
          <Td className="w-28">
            <Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} aria-label="Wyjście" />
          </Td>
          <Num className="text-muted">—</Num>
          <Td className="text-right whitespace-nowrap">
            <IconButton label="Zapisz" onClick={save} disabled={busy}>
              <CheckIcon />
            </IconButton>
            <IconButton label="Anuluj" onClick={cancel} disabled={busy} className="ml-1">
              <CloseIcon />
            </IconButton>
          </Td>
        </>
      ) : (
        <>
          <Num>{hhmm(card.startTime) || "—"}</Num>
          <Num>{card.status === "wait" ? "—" : hhmm(card.endTime) || "—"}</Num>
          <Num>{card.status === "wait" ? "brak odbicia" : card.totalWorkTime}</Num>
          <Td className="text-right whitespace-nowrap">
            <IconButton label="Popraw godziny" onClick={() => setEditing(true)} disabled={busy}>
              <PencilIcon />
            </IconButton>
            <IconButton label="Usuń kartę" onClick={remove} disabled={busy} className="ml-1">
              <TrashIcon />
            </IconButton>
          </Td>
        </>
      )}
    </Tr>
  );
};

// --- dopisanie brakującej karty ---------------------------------------------

const AddCard = ({ users, onChanged, onError }) => {
  const [open, setOpen] = useState(false);
  const [userID, setUserID] = useState("");
  const [day, setDay] = useState(dayjs().format("YYYY-MM-DD"));
  const [start, setStart] = useState("07:00");
  const [end, setEnd] = useState("15:00");
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Dopisz brakującą kartę
      </Button>
    );
  }

  const submit = async () => {
    if (!userID) {
      onError("Wybierz pracownika.");
      return;
    }

    setBusy(true);
    const res = await fetch("/api/time/manage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userID, day, start, end }),
    });
    const payload = await res.json().catch(() => ({}));
    setBusy(false);

    if (!res.ok) {
      onError(errorText(payload, "Nie udało się dopisać karty."));
      return;
    }
    setOpen(false);
    setUserID("");
    onChanged();
  };

  return (
    <Plate className="w-full">
      <PlateHeader title="Nowa karta" aside="Dzień, w którym nikt nie odbił wejścia" />
      <div className="p-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Field label="Pracownik" htmlFor="nowy-user" className="sm:col-span-2">
          <Select id="nowy-user" value={userID} onChange={(e) => setUserID(e.target.value)}>
            <option value="">— wybierz —</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.surname} {u.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Dzień" htmlFor="nowy-dzien">
          <Input type="date" id="nowy-dzien" value={day} onChange={(e) => setDay(e.target.value)} />
        </Field>
        <Field label="Wejście" htmlFor="nowy-start">
          <Input type="time" id="nowy-start" value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label="Wyjście" htmlFor="nowy-end">
          <Input type="time" id="nowy-end" value={end} onChange={(e) => setEnd(e.target.value)} />
        </Field>
      </div>
      <div className="px-3 pb-3 flex gap-2">
        <Button onClick={submit} disabled={busy}>
          Dopisz kartę
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
          Anuluj
        </Button>
      </div>
    </Plate>
  );
};

// --- strona -----------------------------------------------------------------

export default function ZarzadzajKartami({ users, hasSections, initial, from: from0, to: to0 }) {
  const [from, setFrom] = useState(from0);
  const [to, setTo] = useState(to0);
  const [userID, setUserID] = useState("");
  const [err, setErr] = useState("");

  const key = listKey({ from, to, userID });
  const { data, mutate } = useSWR(key, fetcher, { fallbackData: initial });

  const cards = data?.cards ?? [];
  const refresh = () => {
    setErr("");
    mutate();
  };

  return (
    <BaseLayout width="wide">
      <PageHeader
        title="Karty czasu"
        description="Poprawa godzin, dopisanie zapomnianej karty i usunięcie wpisu odbitego przez pomyłkę. Każda zmiana zostaje podpisana."
      />

      {!hasSections && (
        <Alert tone="warn" className="mb-4">
          Nie masz przypisanej żadnej sekcji, więc nie widzisz niczyich kart. Przypisanie nadaje się
          poleceniem <code>npm run admin -- sections twój@email.pl spedycja,cns</code>.
        </Alert>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 mb-4">
        <Field label="Data od" htmlFor="from">
          <Input type="date" id="from" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="Data do" htmlFor="to">
          <Input type="date" id="to" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <Field label="Pracownik" htmlFor="userID">
          <Select id="userID" value={userID} onChange={(e) => setUserID(e.target.value)}>
            <option value="">— wszyscy —</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.surname} {u.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="mb-4">
        <AddCard users={users} onChanged={refresh} onError={setErr} />
      </div>

      <Alert className="mb-4">{err}</Alert>

      {cards.length === 0 ? (
        <EmptyState
          title="Brak kart w tym zakresie"
          description="Zmień zakres dat albo wybierz innego pracownika."
        />
      ) : (
        <Plate>
          <PlateHeader
            title="Odbicia"
            aside={
              cards.length >= TIME_LIST_LIMIT
                ? `Pokazano ${TIME_LIST_LIMIT} najnowszych — zawęź zakres dat`
                : `${cards.length} kart`
            }
          />
          <TableWrap className="px-3 pb-3">
            <Table>
              <thead>
                <tr>
                  <Th>Dzień</Th>
                  <Th>Pracownik</Th>
                  <Th align="right">Wejście</Th>
                  <Th align="right">Wyjście</Th>
                  <Th align="right">Razem</Th>
                  <Th align="right">&nbsp;</Th>
                </tr>
              </thead>
              <tbody>
                {cards.map((card) => (
                  <CardRow key={card.id} card={card} onChanged={refresh} onError={setErr} />
                ))}
              </tbody>
            </Table>
          </TableWrap>
        </Plate>
      )}
    </BaseLayout>
  );
}
