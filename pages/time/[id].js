import getSectionTime from "../../services/getSectionTime";
import getUsers from "../../services/getUsers";
import useSWR from "swr";
import BaseLayout from "../../components/baseLayout";
import Card from "../../components/card";
import dayjs from "dayjs";
import "dayjs/locale/pl";
dayjs.locale("pl");

export const getServerSideProps = async (context) => {
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
    console.log(`cardData pełne`);
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

  return {
    props: {
      newCardData,
      id: context.params.id,
    },
  };
};

export default function Home({ newCardData, id }) {
  // const { data } = useSWR(`/api/section/${id}`, jsonFetcher, { initialData: cardData });
  const data = undefined;

  return (
    <BaseLayout>
      <div className="lg:container mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-1 p-2">
        {data != undefined
          ? data.map((data) => <Card data={data} key={data.ID} />)
          : newCardData.map((data) => <Card data={data} key={data.ID} />)}
      </div>
    </BaseLayout>
  );
}
