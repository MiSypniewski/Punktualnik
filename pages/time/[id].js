import { useState, useEffect } from "react";
import router, { useRouter } from "next/router";
import Person from "../../components/person";
import getSectionTime from "../../services/getSectionTime";
import useSWR from "swr";
import { jsonFetcher } from "../../utils";
import moment from "moment";

export const getServerSideProps = async (context) => {
  moment.locale("pl");
  const now = moment().hours(0).minutes(0).seconds(0).milliseconds(0).format();
  const data = moment(now).hours(3).format();
  const times = await getSectionTime(context.params.id, data);
  // console.log(times);

  return {
    props: {
      times,
      id: context.params.id,
    },
  };
};

export default function Home({ times, id }) {
  // const router = useRouter();
  // if (!users.length) {
  // router.push(`/`);
  // }

  const { data } = useSWR(`/api/section/${id}`, jsonFetcher, { initialData: times });
  // console.log(`data:`);
  // console.log(data);
  // console.log(times);
  const [intervalID, setIntervalID] = useState(null);
  const [firtstRun, setFirstRun] = useState(false);
  const [counter, setCounter] = useState(0);

  useEffect(() => {
    if (!firtstRun) {
      setInterval(() => {
        if (moment().format("HH:mm:ss") === "03:15:00") router.reload();
        setCounter((prevState) => {
          const newState = (prevState += 1);
          return newState;
        });
      }, 1000);
      setIntervalID(intervalID);
      setFirstRun(true);
    }
  }, [firtstRun]);

  return (
    <div className="lg:container mx-auto bg-white">
      {/* <h1 className="text-center font-bold text-3xl py-1 px-2">{firtstRun ? "Prawda" : "Fałsz"}</h1> */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 mt-1 p-2">
        {data
          ? data.map((time) => <Person time={time} key={time.ID} />)
          : times.map((time) => <Person time={time} key={time.ID} />)}
        {/* {times.map((time) => (
          <Person time={time} key={time.ID} />
        ))} */}
      </div>
    </div>
  );
}
