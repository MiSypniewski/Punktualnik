module.exports = {
  // `purge` to składnia Tailwinda 2. Wersja 3 jeszcze ją honoruje (patrz
  // normalizeConfig.js w tailwindcss), ale ostrzega przy każdym buildzie —
  // przy okazji trybu ciemnego przechodzimy na `content`.
  content: ["./pages/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],

  // "class", a nie "media": użytkownik ma móc WYMUSIĆ motyw niezależnie od
  // systemu. Klasę `dark` na <html> ustawia components/themeToggle.js, a przy
  // pierwszym malowaniu strony — skrypt w pages/_document.js.
  darkMode: "class",

  theme: {
    extend: {
      // Kolory semantyczne oparte o zmienne CSS z styles/globals.css. Dzięki nim
      // strona nie musi znać motywu: pisze `text-muted`, a nie `text-gray-600
      // dark:text-gray-300`. Nowe ekrany dziedziczą oba motywy za darmo.
      //
      // Zapis "rgb(var(--x) / <alpha-value>)" jest konieczny, żeby dalej działały
      // modyfikatory przezroczystości w rodzaju `bg-surface/50`.
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
      },
    },
  },
  plugins: [require("@tailwindcss/forms")],
};
