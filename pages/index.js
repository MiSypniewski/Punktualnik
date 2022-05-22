import Person from "../components/person";
import Clock from "../components/clock";
import Link from "next/link";
// import getRecentTimes from "../services/getTime";
// import getUsers from "../services/getUsers";
import useSWR from "swr";
import { jsonFetcher } from "../utils";
import moment from "moment";
import BaseLayout from "../components/baseLayout";

// export const getStaticProps = async () => {
// const times = await getRecentTimes(moment().format("DD-MM-YYYY"));
// const users = await getUsers("Biedronka");

//zmemić na pobieranie lokalizacji , działów lub możliwość wszystkich!!!

//   return {
//     props: {
//       users: ":]",
//     },
//   };
// };

// export const getServerSideProps = async () => {
//   const times = await getRecentTimes(moment().format("DD-MM-YYYY"));
//   const users = await getUsers("Biedronka");

//   users.forEach((user) => {
//     user.Password = ":)";
//     user.SaltPassword = ":)";
//     return user;
//   });

//   console.log(users);
//   return {
//     props: {
//       times,
//       users,
//     },
//   };
// };

export default function Home({}) {
  // console.log(data);
  // console.log(users);
  return (
    <BaseLayout>
      <div className="lg:container mx-auto bg-white">
        <h1 className="text-center font-bold text-3xl py-1 px-2">opss.pl</h1>
        {/* <p className="text-center">13-10-2021 09:11</p> */}
        <div className="lg:container mx-auto grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-3 gap-4 mt-1 p-2">
          <Link href="https://drive.google.com/file/d/1P4WBxbB-dxMPKv8f26-_WFZ2hv0u03c9/view?usp=sharing">
            <a
              target="_blank"
              rel="noreferrer"
              className="block w-40 h-16 rounded-lg font-bold text-white text-center leading-10 text-lg shadow-lg mx-auto px-4 py-2 bg-green-600 hover:bg-green-700"
            >
              Tapeta
            </a>
          </Link>
          <Link href="https://drive.google.com/file/d/1BM7vNgM6djdokPgp3aaF9aUzDPF9Ce5V/view?usp=sharing">
            <a
              target="_blank"
              rel="noreferrer"
              className="block w-40 h-16 rounded-lg font-bold text-white text-center leading-10 text-lg shadow-lg mx-auto px-4 py-2 bg-blue-600 hover:bg-blue-700"
            >
              Wygaszacz
            </a>
          </Link>
          <Link href="https://drive.google.com/file/d/1Egsu6Ox7mxuDCG4R9WWalDrC0ftAmW9E/view?usp=sharing">
            <a
              target="_blank"
              rel="noreferrer"
              className="block w-40 h-16 rounded-lg font-bold text-white text-center leading-10 text-lg shadow-lg mx-auto px-4 py-2 bg-red-600 hover:bg-red-700"
            >
              Aplikacja
            </a>
          </Link>
          {/* <button
          onClick={() => console.log(`przeniesie do sekcji!`)}
          className="block w-40 h-16 rounded-lg font-bold text-white text-lg shadow-lg mx-auto px-4 py-2 bg-red-600 hover:bg-red-700"
        >
          Biedronka
        </button> */}
          {/* {users.map((user) => (
          <Person
            name={user.Name}
            surname={user.Surname}
            location={user.Location}
            section={user.Section}
            key={user.ID}
          />
        ))} */}
        </div>
        {/* <div className="grid grid-cols-3 gap-4 justify-items-center mt-4">
        {userList.map((user) => (
          <Clock name={user} key={user} />
        ))}
      </div> */}
      </div>
    </BaseLayout>
  );
}
