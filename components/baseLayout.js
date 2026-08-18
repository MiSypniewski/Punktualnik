import Link from "next/link";
import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/router";
import Spinner from "./spinner";
import ThemeToggle from "./themeToggle";
import TimerTitle from "./timerTitle";
import {
  canExportTimes,
  canApproveOvertime,
  canTrackTasks,
  canManageProjects,
  canSeeTeamTasks,
} from "../services/roles";
import dayjs from "dayjs";
import "dayjs/locale/pl";
dayjs.locale("pl");

const TopNavigation = () => {
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
        if (dayjs().format("HH:mm:ss") === "03:30:00") router.reload();
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
    // flex-wrap jest tu konieczne: pozycji w menu przybyło wraz z modułem zadań
    // i na telefonie nie mieszczą się już w jednej linii — bez zawijania
    // wypychały stronę w poziomie i pojawiał się pasek przewijania.
    // Data ma `w-full sm:w-auto`, żeby na wąskim ekranie zajęła własną linię,
    // a nie wciskała linki w resztę miejsca.
    <div className="flex flex-wrap items-baseline gap-x-4 sm:gap-x-6 gap-y-1 w-full px-4 py-1">
      <Link href={`/`}>
        <a className="first-letter:uppercase w-full sm:w-auto sm:flex-grow font-bold">
          {dayjs().format(`dddd, DD MMMM YYYY, HH:mm:ss `)}
        </a>
      </Link>
      {/* Kiosk (editor) nie raportuje zadań — konto jest współdzielone, więc
          wpis nie miałby właściciela. Stąd link tylko dla canTrackTasks. */}
      {canTrackTasks(session.user.role) && (
        <Link href={`/zadania`}>
          <a className="font-bold hover:underline">Zadania</a>
        </Link>
      )}
      <Link href={`/nadgodziny`}>
        <a className="font-bold hover:underline">Nadgodziny</a>
      </Link>
      {canSeeTeamTasks(session.user.role) && (
        <Link href={`/zadania/zarzadzaj`}>
          <a className="font-bold hover:underline">Raport zadań</a>
        </Link>
      )}
      {canManageProjects(session.user.role) && (
        <Link href={`/zadania/projekty`}>
          <a className="font-bold hover:underline">Projekty</a>
        </Link>
      )}
      {canExportTimes(session.user.role) && (
        <Link href={`/utils/eksport`}>
          <a className="font-bold hover:underline">Eksport</a>
        </Link>
      )}
      {canApproveOvertime(session.user.role) && (
        <Link href={`/nadgodziny/zarzadzaj`}>
          <a className="font-bold hover:underline">Panel kierownika</a>
        </Link>
      )}
      {session.user.role === "editor" ? (
        // Konto edytora to wspólny kiosk z ekranem dotykowym — świadomie BEZ
        // linku, żeby pracownicy klikający w kafelki nie trafili stąd
        // na zmianę hasła ani na wylogowanie całego stanowiska.
        <p className="capitalize font-bold">{session.user.name}</p>
      ) : (
        <Link href={`/users/${session.user.userID}`}>
          <a className="capitalize font-bold hover:underline">{session.user.name}</a>
        </Link>
      )}
      {/* Także dla kiosku: stoi w konkretnym pomieszczeniu i bywa, że trzeba mu
          po prostu przygasić ekran. To ustawienie wyglądu, nie konta — nie ma
          czego przestawić na cudzą szkodę. */}
      <ThemeToggle />
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
    return (
      <div>
        <p className="text-center mt-20"> Ładowanie ...</p>
        <Spinner />
      </div>
    );
  }

  if (session === null && status === "unauthenticated") {
    return (
      <div>
        <p className="text-center mt-20"> Przekierowanie ...</p>
        <Spinner />
      </div>
    );
  }

  // console.log(session.user);
  return (
    <>
      {/* Timer w pasku karty na KAŻDEJ stronie — stąd tutaj, a nie na /zadania.
          Kiosk (`editor`) nie raportuje zadań, więc nie ma własnego timera i nie
          ma po co odpytywać serwera. */}
      {canTrackTasks(session.user.role) && <TimerTitle />}
      <TopNavigation />
      {children}
      {/* <Footer /> */}
    </>
  );
}
