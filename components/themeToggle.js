import { useEffect, useState } from "react";
import classNames from "classnames";

// Wybór motywu siedzi w localStorage, a nie w bazie: kiosk (`editor`) to konto
// WSPÓŁDZIELONE, więc ustawienie per konto zmieniałoby motyw wszystkim naraz.
// Tak każde urządzenie ma swój — a to jest właśnie to, o co tu chodzi.
//
// Klucz i wartości muszą się zgadzać ze skryptem w pages/_document.js, który
// ustawia klasę przed pierwszym malowaniem strony.
const KEY = "theme";
// Znaki tekstowe, nie emoji: "\uFE0E" (variation selector-15) każe przeglądarce
// narysować je czcionką, a nie kolorową ikoną. Dzięki temu wszystkie trzy
// dziedziczą kolor tekstu i są tak samo czytelne w obu motywach — emoji 💻 na
// ciemnym tle robiło się nierozpoznawalną ciemną plamą.
const MODES = [
  { id: "light", icon: "☀\uFE0E", label: "Jasny" },
  { id: "dark", icon: "☾\uFE0E", label: "Ciemny" },
  { id: "system", icon: "◐\uFE0E", label: "Auto (jak system)" },
];

const prefersDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;

const applyMode = (mode) => {
  const dark = mode === "dark" || (mode === "system" && prefersDark());
  document.documentElement.classList.toggle("dark", dark);
};

export default function ThemeToggle() {
  // Zaczynamy od `null`, a nie od odczytu z localStorage: serwer go nie widzi,
  // więc render początkowy MUSI być taki sam po obu stronach, inaczej React
  // zgłasza niezgodność hydratacji.
  const [mode, setMode] = useState(null);

  useEffect(() => {
    const saved = localStorage.getItem(KEY);
    setMode(saved === "light" || saved === "dark" ? saved : "system");
  }, []);

  // W trybie "Auto" strona ma reagować na przestawienie motywu w systemie
  // od razu, bez odświeżania.
  useEffect(() => {
    if (mode !== "system") return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyMode("system");
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [mode]);

  const choose = (next) => {
    setMode(next);
    // "system" to BRAK wpisu, nie wpis o treści "system" — dzięki temu skrypt
    // w dokumencie ma tylko dwa przypadki do rozpatrzenia.
    if (next === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, next);
    applyMode(next);
  };

  // Do czasu zamontowania rezerwujemy miejsce, żeby pasek nawigacji nie skoczył.
  if (mode === null) return <span className="w-[6.5rem]" aria-hidden="true" />;

  return (
    <span className="flex gap-1" role="group" aria-label="Motyw">
      {MODES.map((m) => (
        <button
          key={m.id}
          type="button"
          title={m.label}
          aria-label={m.label}
          aria-pressed={mode === m.id}
          onClick={() => choose(m.id)}
          className={classNames(
            "w-8 h-8 rounded text-sm leading-none border",
            mode === m.id
              ? "border-accent-strong text-accent-strong bg-raised"
              : "border-transparent text-muted hover:text-body hover:bg-raised"
          )}
        >
          {m.icon}
        </button>
      ))}
    </span>
  );
}
