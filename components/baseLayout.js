import Link from "next/link";
import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/router";
import dayjs from "dayjs";
import "dayjs/locale/pl";
dayjs.locale("pl");

const TopNavigation = ({ section }) => {
  const [isOpen, setIsOpen] = useState(false);
  const { data: session } = useSession();

  // const loading = status === "loading";
  const [intervalID, setIntervalID] = useState(null);
  const [firtstRun, setFirstRun] = useState(false);
  const [counter, setCounter] = useState(0);
  const router = useRouter();

  useEffect(() => {
    if (!firtstRun) {
      setInterval(() => {
        if (dayjs().format("HH:mm:ss") === "08:30:00") router.reload();
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
    <div className="flex gap-6 w-full px-4 py-1">
      <Link href={`/`}>
        <a className="capitalize flex-grow font-bold">{dayjs().format(`dddd, DD MMMM YYYY, HH:mm:ss `)}</a>
      </Link>
      {session.user.role === "user" ? (
        <Link href={`/users/${session.user.userID}`}>
          <a className="capitalize font-bold">{session.user.name}</a>
        </Link>
      ) : (
        <p className="capitalize font-bold">{section}</p>
      )}
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
    // console.log(`loading`);
    return <div> ładowanie ... </div>;
  }

  if (session === null && status === "unauthenticated") {
    return <div>przekierowanie ...</div>;
  }

  // console.log(session.user);
  return (
    <>
      <TopNavigation section={session.user.name} />
      {children}
      {/* <Footer /> */}
    </>
  );
}
