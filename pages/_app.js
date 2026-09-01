import Head from "next/head";
import { SessionProvider } from "next-auth/react";
import { SWRConfig } from "swr";
import "../styles/globals.css";

// Globalne ustawienia SWR. Wcześniej ich nie było i wszystko chodziło na
// domyślnych — w tym NIEOGRANICZONE ponawianie po błędzie.
//
// To jest istotne dla stabilności serwera, nie dla wygody klienta: gdy 21.08.2026
// aplikacja przestała odpowiadać, dwanaście przeglądarek zaczęło ją dobijać
// w pętli dokładnie w chwili, w której próbowała wstać. Limit ponowień zamienia
// chwilowe zamrożenie w chwilowy błąd, zamiast w przedłużoną awarię.
const swrOptions = {
  errorRetryCount: 3,
  errorRetryInterval: 5000,
  // Odpytania z tym samym kluczem w tym oknie czasu zlewają się w jedno.
  // /api/entries/timer wisi w layoucie KAŻDEJ strony (timerTitle + runningStrip),
  // więc bez tego przejście między stronami generuje serię bliźniaczych żądań.
  dedupingInterval: 5000,
  // revalidateOnFocus zostaje włączone (powrót do karty ma pokazywać świeże dane),
  // ale nie częściej niż raz na 30 s — ktoś przełączający się między zakładkami
  // nie ma prawa generować ruchu w tempie kliknięć.
  focusThrottleInterval: 30_000,
};

function MyApp({ Component, pageProps: { session, ...pageProps } }) {
  return (
    // refetchOnWindowFocus={false}: każde przełączenie karty odpytywało
    // /api/auth/session, a ten endpoint przy każdym wywołaniu deszyfruje
    // i ponownie szyfruje token JWE oraz wystawia nowe ciastko. Czysty koszt CPU
    // bez żadnego zysku — rola i sekcja siedzą w tokenie i tak nie zmienią się
    // bez przelogowania.
    <SessionProvider session={session} refetchOnWindowFocus={false}>
      <Head>
        <title>Punktualnik</title>
        <meta name="description" content="Ewidencja czasu pracy, nadgodzin i zadań" />
        {/* Bez tego telefon renderuje stronę w wirtualnym oknie 980px i skaluje ją
            w dół — warianty `sm:` odpalały się wtedy TAKŻE na wąskim ekranie, więc
            układy mobilne w kodzie nigdy nie dochodziły do głosu. */}
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />

        {/* Manifest — to on robi z tej strony rzecz, którą telefon potrafi
            zainstalować: ikona na ekranie i uruchamianie bez paska adresu.
            Service workera świadomie NIE MA: do instalacji nie jest potrzebny,
            a dokładałby własny cykl życia (i klasyczny błąd "ludzie widzą starą
            wersję po wdrożeniu") w zamian za tryb offline, którego aplikacja
            czytająca i pisząca do bazy na serwerze i tak by nie obsłużyła.
            Rozszerzenie .webmanifest, nie .json — dzięki niemu serwer podaje
            typ application/manifest+json bez dokładania nagłówków. */}
        <link rel="manifest" href="/manifest.webmanifest" />

        {/* Metatagi Apple dublują to, co dla reszty świata mówi manifest.
            iOS starszy niż 16.4 manifestu nie czyta i bez tej pierwszej linijki
            po prostu otwierałby Safari z paskiem adresu. Pasek stanu zostaje
            "default" (nieprzezroczysty): "black-translucent" wpuszcza treść pod
            zegarek systemowy, a nagłówek aplikacji nie ma na to zapasu. */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="Punktualnik" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="language" content="Polish" />
        <meta httpEquiv="content-language" content="pl" />
      </Head>
      <SWRConfig value={swrOptions}>
        <Component {...pageProps} />
      </SWRConfig>
    </SessionProvider>
  );
}

export default MyApp;
