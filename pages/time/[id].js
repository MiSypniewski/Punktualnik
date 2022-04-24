import { useState, useEffect } from "react";
import router, { useRouter } from "next/router";
import Person from "../../components/person";
import NewPerson from "../../components/newPerson";
import getSectionTime from "../../services/getSectionTime";
import useSWR from "swr";
import { jsonFetcher } from "../../utils";
import moment from "moment";
moment.locale("pl");

export const getServerSideProps = async (context) => {
  moment.locale("pl");
  const now = moment().hours(0).minutes(0).seconds(0).milliseconds(0).format();
  const data = moment(now).hours(3).format();
  const times = await getSectionTime(context.params.id, data);
  const date = moment().format("dddd, D MMMM YYYY, ");
  // console.log(times);

  return {
    props: {
      date,
      times,
      id: context.params.id,
    },
  };
};

export default function Home({ times, id, date }) {
  moment.locale("pl");
  const time = moment().format("HH:mm:ss");

  // const router = useRouter();
  // if (!users.length) {
  // router.push(`/`);
  // }
  const { data } = useSWR(`/api/section/${id}`, jsonFetcher, { initialData: times });
  // const { data } = useSWR(`/api/section/${id}`, jsonFetcher);
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
      <div className="flex gap-6 w-full px-4 py-1">
        <p className="capitalize flex-grow font-bold">{`${date} ${time}`}</p>
        {/* <p className="text-center flex-grow">Pysznej kawusi...</p> */}
        <p className="capitalize font-bold">{id}</p>
      </div>
      <div className="lg:container mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-1 p-2">
        {data != undefined
          ? data.map((user) => <NewPerson time={user} key={time.ID} />)
          : times.map((user) => <NewPerson time={user} key={time.ID} />)}
        {/* {times.map((time) => (
          <NewPerson time={time} key={time.ID} />
        ))} */}
      </div>
    </div>
  );
}
