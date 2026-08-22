import { getToken } from "next-auth/jwt";
import db from "../../services/db";
import { maxEventLoopLag } from "../../services/runtime";

// Stan procesu — do zajrzenia, gdy ktoś zgłasza, że "aplikacja muli".
//
// Powstał po awarii z 21.08.2026, kiedy jedyną dostępną informacją był fakt,
// że pm2 nie odnotował restartu. Najważniejsza liczba to `eventLoop.maxLagMs`:
// pokazuje, na ile milisekund proces w ogóle przestał odpowiadać komukolwiek.
// Przy zdrowej aplikacji to kilkanaście ms; wartości rzędu sekund oznaczają, że
// coś synchronicznego (zapytanie SQLite, hashowanie hasła) blokuje wszystkich.
//
// Za tokenem, choć nie zwraca danych osobowych: publiczny endpoint pokazywałby
// obcym stan i wielkość instalacji.

// COUNT(*) po częściowym indeksie idx_entries_running — jedno tanie sprawdzenie,
// że baza w ogóle odpowiada. Bez tego endpoint mówiłby tylko o procesie Node.
const countRunning = db.prepare(`SELECT COUNT(*) AS n FROM TaskEntries WHERE endedAt IS NULL`);

// eslint-disable-next-line import/no-anonymous-default-export
export default async (req, res) => {
  const token = await getToken({ req });
  if (!token) {
    return res.status(401).json({ error: "not_authorized" });
  }
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const mem = process.memoryUsage();
  const mb = (bytes) => Math.round(bytes / 1024 / 1024);

  const startedAt = Date.now();
  const running = countRunning.get().n;
  const dbProbeMs = Date.now() - startedAt;

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({
    status: "ok",
    uptimeSeconds: Math.round(process.uptime()),
    node: process.version,
    memory: { rssMB: mb(mem.rss), heapUsedMB: mb(mem.heapUsed) },
    // Największe opóźnienie pętli zdarzeń od startu procesu. Nie zeruje się —
    // pokazuje najgorszy moment, nie stan bieżący.
    eventLoop: { maxLagMs: maxEventLoopLag() },
    // Ile trwało pojedyncze zapytanie do bazy w chwili sprawdzenia.
    db: { probeMs: dbProbeMs, runningEntries: running },
  });
};
