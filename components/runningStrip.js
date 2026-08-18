import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import LiveDot from "./liveDot";
import { formatClock } from "../utils";

// Druga linia paska stacyjnego: biegnące zadanie widoczne z KAŻDEJ strony.
//
// Dotąd ten timer istniał wyłącznie w tytule karty przeglądarki
// (components/timerTitle.js) — czyli widziało go się tylko wtedy, gdy patrzyło
// się na inną zakładkę. Tu jest ten sam stan, ale na stronie.
//
// Klucz SWR jest CELOWO ten sam co w timerTitle.js: SWR dedupikuje po kluczu,
// więc dwa komponenty to dalej jedno zapytanie na cykl, nie dwa.
const POLL_MS = 60_000;

// Świadomie nie jsonFetcher z utils/ — tamten nie sprawdza res.ok, więc 401 po
// wygaśnięciu sesji wróciłby jako poprawne dane i pasek zgasłby tak samo jak
// przy zatrzymanym timerze.
const fetchTimer = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

export default function RunningStrip() {
  const { data } = useSWR("/api/entries/timer", fetchTimer, { refreshInterval: POLL_MS });
  const running = data?.running ?? null;

  // Sekundy dorobione lokalnie od chwili odbioru danych, liczone RÓŻNICOWO,
  // nigdy przez prev + 1: karta w tle bywa dławiona do jednego ticka na minutę
  // i inkrementacja rozjechałaby się nieodwracalnie.
  const [drift, setDrift] = useState(0);
  const receivedAt = useRef(null);

  useEffect(() => {
    receivedAt.current = Date.now();
    setDrift(0);
  }, [data]);

  useEffect(() => {
    const handle = setInterval(() => {
      if (receivedAt.current === null) return;
      setDrift(Math.floor((Date.now() - receivedAt.current) / 1000));
    }, 1000);
    return () => clearInterval(handle);
  }, []);

  if (!running) return null;

  return (
    <Link href="/zadania">
      <a className="block border-t border-signal/40 bg-signal-soft text-signal-strong hover:bg-signal-soft/70">
        <div className="mx-auto max-w-wide px-4 py-1.5 flex items-center gap-2 sm:gap-3">
          <LiveDot />
          <span className="text-[0.6875rem] font-semibold uppercase tracking-signage shrink-0">
            W toku
          </span>
          <span className="min-w-0 flex-grow truncate text-sm">
            {running.description || "(bez opisu)"}
            {running.projectName && <span className="opacity-70"> · {running.projectName}</span>}
          </span>
          <span className="font-mono text-sm font-medium tabular-nums shrink-0">
            {formatClock(running.elapsedSec + drift)}
          </span>
        </div>
      </a>
    </Link>
  );
}
