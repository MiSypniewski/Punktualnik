import getSectionTime from "../../services/getSectionTime";
import useSWR from "swr";
import BaseLayout from "../../components/baseLayout";
import Card from "../../components/card";
import dayjs from "dayjs";
import "dayjs/locale/pl";
dayjs.locale("pl");

export const getServerSideProps = async (context) => {
  const toDay = dayjs().hour(3).minute(0).second(0).millisecond(0).format();
  const cardData = await getSectionTime(context.params.id, toDay);

  return {
    props: {
      cardData,
      id: context.params.id,
    },
  };
};

export default function Home({ cardData, id }) {
  // const { data } = useSWR(`/api/section/${id}`, jsonFetcher, { initialData: cardData });
  const data = undefined;

  return (
    <BaseLayout>
      <div className="lg:container mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-1 p-2">
        {data != undefined
          ? data.map((data) => <Card data={data} key={data.ID} />)
          : cardData.map((data) => <Card data={data} key={data.ID} />)}
      </div>
    </BaseLayout>
  );
}
