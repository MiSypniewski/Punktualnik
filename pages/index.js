import Person from "../components/person";
import Clock from "../components/clock";
import getRecentTimes from "../services/getTime";
import getUsers from "../services/getUsers";
import useSWR from "swr";
import { jsonFetcher } from "../utils";
import moment from "moment";

export const getStaticProps = async () => {
  const times = await getRecentTimes(moment().format("DD-MM-YYYY"));
  const users = await getUsers("Biedronka");

  return {
    props: {
      times,
      users,
    },
  };
};

export default function Home({ times, users }) {
  const { data } = useSWR("/api/times", jsonFetcher, { initialData: times });
  console.log(data);

  return (
    <div className="lg:container mx-auto bg-white">
      {/* <h1 className="text-center font-bold text-3xl py-1 px-2">Punktualnik</h1> */}
      {/* <p className="text-center">13-10-2021 09:11</p> */}
      <div className="grid grid-cols-3 gap-4 mt-4">
        {users.map((user) => (
          <Person
            name={user.Name}
            surname={user.Surname}
            location={user.Location}
            section={user.Section}
            key={user.ID}
          />
        ))}
      </div>
      {/* <div className="grid grid-cols-3 gap-4 justify-items-center mt-4">
        {userList.map((user) => (
          <Clock name={user} key={user} />
        ))}
      </div> */}
    </div>
  );
}
