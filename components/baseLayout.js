import { useState, useEffect } from "react";
import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import moment from "moment";
import { getCurrentTime } from "../utils";
import { useRouter } from "next/router";

const TopNavigation = ({ section }) => {
  const [isOpen, setIsOpen] = useState(false);

  // const loading = status === "loading";
  const [intervalID, setIntervalID] = useState(null);
  const [firtstRun, setFirstRun] = useState(false);
  const [counter, setCounter] = useState(0);

  // console.log(loading);

  // moment.locale("pl");
  // const date = moment().locale("pl").format("dddd, D MMMM YYYY, ");
  // const time = getCurrentTime();

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
      {/* <p className="capitalize flex-grow font-bold">{`${moment().format("dddd, D MMMM YYYY, HH:mm:ss")}`}</p> */}
      <p className="capitalize flex-grow font-bold">{`Tutaj będzie data i godzina`}</p>
      {/* <p className="text-center flex-grow">Pysznej kawusi...</p> */}
      <p className="capitalize font-bold">{section}</p>
    </div>
  );
};

export default function BaseLayout({ children }) {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/users/signin");
    }
  }, [session, status]);

  if (status === "loading") {
    console.log(`loading`);
    return <div> ładowanie ...</div>;
  }

  if (session === null && status === "unauthenticated") {
    return <div>przekierowanie ...</div>;
  }

  return (
    <>
      <TopNavigation section={session.user.name} />
      {children}
      {/* <Footer /> */}
    </>
  );
}
