import { useState } from "react";
import { useRouter } from "next/router";
import Person from "../../components/person";
import Clock from "../../components/clock";
import getTime from "../../services/getTime";
import getUsers from "../../services/getUsers";
import useSWR from "swr";
import { jsonFetcher } from "../../utils";
import moment from "moment";

export const getServerSideProps = async (context) => {
  const users = await getUsers(context.params.id);
  const data = [];
  if (users.length) {
    users.forEach(async (user) => {
      const [time] = await getTime(user.ID, moment().format("DD-MM-YYYY"));
      if (time) {
        //znalazł czas pracy dandego użytkownika
      }
      console.log(`czas użytkownika`);
      console.log(user);
      console.log(time);
    });
  }

  return {
    props: {
      // times,
      users,
    },
  };
};

export default function Home({ users }) {
  const router = useRouter();
  if (!users.length) {
    // router.push(`/`);
  }

  // const { data } = useSWR("/api/times", jsonFetcher, { initialData: times });
  // console.log(data);
  return (
    <div className="lg:container mx-auto bg-white">
      {/* <h1 className="text-center font-bold text-3xl py-1 px-2">Punktualnik</h1> */}
      {/* <p className="text-center">13-10-2021 09:11</p> */}
      <div className="grid grid-cols-3 gap-4 mt-4">
        {users.map((user) => (
          <Person user={user} key={user.ID} />
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
