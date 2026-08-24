import { useSession } from "next-auth/react";
import { useRouter } from "next/router";
import { useEffect } from "react";
import { getToken } from "next-auth/jwt";
import useSWR, { useSWRConfig } from "swr";
import { getSectionBoard } from "../../services/sectionBoard";
import { canSeeSection } from "../../services/scope";
import { getSection } from "../../services/sections";
import { LIVE_POLL_MS, fetchLive } from "../../utils/live";
import BaseLayout from "../../components/baseLayout";
import Card from "../../components/card";
import Spinner from "../../components/spinner";
import PageHeader from "../../components/ui/pageHeader";
import EmptyState from "../../components/ui/emptyState";

// Adres, spod którego tablica dociąga świeże karty. Ta sama funkcja liczy klucz
// dla useSWR i dla mutate po odbiciu — dwa różne łańcuchy znaczyłyby dwa różne
// wpisy w cache SWR i odbicie nie odświeżałoby tego widoku.
const boardKey = (section) => `/api/time/board?section=${encodeURIComponent(section)}`;

export const getServerSideProps = async (context) => {
  // Kontrola po stronie serwera. Wcześniej strona nie sprawdzała sesji w ogóle
  // — karty całej sekcji trafiały do propsów każdemu, kto wpisał adres,
  // a przekierowanie działało dopiero w przeglądarce (czyli po wysłaniu danych).
  const token = await getToken({ req: context.req });
  if (!token) {
    return { redirect: { destination: "/users/signin", permanent: false } };
  }

  const section = context.params.id;
  // Własna sekcja zawsze; cudza tylko w zasięgu (kierownik z przypisaniem).
  if (token.section !== section && !canSeeSection(token, section)) {
    return { notFound: true };
  }

  // Te same karty, które poda potem /api/time/board — jedna funkcja dla obu
  // ścieżek (services/sectionBoard.js).
  const board = await getSectionBoard(section);

  // Etykieta działu do nagłówka tablicy — slug (`spedycja`) jest kluczem
  // technicznym, a na ścianie ma stać nazwa dla ludzi.
  const sectionRow = getSection(section);

  return {
    props: {
      board,
      id: section,
      sectionLabel: sectionRow?.label ?? section,
    },
  };
};

export default function Home({ board, id, sectionLabel }) {
  const { status } = useSession();
  const router = useRouter();
  const { mutate } = useSWRConfig();

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/");
    }
    // Dostęp rozstrzyga już getServerSideProps (własna sekcja albo zasięg
    // kierownika). Porównanie sekcji zostawione tu wyrzucałoby kierownika
    // z sekcji, którą ma prawo oglądać, a której sam nie jest członkiem.
  }, [status, router]);

  // Tablica dociąga się sama, jak "Teraz w toku" na /zadania/zarzadzaj: kiosk
  // wisi na ścianie tygodniami i nikt go nie odświeża klawiszem. Bez tego
  // odbicie z drugiego urządzenia, nowy pracownik i zatwierdzony dziś urlop
  // pojawiały się na ekranie dopiero po przeładowaniu o 3:30.
  //
  // Błąd sieci zostaje CICHY, inaczej niż w components/liveBoard.js. Tam napis
  // "brak łączności" czyta kierownik, który może coś z tym zrobić; tu ekran
  // ogląda się z drugiego końca hali i komunikat diagnostyczny nie ma odbiorcy.
  // Ostatnie znane karty zostają na ekranie, SWR ponawia próbę sam.
  const { data } = useSWR(boardKey(id), fetchLive, {
    fallbackData: board,
    refreshInterval: LIVE_POLL_MS,
  });

  if (status !== "authenticated") {
    return <Spinner />;
  }

  const cards = (data ?? board).cards ?? [];
  const workdayLabel = (data ?? board).workdayLabel;

  return (
    <BaseLayout width="full">
      <PageHeader
        title={sectionLabel}
        description={<span className="first-letter:uppercase">{workdayLabel}</span>}
      />

      {cards.length === 0 ? (
        <EmptyState
          title="Nikogo tu nie ma"
          description="W tym dziale nie ma aktywnych pracowników. Konta zakłada się przez rejestrację, a aktywuje poleceniem `npm run admin -- activate`."
        />
      ) : (
        // Cztery kolumny od 1280 px: tablet kiosku stoi zwykle w poziomie,
        // a przy kilkunastu osobach trzy kolumny zeszły poniżej krawędzi ekranu.
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
          {cards.map((card) => (
            // Klucz niesie SYGNATURĘ danych z serwera, nie samo userID.
            //
            // components/card.js kopiuje propsy do useState przy montowaniu
            // i potem ich nie czyta, więc bez tego świeże dane z pollingu nigdy
            // nie weszłyby na ekran. Zmiana stanu po stronie serwera przemontowuje
            // kafelek; kliknięcie na TYM ekranie propsów nie rusza, więc sygnatura
            // zostaje ta sama i odpowiedź pollingu wysłana przed odbiciem nie cofa
            // tego, co pracownik przed chwilą dotknął.
            <Card
              data={card}
              key={`${card.userID}:${card.airtableID ?? "empty"}:${card.status}:${card.endTime}`}
              onSaved={() => mutate(boardKey(id))}
            />
          ))}
        </div>
      )}
    </BaseLayout>
  );
}
