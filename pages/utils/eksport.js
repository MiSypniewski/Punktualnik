import { useState } from "react";
import { getToken } from "next-auth/jwt";
import dayjs from "dayjs";
import BaseLayout from "../../components/baseLayout";
import getAllUsers from "../../services/getAllUsers";
import { isStaff } from "../../services/roles";
import { visibleSections } from "../../services/scope";

// Dwuwarstwowe zabezpieczenie: tu blokujemy wejście na stronę,
// a /api/report niezależnie blokuje samo pobranie pliku.
export async function getServerSideProps(ctx) {
  const token = await getToken({ req: ctx.req });

  if (!token) {
    return { redirect: { destination: "/users/signin", permanent: false } };
  }
  if (!isStaff(token.role)) {
    // Brak uprawnień — nie pokazujemy strony.
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
    <BaseLayout>
      <section className="mx-auto p-4 mt-6 mb-8 max-w-xl flex flex-col">
        <h1 className="text-2xl font-bold mb-6">Eksport czasów pracy</h1>

        <label className="mb-1 text-sm font-medium">Data od</label>
        <input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="mb-4 p-2 border border-indigo-400 rounded"
        />

        <label className="mb-1 text-sm font-medium">Data do</label>
        <input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="mb-4 p-2 border border-indigo-400 rounded"
        />

        <label className="mb-1 text-sm font-medium">Pracownik</label>
        <select
          value={userID}
          onChange={(e) => setUserID(e.target.value)}
          className="mb-6 p-2 border border-indigo-400 rounded"
        >
          <option value="">— wszyscy —</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.surname} {u.name} ({u.section})
            </option>
          ))}
        </select>

        {err && <p className="mb-4 text-red-600 text-sm">{err}</p>}

        <button
          onClick={(e) => {
            e.preventDefault();
            download();
          }}
          className="text-white bg-indigo-500 border-0 py-2 px-8 hover:bg-indigo-600 rounded text-lg"
        >
          Pobierz CSV
        </button>
      </section>
    </BaseLayout>
  );
}
