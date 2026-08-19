import { useSession } from "next-auth/react";
import { useRouter } from "next/router";
import { useState, useEffect } from "react";
import { getToken } from "next-auth/jwt";
import getSectionTime from "../../services/getSectionTime";
import { canSeeSection } from "../../services/scope";
import getUsers from "../../services/getUsers";
import { getSection } from "../../services/sections";
import useSWR from "swr";
import BaseLayout from "../../components/baseLayout";
import Card from "../../components/card";
import Spinner from "../../components/spinner";
import PageHeader from "../../components/ui/pageHeader";
import EmptyState from "../../components/ui/emptyState";
import dayjs from "dayjs";
import "dayjs/locale/pl";
dayjs.locale("pl");

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

  //pobieranie dzisiejszej daty i ustawnianie godziny na 3 w nocy aby uniknąć problemów ze zmianą czasu na letni i zimowy
  const toDay = dayjs().hour(3).minute(0).second(0).millisecond(0).format();
  //pobieranie aktywnych użytkowników z danej sekcji (contex.params.id) -- tylko "user", żaden edytor
  const users = await getUsers(context.params.id);
  //pobieranie z bazy dzisiejszych rekordów z danej sekcji, Jeżeli ktoś już zaznaczył swoją obecność będzie w tej bazie.
  const cardData = await getSectionTime(context.params.id, toDay);
  // pusta tablica na dane użytkowników
  const newCardData = [];

  // tworzenie nowego pustego użytkownika
  const addEmptyUser = (user) => {
    const emptyUser = {
      ID: `empty_${user.ID}`,
      userID: user.ID,
      name: user.name,
      surname: user.surname,
      section: user.section,
      location: user.location,
      data: toDay,
      startTime: toDay,
      endTime: toDay,
      // differenceTime: moment(newDay).hours(8).minutes(0).seconds(0).milliseconds(0).format(),
      totalWorkTime: `00:00:00`,
      status: "wait",
      overTime: false,
    };
    //dodawanie nowego pustego użytkownika.
    newCardData.push(emptyUser);
  };

  // porównanie czy każdy aktywny użytkownik jest zapisany w bazie.

  // brak zapisanego czasu ŻADNEGO użytkownika w danym dniu
  if (Array.isArray(cardData) && cardData.length === 0) {
    //dodawanie każdego aktywnego użytkownika
    users.forEach((user) => {
      addEmptyUser(user);
    });
  }

  // znalezione czasy użytkowników w bazie
  if (Array.isArray(cardData) && cardData.length > 0) {
    // sprawdza który użytkownik z danej sekcji zapisaj już swój czas wejścia w bazie
    users.forEach((user) => {
      cardData.forEach((card) => {
        if (user.ID === card.userID) {
          // znaleziony użytkownik
          newCardData.push(card);
        }
      });
    });

    // sprawdza który użytkownik jeszcze nie zapisał swojego czasu przyjścia w bazie
    users.forEach((user) => {
      let flag = true;
      newCardData.forEach((newCard) => {
        if (newCard.userID === user.ID) {
          flag = false;
        }
      });

      if (flag) {
        addEmptyUser(user);
        flag = true;
      }
    });
  }

  // Etykieta działu do nagłówka tablicy — slug (`spedycja`) jest kluczem
  // technicznym, a na ścianie ma stać nazwa dla ludzi.
  const sectionRow = getSection(context.params.id);

  return {
    props: {
      newCardData,
      id: context.params.id,
      sectionLabel: sectionRow?.label ?? context.params.id,
      // Doba robocza zaczyna się o 3:00, więc „dzisiaj” na tablicy to nie
      // zawsze dzisiaj w kalendarzu — stąd data prosto z serwera.
      workdayLabel: dayjs(toDay).format("dddd, D MMMM YYYY"),
    },
  };
};

export default function Home({ newCardData, id, sectionLabel, workdayLabel }) {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/");
    }
    // Dostęp rozstrzyga już getServerSideProps (własna sekcja albo zasięg
    // kierownika). Porównanie sekcji zostawione tu wyrzucałoby kierownika
    // z sekcji, którą ma prawo oglądać, a której sam nie jest członkiem.
  }, [session, status]);
  // const { data } = useSWR(`/api/section/${id}`, jsonFetcher, { initialData: cardData });
  const data = undefined;

  if (status !== "authenticated") {
    // console.log(`loading`);
    return <Spinner />;
  }

  const cards = data != undefined ? data : newCardData;

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
          {/* Klucz po userID, nie po ID: wiersze z tabeli Times mają `airtableID`
              (patrz services/getSectionTime.js), a `ID` tylko kafelki dorobione
              dla nieobecnych — czyli połowa listy szła bez klucza i React mógł
              podmienić stan licznika między osobami. */}
          {cards.map((card) => (
            <Card data={card} key={card.userID} />
          ))}
        </div>
      )}
    </BaseLayout>
  );
}
