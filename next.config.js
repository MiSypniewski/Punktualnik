// Nagłówki bezpieczeństwa dla każdej odpowiedzi, stron i API.
//
// Do tej pory nie było żadnego, więc stronę dało się osadzić w ramce na obcej
// witrynie i podsunąć kierownikowi przycisk „Zatwierdź” pod niewinnym
// kliknięciem (clickjacking). frame-ancestors w CSP to właściwa obrona,
// X-Frame-Options jest dla starszych przeglądarek.
//
// Pełnego CSP (script-src) tu NIE MA: _document.js wstrzykuje inline
// THEME_SCRIPT, który trzeba by najpierw objąć hashem. To osobny temat.
const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Adresy zawierają identyfikatory pracowników i filtry raportów. Nie mają
  // wychodzić do obcych serwisów w nagłówku Referer.
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // HSTS tylko na produkcji. Lokalnie `next dev` chodzi po http, a przeglądarka
  // zapamiętałaby wymuszenie https dla localhost na rok.
  ...(process.env.NODE_ENV === "production"
    ? [{ key: "Strict-Transport-Security", value: "max-age=31536000" }]
    : []),
];

module.exports = {
  reactStrictMode: true,
  // Bez "X-Powered-By: Next.js": nie ma powodu podpowiadać, na czym stoi aplikacja.
  poweredByHeader: false,
  // Optymalizator /_next/image jest w Next domyślnie włączony, choć aplikacja
  // nie używa next/image. W Next 12 ma kilka znanych podatności (DoS, a przy
  // plikach AVIF nawet RCE: GHSA-2xp9-vwfh-vxw4). Wyłączamy go, dopóki
  // aplikacja nie przejdzie na nowszą wersję Next.
  //
  // `loader: "custom"`, a NIE samo `unoptimized: true`. W Next 12.3.4 trasa
  // /_next/image odpowiada 404 wyłącznie przy loaderze innym niż "default"
  // (next-server.js, "_next/image catchall"). `unoptimized` zmienia tylko
  // zachowanie komponentu, a sam endpoint dalej optymalizuje.
  images: { loader: "custom", unoptimized: true },
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  i18n: {
    locales: ["pl"],
    defaultLocale: "pl",
  },
  // better-sqlite3 to moduł natywny — nie pakujemy go do bundla serwerowego,
  // ma być wymagany w runtime z node_modules.
  //
  // exceljs z tej samej listy, choć z innego powodu: paczka ma ponad 20 MB
  // kodu, a `next build` na produkcji mieści się w pamięci tylko przy włączonej
  // "amfetaminie". Przepuszczanie jej przez webpacka przy każdym buildzie to
  // koszt bez żadnego zysku — na serwerze i tak leży w node_modules.
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = [...config.externals, "better-sqlite3", "exceljs"];
    }
    return config;
  },
};
