import { useRouter } from "next/router";
import Person from "../../components/person";
import getSectionTime from "../../services/getSectionTime";
import useSWR from "swr";
import { jsonFetcher } from "../../utils";
import moment from "moment";

export const getServerSideProps = async (context) => {
  const times = await getSectionTime(context.params.id, moment().format("DD-MM-YYYY"));

  return {
    props: {
      times,
    },
  };
};

export default function Home({ times }) {
  // const router = useRouter();
  // if (!users.length) {
  // router.push(`/`);
  // }

  // const { data } = useSWR("/api/times", jsonFetcher, { initialData: times });
  // console.log(users);
  return (
    <div className="lg:container mx-auto bg-white">
      <h1 className="text-center font-bold text-3xl py-1 px-2">Punktualnik</h1>
      <div className="grid grid-cols-3 gap-4 mt-4">
        {times.map((time) => (
          <Person time={time} key={time.ID} />
        ))}
      </div>
    </div>
  );
}
