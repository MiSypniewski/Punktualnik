import { useEffect, useRef, useState } from "react";
import classNames from "classnames";
import { fitGrid } from "../utils/fitGrid";

// Siatka tablicy kiosku: wypełnia resztę ekranu pod nagłówkiem i dzieli ją
// między kafelki tak, żeby zmieściła się cała sekcja (utils/fitGrid.js).
//
// Rozmiar bierze z WŁASNEGO kontenera, a nie z window.innerHeight: o tym, ile
// zostaje na kafelki, decyduje też pasek, nagłówek i podpowiedź instalacji,
// a tych strona nie musi znać.

// gap-2 — ten sam odstęp musi trafić do fitGrid, inaczej rachunek rzędów
// rozjedzie się z tym, co narysuje przeglądarka.
const GAP_PX = 8;

// Zanim przeglądarka zmierzy kontener (SSR, pierwszy render): układ dla
// tabletu 1024×768. Bez tego pierwsza klatka stawiałaby jedną kolumnę.
const FALLBACK = { width: 992, height: 640 };

export default function KioskGrid({ count, children }) {
  const ref = useRef(null);
  const [size, setSize] = useState(FALLBACK);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;

    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      // Zaokrąglenie w dół: ułamek piksela w górę potrafi dać przewijanie.
      setSize((prev) => {
        const next = { width: Math.floor(width), height: Math.floor(height) };
        return prev.width === next.width && prev.height === next.height ? prev : next;
      });
    };

    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const grid = fitGrid({ count, width: size.width, height: size.height, gap: GAP_PX });

  return (
    // Przy wyjątkowo dużej sekcji (fits: false) przewija się sam kontener,
    // nie strona — nagłówek i pasek zostają na miejscu.
    <div ref={ref} className={classNames("flex-1 min-h-0", !grid.fits && "overflow-y-auto")}>
      <div
        className="grid gap-2 content-start"
        style={{
          gridTemplateColumns: `repeat(${grid.cols}, minmax(0, 1fr))`,
          gridAutoRows: `${grid.cardH}px`,
        }}
      >
        {children(grid.density)}
      </div>
    </div>
  );
}
