import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { fetchLive, TIMER_POLL_MS } from "../utils/live";
import { EMPTY_REMIND_MIN, EMPTY_MANAGER_MIN, EMPTY_CLOSE_MIN, EMPTY_PROJECT_NAME } from "../utils/emptyTimer";

// Przypomnienie o pustym timerze — biegnącym bez opisu I bez projektu.
//
// Pierwsze dwa progi (15 i 20 min) są wyłącznie po stronie przeglądarki: baner
// pod paskiem "W toku" na każdej stronie i, jeśli pracownik pozwolił, dymek
// systemowy. Serwer w tych progach niczego nie zapisuje — mail do kierownika
// po 20 min i zamknięcie po 30 min robi budzik (services/emptyTimerJob.js).
//
// Klucz SWR jest ten sam co w runningStrip.js i timerTitle.js, więc baner nie
// dokłada ani jednego zapytania (dedupingInterval z pages/_app.js).

const TITLE = "Punktualnik: timer bez opisu";

const hhmmLocal = (ms) =>
  new Date(ms).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });

/**
 * Prośba o zgodę na dymki systemowe. Przeglądarki przyjmują ją wyłącznie
 * w odpowiedzi na gest użytkownika, dlatego woła ją przycisk Start pustego
 * timera (pages/zadania/index.js), a nie ten komponent przy montowaniu.
 * Odmowa niczego nie psuje — zostaje baner.
 */
export const askNotificationPermission = () => {
  try {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  } catch {
    // Safari na iOS poza aplikacją z ekranu głównego nie ma Notification wcale.
  }
};

const stageOf = (running, seconds) => {
  if (!running?.empty) return 0;
  if (seconds >= EMPTY_MANAGER_MIN * 60) return 2;
  if (seconds >= EMPTY_REMIND_MIN * 60) return 1;
  return 0;
};

export default function EmptyTimerNudge() {
  const { data, mutate } = useSWR("/api/entries/timer", fetchLive, { refreshInterval: TIMER_POLL_MS });
  const running = data?.running ?? null;

  // Drift liczony różnicowo, jak w runningStrip.js — w karcie w tle zegar tyka
  // rzadziej, ale próg i tak zostanie przekroczony we właściwej minucie.
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

  const seconds = running ? running.elapsedSec + drift : 0;
  const stage = stageOf(running, seconds);

  // Który próg danego wpisu już ogłoszono dymkiem — w tej karcie. Między kartami
  // dubli pilnuje `tag`: dymek o tym samym tagu podmienia poprzedni.
  const announced = useRef("");

  useEffect(() => {
    if (stage === 0 || !running) return;
    const key = `${running.id}-${stage}`;
    if (announced.current === key) return;
    announced.current = key;

    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;

    // Karta w tle nie odpytuje serwera, więc jej dane mogą być sprzed opisania
    // timera w innej karcie. Dymek pokazujemy dopiero po świeżym odczycie.
    mutate().then((fresh) => {
      const now = fresh?.running;
      if (!now || now.id !== running.id || stageOf(now, now.elapsedSec) < stage) return;
      try {
        // eslint-disable-next-line no-new
        new Notification(TITLE, {
          body:
            stage === 2
              ? `Timer biegnie ${EMPTY_MANAGER_MIN} min bez opisu i projektu — kierownik dostał powiadomienie. Uzupełnij go przed upływem ${EMPTY_CLOSE_MIN} min.`
              : `Timer biegnie ${EMPTY_REMIND_MIN} min bez opisu i projektu. Uzupełnij go, inaczej po ${EMPTY_CLOSE_MIN} min zostanie zamknięty.`,
          tag: `pusty-timer-${running.id}-${stage}`,
        });
      } catch {
        // Chrome na Androidzie wymaga service workera do dymków — zostaje baner.
      }
    }, () => {});
  }, [stage, running, mutate]);

  if (stage === 0) return null;

  const closesAt = hhmmLocal(Date.now() - seconds * 1000 + EMPTY_CLOSE_MIN * 60 * 1000);

  return (
    <Link href="/zadania">
      <a
        role="status"
        className="block border-t border-danger/40 bg-danger-soft text-danger-strong hover:bg-danger-soft/70"
      >
        <div className="mx-auto max-w-wide px-4 py-1.5 text-sm">
          <strong className="font-semibold">
            Timer biegnie {Math.floor(seconds / 60)} min bez opisu i projektu.
          </strong>{" "}
          Uzupełnij go, inaczej o {closesAt} zostanie zamknięty jako „{EMPTY_PROJECT_NAME}”.
          {stage === 2 && " Kierownik dostał powiadomienie."}
        </div>
      </a>
    </Link>
  );
}
