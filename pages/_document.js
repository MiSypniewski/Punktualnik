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
