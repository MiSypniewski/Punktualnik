import { useState } from "react";
import { getToken } from "next-auth/jwt";
import dayjs from "dayjs";
import BaseLayout from "../../components/baseLayout";
import getAllUsers from "../../services/getAllUsers";
import { canExportTimes } from "../../services/roles";
import { visibleSections } from "../../services/scope";
import Button from "../../components/ui/button";
import { Field, Input, Select } from "../../components/ui/field";
import Alert from "../../components/ui/alert";
import PageHeader from "../../components/ui/pageHeader";
import { DownloadIcon } from "../../components/ui/icons";

// Dwuwarstwowe zabezpieczenie: tu blokujemy wejście na stronę,
// a /api/report niezależnie blokuje samo pobranie pliku.
export async function getServerSideProps(ctx) {
  const token = await getToken({ req: ctx.req });

  if (!token) {
    return { redirect: { destination: "/users/signin", permanent: false } };
  }
  if (!canExportTimes(token.role)) {
    // Brak uprawnień — nie pokazujemy strony. Kiosk (editor) też nie:
    // stoi w miejscu publicznym, więc nie może dawać pobrania listy sekcji.
    return { notFound: true };
  }

  // Lista w filtrze zawężona do sekcji, których dane ten użytkownik może
  // oglądać — inaczej widziałby nazwiska ludzi spoza swojego zasięgu.
  return { props: { users: getAllUsers(visibleSections(token)) } };
}

export default function Eksport({ users }) {
  const startOfMonth = dayjs().date(1).format("YYYY-MM-DD");
  const today = dayjs().format("YYYY-MM-DD");

  const [from, setFrom] = useState(startOfMonth);
  const [to, setTo] = useState(today);
  const [userID, setUserID] = useState(""); // "" = wszyscy
  const [err, setErr] = useState("");

  const download = () => {
    if (!from || !to) {
      setErr("Podaj obie daty.");
      return;
    }
    if (from > to) {
      setErr("Data 'od' jest późniejsza niż 'do'.");
      return;
    }
    setErr("");

    const qs = new URLSearchParams({ from, to });
    if (userID) qs.set("userID", userID);
    // Nawigacja → przeglądarka pobiera plik wg Content-Disposition.
    // Ciasteczko sesji leci automatycznie (ten sam origin).
    window.location.href = `/api/report?${qs.toString()}`;
  };

  return (
    <BaseLayout width="narrow">
      <PageHeader
        title="Eksport czasów pracy"
        description="Odbicia z kiosku za wybrany okres, w pliku CSV gotowym dla polskiego Excela."
      />

      <div className="flex flex-col gap-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Data od" htmlFor="from">
            <Input type="date" id="from" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="Data do" htmlFor="to">
            <Input type="date" id="to" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>

        <Field label="Pracownik" htmlFor="userID">
          <Select id="userID" value={userID} onChange={(e) => setUserID(e.target.value)}>
            <option value="">— wszyscy —</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.surname} {u.name} ({u.section})
              </option>
            ))}
          </Select>
        </Field>

        {err && <Alert tone="danger">{err}</Alert>}

        <Button size="lg" onClick={download} className="self-start mt-1">
          <DownloadIcon />
          Pobierz CSV
        </Button>
      </div>
    </BaseLayout>
  );
}
