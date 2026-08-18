module.exports = {
  // Tailwind skanuje WYŁĄCZNIE te dwa katalogi. Klasa zapisana gdziekolwiek
  // indziej (np. w services/) zostanie wycięta z arkusza — stąd pełne nazwy
  // klas w components/projectColors.js zamiast składania ich z kawałków.
  content: ["./pages/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],

  // "class", a nie "media": użytkownik ma móc WYMUSIĆ motyw niezależnie od
  // systemu. Klasę `dark` na <html> ustawia components/themeToggle.js, a przy
  // pierwszym malowaniu strony — skrypt w pages/_document.js.
  darkMode: "class",

  theme: {
    extend: {
      // ------------------------------------------------------------------
      // Kolory semantyczne oparte o zmienne CSS z styles/globals.css.
      // Strona nie musi znać motywu: pisze `text-muted`, a nie
      // `text-gray-600 dark:text-gray-300`. Nowe ekrany dziedziczą oba
      // motywy za darmo i nie da się zapomnieć o wariancie ciemnym.
      //
      // Zapis "rgb(var(--x) / <alpha-value>)" jest konieczny, żeby dalej
      // działały modyfikatory przezroczystości w rodzaju `bg-surface/50`.
      //
      // Konwencja rodzin znaczeniowych (accent / signal / ok / danger):
      //   X          — sam kolor: wypełnienia, kropki, ramki, duże liczby
      //   X-ink      — tekst KŁADZIONY NA X (odwrotność tła)
      //   X-soft     — przygaszone tło pod baner, chip, wyróżniony wiersz
      //   X-strong   — tekst drobny: na tle strony i na tle X-soft
      // Powód rozdziału X / X-strong jest liczbowy: bursztyn o kontraście
      // wystarczającym dla ramki i licznika nie dociąga do 4,5:1 przy
      // dwunastopunktowym podpisie.
      // ------------------------------------------------------------------
      colors: {
        page: "rgb(var(--c-page) / <alpha-value>)",
        surface: "rgb(var(--c-surface) / <alpha-value>)",
        raised: "rgb(var(--c-raised) / <alpha-value>)",
        body: "rgb(var(--c-body) / <alpha-value>)",
        muted: "rgb(var(--c-muted) / <alpha-value>)",
        faint: "rgb(var(--c-faint) / <alpha-value>)",
        line: "rgb(var(--c-line) / <alpha-value>)",
        "line-strong": "rgb(var(--c-line-strong) / <alpha-value>)",
        "line-subtle": "rgb(var(--c-line-subtle) / <alpha-value>)",

        accent: "rgb(var(--c-accent) / <alpha-value>)",
        "accent-ink": "rgb(var(--c-accent-ink) / <alpha-value>)",
        "accent-soft": "rgb(var(--c-accent-soft) / <alpha-value>)",
        "accent-strong": "rgb(var(--c-accent-strong) / <alpha-value>)",

        // Bursztyn jest zarezerwowany dla stanu "teraz": biegnący timer,
        // pracujący kafelek, wiersz w "Teraz w toku", przekroczenie 8 h.
        // Nie używamy go dekoracyjnie — na tym stoi cały język tablicy.
        signal: "rgb(var(--c-signal) / <alpha-value>)",
        "signal-ink": "rgb(var(--c-signal-ink) / <alpha-value>)",
        "signal-soft": "rgb(var(--c-signal-soft) / <alpha-value>)",
        "signal-strong": "rgb(var(--c-signal-strong) / <alpha-value>)",

        ok: "rgb(var(--c-ok) / <alpha-value>)",
        "ok-ink": "rgb(var(--c-ok-ink) / <alpha-value>)",
        "ok-soft": "rgb(var(--c-ok-soft) / <alpha-value>)",
        "ok-strong": "rgb(var(--c-ok-strong) / <alpha-value>)",

        danger: "rgb(var(--c-danger) / <alpha-value>)",
        "danger-ink": "rgb(var(--c-danger-ink) / <alpha-value>)",
        "danger-soft": "rgb(var(--c-danger-soft) / <alpha-value>)",
        "danger-strong": "rgb(var(--c-danger-strong) / <alpha-value>)",
      },

      // Archivo jest krojem ZMIENNYM (jeden plik na podzbiór, oś wagi
      // 400-700) — stąd brak osobnych plików dla pogrubień.
      fontFamily: {
        sans: ["Archivo", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        mono: ["IBM Plex Mono", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },

      // Tablica emaliowana, nie karta z zaokrąglonymi rogami.
      borderRadius: {
        DEFAULT: "3px",
        sm: "2px",
        md: "4px",
        lg: "6px",
      },

      // Szerokości strony jako trzy nazwy zamiast sześciu różnych max-w-*
      // rozsianych po plikach stron.
      maxWidth: {
        narrow: "44rem",
        page: "70rem",
        wide: "85rem",
      },

      // Wersaliki nagłówków i etykiet potrzebują światła, inaczej czytają się
      // jak zbity blok.
      letterSpacing: {
        signage: "0.12em",
      },

      boxShadow: {
        plate: "var(--shadow-plate)",
        rail: "var(--shadow-rail)",
      },

      keyframes: {
        "signal-pulse": {
          "0%, 100%": { opacity: "1", transform: "scale(1)" },
          "50%": { opacity: "0.35", transform: "scale(0.82)" },
        },
      },

      animation: {
        // Wyłączane globalnie przez prefers-reduced-motion w globals.css.
        "signal-pulse": "signal-pulse 1.6s ease-in-out infinite",
      },
    },
  },
  plugins: [require("@tailwindcss/forms")],
};
