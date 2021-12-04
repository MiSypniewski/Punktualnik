import { useState, useEffect } from "react";
import router, { useRouter } from "next/router";
import Person from "../../components/person";
import NewPerson from "../../components/newPerson";
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
  // moment.locale("pl");
  // const t = moment().format("LLLL");
  // console.log(t);
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
    <div className="bg-white">
      {/* <h1 className="text-center font-bold text-3xl py-1 px-2">{firtstRun ? "Prawda" : "Fałsz"}</h1> */}
      <div className="flex gap-6 w-full px-4 py-1">
        <p className="font-bold">{moment().locale("pl").format("LLLL")}</p>
        <p className="text-center flex-grow">Pysznej kawusi --- jebać kapusi </p>
        <p className="capitalize font-bold">{id}</p>
      </div>
      <div className="lg:container mx-auto grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 mt-1 p-2">
        {data
          ? data.map((time) => <NewPerson time={time} key={time.ID} />)
          : times.map((time) => <NewPerson time={time} key={time.ID} />)}
        {/* {times.map((time) => (
          <NewPerson time={time} key={time.ID} />
        ))} */}
      </div>
    </div>
  );
}
