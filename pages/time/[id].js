import getSectionTime from "../../services/getSectionTime";
import getUsers from "../../services/getUsers";
import useSWR from "swr";
import BaseLayout from "../../components/baseLayout";
import Card from "../../components/card";
import dayjs from "dayjs";
import "dayjs/locale/pl";
dayjs.locale("pl");

export const getServerSideProps = async (context) => {
  const toDay = dayjs().hour(3).minute(0).second(0).millisecond(0).format();
  //pobieranie użytkowników z danej sekcji (contex.params.id)
  const users = await getUsers(context.params.id);
  //pobieranie z bazy dzisiejszych rekordów na podstawie użytkowników
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
    newCardData.push(emptyUser);
  };

  // porównanie czy każdy użytkownik jest zapisany w dzisiejszej bazie.
  if (Array.isArray(cardData) && !cardData.length) {
    // brak zapisanego czasu ŻADNEGO użytkownika w danym dniu
    users.forEach((user) => {
      addEmptyUser(user);
    });
  }

  if (Array.isArray(cardData) && cardData.length) {
    users.forEach((user) => {
      // znalezione czasy użytkowników w bazie
      // console.log(`sprawdzam użytkownika: `, user);
      // sprawdza czy każdy użytkownik z danej sekcji zapisaj już swój czas wejścia
      cardData.forEach((card) => {
        if (user.ID === card.userID) {
          // znaleziony użytkownik
          newCardData.push(card);
        } else {
          // tworzenie pustego użytkownika
          addEmptyUser(user);
        }
      });
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
        {/* problem z użytkownikami pustymi, brak data.ID jako unikatowy KEY */}
        {data != undefined
          ? data.map((data) => <Card data={data} key={data.ID} />)
          : newCardData.map((data) => <Card data={data} key={data.ID} />)}
      </div>
    </BaseLayout>
  );
}
