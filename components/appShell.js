import classNames from "classnames";
import StationRail from "./stationRail";
import InstallHint from "./installHint";

// Jedna miara szerokości na typ ekranu zamiast sześciu różnych max-w-*
// rozsianych po plikach stron.
const WIDTHS = {
  narrow: "max-w-narrow", // formularze: logowanie, eksport, wniosek
  page: "max-w-page", // domyślna
  wide: "max-w-wide", // raport zadań, panel wniosków
  full: "max-w-none", // kiosk — kafelki mają wypełnić tablet
  // Tablica kiosku: pełna szerokość ORAZ dokładnie wysokość okna. Strona się
  // nie przewija, kafelki dzielą resztę ekranu między siebie
  // (components/kioskGrid.js), a stopka znika — na tablecie 1024×768 jej
  // czterdzieści pikseli to pół rzędu kafelków.
  kiosk: "max-w-none",
};

export default function AppShell({ user, width = "page", children }) {
  const fit = width === "kiosk";

  return (
    // `h-screen` przed `h-[100dvh]`: stara przeglądarka bez jednostki dvh
    // zignoruje drugą deklarację i zostanie przy pierwszej.
    <div className={classNames("flex flex-col", fit ? "h-screen h-[100dvh] overflow-hidden" : "min-h-screen")}>
      {/* `contents`, żeby owijka nie stała się rodzicem lepkiego paska (sticky
          trzyma się rodzica, a ten miałby wysokość samego paska). Na wydruku
          raportu miesięcznego nawigacja znika w całości. */}
      <div className="contents print:hidden">
        <StationRail user={user} />
      </div>

      <main
        className={classNames(
          "w-full mx-auto px-4",
          fit ? "flex-1 min-h-0 flex flex-col py-3" : "py-6 sm:py-8 flex-grow",
          WIDTHS[width]
        )}
      >
        {children}
      </main>

      {/* Podpowiedź instalacji stoi NAD stopką i sama decyduje, czy w ogóle się
          pokazać (ekran dotykowy, aplikacja jeszcze niezainstalowana, nie
          zamknięta wcześniej). Tutaj, a nie na stronie logowania: instalują ci,
          którzy już aplikacji używają, a nie ci, którzy pierwszy raz wpisują
          hasło. */}
      <div className="contents print:hidden">
        <InstallHint />
      </div>

      {!fit && (
        <footer className="border-t border-line-subtle print:hidden">
          <div className="mx-auto max-w-wide px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-xs text-faint">
            <span className="uppercase tracking-signage">Punktualnik</span>
            {/* Fakt z services/workday.js, o który ludzie pytają najczęściej —
                tu kosztuje jedną linijkę, a oszczędza pytanie. */}
            <span>Doba robocza liczona od 3:00</span>
          </div>
        </footer>
      )}
    </div>
  );
}
