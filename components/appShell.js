import classNames from "classnames";
import StationRail from "./stationRail";

// Jedna miara szerokości na typ ekranu zamiast sześciu różnych max-w-*
// rozsianych po plikach stron.
const WIDTHS = {
  narrow: "max-w-narrow", // formularze: logowanie, eksport, wniosek
  page: "max-w-page", // domyślna
  wide: "max-w-wide", // raport zadań, panel wniosków
  full: "max-w-none", // kiosk — kafelki mają wypełnić tablet
};

export default function AppShell({ user, width = "page", children }) {
  return (
    <div className="min-h-screen flex flex-col">
      <StationRail user={user} />

      <main className={classNames("w-full mx-auto px-4 py-6 sm:py-8 flex-grow", WIDTHS[width])}>
        {children}
      </main>

      <footer className="border-t border-line-subtle">
        <div className="mx-auto max-w-wide px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-xs text-faint">
          <span className="uppercase tracking-signage">Punktualnik</span>
          {/* Fakt z services/workday.js, o który ludzie pytają najczęściej —
              tu kosztuje jedną linijkę, a oszczędza pytanie. */}
          <span>Doba robocza liczona od 3:00</span>
        </div>
      </footer>
    </div>
  );
}
