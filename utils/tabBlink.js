import { useEffect, useState } from "react";

// Miganie karty przeglądarki: przełącznik faza/antyfaza co sekundę, póki `active`.
//
// Tyka WEB WORKER, a nie setInterval na stronie — i to jest sedno. Chrome dławi
// timery w karcie schowanej dłużej niż 5 minut ("intensive throttling") do
// jednego wybudzenia na minutę, a miganie ma działać właśnie w karcie w tle:
// na stronie, na którą ktoś patrzy, wystarcza baner. Timerów w workerach to
// ograniczenie nie obejmuje. Worker powstaje z Bloba, bez osobnego pliku
// w public/ — to dziesięć znaków kodu, a nie moduł do utrzymywania.
//
// Bez workera (stara przeglądarka, zablokowane Bloby) zostaje zwykły setInterval:
// miga wolniej w tle, ale miga.

const WORKER_SRC = "setInterval(() => postMessage(0), 1000);";

export const useTabBlink = (active) => {
  const [on, setOn] = useState(false);

  useEffect(() => {
    if (!active) {
      setOn(false);
      return undefined;
    }

    const flip = () => setOn((v) => !v);

    let worker = null;
    let url = null;
    try {
      url = URL.createObjectURL(new Blob([WORKER_SRC], { type: "text/javascript" }));
      worker = new Worker(url);
      worker.onmessage = flip;
    } catch {
      worker = null;
    }

    const handle = worker ? null : setInterval(flip, 1000);

    return () => {
      if (worker) worker.terminate();
      if (url) URL.revokeObjectURL(url);
      if (handle) clearInterval(handle);
      setOn(false);
    };
  }, [active]);

  return on;
};

// Ikona alarmowa: czerwony kwadrat z wykrzyknikiem, w tym samym obrysie
// (512, rx 64) co public/icon.svg, żeby podmiana nie skakała rozmiarem.
const ALERT_ICON =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">' +
      '<rect width="512" height="512" rx="64" fill="#DC2626"/>' +
      '<rect x="220" y="80" width="72" height="240" rx="24" fill="#fff"/>' +
      '<circle cx="256" cy="400" r="44" fill="#fff"/></svg>'
  );

/**
 * Podmienia ikonę karty na alarmową (on = true) albo przywraca oryginał.
 *
 * Ruszamy WSZYSTKIE <link rel="icon"> z pages/_app.js (ICO i SVG): przeglądarki
 * różnie wybierają między nimi, a podmiana tylko jednego mogłaby trafić w tę,
 * której akurat nie pokazują. Oryginał zapisujemy w data-atrybucie, więc
 * przywrócenie nie zależy od tego, co React ma w pamięci.
 */
export const setAlertFavicon = (on) => {
  document.querySelectorAll('link[rel="icon"]').forEach((link) => {
    if (!link.dataset.href) link.dataset.href = link.getAttribute("href");
    const next = on ? ALERT_ICON : link.dataset.href;
    if (link.getAttribute("href") !== next) link.setAttribute("href", next);
  });
};
