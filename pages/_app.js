import Head from "next/head";
import { SessionProvider } from "next-auth/react";
import "../styles/globals.css";

function MyApp({ Component, pageProps: { session, ...pageProps } }) {
  return (
    <SessionProvider session={session}>
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
        <meta name="language" content="Polish" />
        <meta httpEquiv="content-language" content="pl" />
      </Head>
      <Component {...pageProps} />
    </SessionProvider>
  );
}

export default MyApp;
