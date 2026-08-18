import Document, { Html, Head, Main, NextScript } from "next/document";

// Skrypt ustawiający motyw PRZED pierwszym malowaniem strony. Musi być
// blokujący i wpisany w dokument — gdyby motyw ustawiał się dopiero w Reakcie,
// przy każdym wejściu na stronę mignęłoby białe tło.
//
// Brak wpisu w localStorage znaczy "Auto", czyli idziemy za ustawieniem systemu.
// Wartości i klucz muszą się zgadzać z components/themeToggle.js.
const THEME_SCRIPT = `(function(){try{
  var t = localStorage.getItem("theme");
  if (t === "dark" || (t !== "light" && matchMedia("(prefers-color-scheme: dark)").matches)) {
    document.documentElement.classList.add("dark");
  }
}catch(e){}})();`;

class MyDocument extends Document {
  render() {
    return (
      <Html lang="pl">
        <Head>
          <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />

          {/* Wyprzedzamy tylko krój tekstowy, i to w obu podzbiorach: nagłówki
              są wersalikami i pierwsze polskie „Ł” albo „Ą” sięga do latin-ext
              natychmiast. Monospace dociąga się normalnie — liczby wchodzą
              ułamek sekundy później i `swap` to ukrywa. */}
          <link
            rel="preload"
            href="/fonts/archivo-400-700-latin.woff2"
            as="font"
            type="font/woff2"
            crossOrigin="anonymous"
          />
          <link
            rel="preload"
            href="/fonts/archivo-400-700-latin-ext.woff2"
            as="font"
            type="font/woff2"
            crossOrigin="anonymous"
          />

          {/* Pasek adresu przeglądarki w kolorze tła strony — na telefonie
              kończy się na tym różnica między aplikacją a systemem. */}
          <meta name="theme-color" media="(prefers-color-scheme: light)" content="#EDEFF2" />
          <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0E1116" />
        </Head>
        <body>
          <Main />
          <NextScript />
        </body>
      </Html>
    );
  }
}

export default MyDocument;
