import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { formatClock } from "../utils";
import { fetchLive, TIMER_POLL_MS } from "../utils/live";

// Timer biegnącego zadania w pasku karty przeglądarki: "1:21:35 · Opis — Punktualnik".
//
// Sens jest w tym, że działa POZA stroną /zadania. Licznik na tamtej stronie widzi
// tylko ten, kto na nią patrzy; do paska kart sięga się wzrokiem z innej zakładki
// i właśnie wtedy trzeba wiedzieć, że licznik wciąż leci (tak działa Clockify).
//
// Komponent, a nie hook, żeby BaseLayout mógł go montować warunkowo — kiosk
// (`editor`) nie raportuje zadań i nie ma czego odpytywać, a hooka nie da się
// wywołać pod `if`. Nie renderuje niczego: całą treścią jest document.title.
//
// Zegar jest osobnym formatem (formatClock, nie formatDuration): tytuł karty jest
// ucinany po kilkunastu znakach i "1h 21min 35s" zjadłoby miejsce na opis.

// Tytuł spoza timera — ten sam, który ustawia <Head> w pages/_app.js.
const BASE_TITLE = "Punktualnik";

export default function TimerTitle() {
  const { data } = useSWR("/api/entries/timer", fetchLive, {
    refreshInterval: TIMER_POLL_MS,
    // refreshWhenHidden zostaje domyślnie wyłączone: karta w tle nie odpytuje
    // serwera, bo tytuł tyka z lokalnego driftu, a revalidateOnFocus poprawi stan
    // w chwili powrotu do zakładki. Timer zatrzymany w INNEJ karcie zostaje więc
    // w tytule do najbliższego odświeżenia — to jedyna niedokładność i kosztuje
    // mniej niż odpytywanie serwera z każdej otwartej karty w tle.
  });

  const running = data?.running ?? null;

  // Sekundy dorobione lokalnie od chwili odebrania danych — licznik nie czeka
  // z ruszeniem na następny cykl pollingu. Liczone RÓŻNICOWO wobec chwili odbioru,
  // nigdy przez prev + 1: karta w tle bywa dławiona do jednego ticka na minutę
  // i inkrementacja rozjechałaby się nieodwracalnie (jak w components/liveBoard.js).
  const [drift, setDrift] = useState(0);
  const receivedAt = useRef(null);

  useEffect(() => {
    receivedAt.current = Date.now();
    setDrift(0);
  }, [data]);

  useEffect(() => {
    const tick = () => {
      if (receivedAt.current === null) return;
      setDrift(Math.floor((Date.now() - receivedAt.current) / 1000));
    };

    const handle = setInterval(tick, 1000);
    return () => clearInterval(handle);
  }, []);

  // Tytuł ustawiamy w useEffect, a nie <Head>: przerysowywanie Heada co sekundę
  // byłoby droższe niż jedno przypisanie, a przy okazji ten efekt nadpisuje tytuł
  // z pages/_app.js, który Next przywraca po każdej zmianie trasy.
  useEffect(() => {
    if (!running) {
      document.title = BASE_TITLE;
      return undefined;
    }

    const label = running.description || running.projectName || "bez opisu";
    document.title = `${formatClock(running.elapsedSec + drift)} · ${label} — ${BASE_TITLE}`;

    // Sprzątanie na wypadek wylogowania albo utraty uprawnień w trakcie sesji.
    return () => {
      document.title = BASE_TITLE;
    };
  }, [running, drift]);

  return null;
}
