import { useState, useEffect } from "react";
import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import moment from "moment";
import { getCurrentTime } from "../utils";

const TopNavigation = () => {
  const [isOpen, setIsOpen] = useState(false);
  const { data: session, status } = useSession();
  const loading = status === "loading";
  const [intervalID, setIntervalID] = useState(null);
  const [firtstRun, setFirstRun] = useState(false);
  const [counter, setCounter] = useState(0);

  moment.locale("pl");
  const date = moment().locale("pl").format("dddd, D MMMM YYYY, ");
  const time = getCurrentTime();

  // useEffect(() => {
  //   if (!firtstRun) {
  //     setInterval(() => {
  //       if (moment().format("HH:mm:ss") === "03:15:00") router.reload();
  //       setCounter((prevState) => {
  //         const newState = (prevState += 1);
  //         return newState;
  //       });
  //     }, 1000);
  //     setIntervalID(intervalID);
  //     setFirstRun(true);
  //   }
  // }, [firtstRun]);

  return (
    <div className="flex gap-6 w-full px-4 py-1">
      <p className="capitalize flex-grow font-bold">{`${date} ${time}`}</p>
      {/* <p className="text-center flex-grow">Pysznej kawusi...</p> */}
      <p className="capitalize font-bold">{session ? session.user.section : "Zaloguj się"}</p>
    </div>
  );
};

export default function BaseLayout({ children }) {
  return (
    <>
      <TopNavigation />
      {children}
      {/* <Footer /> */}
    </>
  );
}
