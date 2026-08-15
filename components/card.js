import { useState, useEffect } from "react";
import classNames from "classnames";
import { useSession } from "next-auth/react";
import { canPunchCards } from "../services/roles";
import { DifferenceTime, Timer } from "../utils";

import dayjs from "dayjs";
import "dayjs/locale/pl";
dayjs.locale("pl");

const Card = ({ data }) => {
  // console.log(data);
  const { data: session } = useSession();
  const [airtableID, setAirtableID] = useState(data.airtableID);
  const [status, setStatus] = useState(data.status);
  const [startTime, setStartTime] = useState(data.startTime);
  const [endTime, setEndTime] = useState(data.endTime);
  const [totalWorkTime, setTotalWorkTime] = useState(data.totalWorkTime);
  const [displayTime, setDisplayTime] = useState("");
  const [overTime, setOverTime] = useState(false);
  const [intervalID, setIntervalID] = useState(null);

  // Kliknąć kartę może wyłącznie stanowisko kiosku. Reszta (kierownik, sam
  // pracownik) ogląda ją jak tablicę — stąd brak podświetlenia pod kursorem
  // i kursor strzałki: karta ma nie udawać, że jest przyciskiem.
  const canPunch = canPunchCards(session?.user?.role);

  let statusClass = classNames(
    "flex sm:w-auto md:w-auto lg:w-full h-30 rounded-lg  text-center p-2 shadow-xl",
    canPunch ? "cursor-pointer" : "cursor-default",
    {
      "bg-blue-400": status === "wait",
      "bg-red-500": status === "workInProgress",
      "bg-yellow-600": status === "overTime",
      "bg-green-600": status === "finishWork" && overTime,
      "bg-red-600": status === "finishWork" && !overTime,
    },
    canPunch && {
      "hover:bg-blue-500": status === "wait",
      "hover:bg-red-600": status === "workInProgress",
      "hover:bg-yellow-700": status === "overTime",
      "hover:bg-green-700": status === "finishWork" && overTime,
      "hover:bg-red-700": status === "finishWork" && !overTime,
    }
  );

  const saveToDB = async (startTime, endTime, totalWorkTime, status, overTime) => {
    // Efekt na dole komponentu odpala zapis także przy samym wejściu na stronę
    // (karta w trakcie pracy). Bez tego warunku przeglądarka kierownika biłaby
    // w API serią żądań, które i tak wracają z 401.
    if (!canPunch) return;

    const payload = {
      userID: data.userID,
      name: data.name,
      surname: data.surname,
      section: data.section,
      location: data.location,
      data: data.data,
      startTime: dayjs(startTime).format(),
      endTime: dayjs(endTime).format(),
      totalWorkTime: totalWorkTime,
      status: status,
      overTime: overTime,
    };

    if (airtableID) {
      const res = await fetch(`/api/time/${airtableID}`, {
        method: "PUT",
        body: JSON.stringify(payload),
        headers: {
          "Content-Type": "application/json",
        },
      });

      // console.log(`update response: `, res);
    }

    // jeżeli nie ma wpisu w bazie, tworzy nowy wpis i aktualizuje ID w komponencie
    if (!airtableID) {
      // console.log(airtableID);
      const res = await fetch(`/api/time/${data.ID}`, {
        method: "POST",
        body: JSON.stringify(payload),
        headers: {
          "Content-Type": "application/json",
        },
      });

      // console.log(`create response: `, res);

      fetch(`/api/time/${data.userID}`, {
        method: "GET",
      })
        .then((res) => res.json())
        .then((data) => {
          // console.log(`Pobrane dane po utworzeniu: `, data);
          setAirtableID(data[0].airtableID);
        });
    }
  };

  const icon = () => {
    if (status === "wait") return "👊";
    if (status === "workInProgress") return "⏱";
    if (status === "overTime") return "👋";
    if (status === "finishWork" && overTime) return "👍";
    if (status === "finishWork" && !overTime) return "👎";
  };

  const changeStatus = () => {
    if (!canPunch) {
      return;
    }
    if (status === "wait") {
      const endTime = dayjs().add(8, "hour").format();
      setStartTime(dayjs().format());
      setEndTime(endTime);
      setStatus("workInProgress");
    }
    if (status === "workInProgress") {
      const endTime = dayjs().format();
      setEndTime(endTime);
      setStatus("finishWork");
    }
    if (status === "overTime") {
      const endTime = dayjs().format();
      setEndTime(endTime);
      setStatus("finishWork");
    }
  };

  const checker = (endTime) => {
    if (!intervalID) {
      const intervalID = setInterval(() => {
        const res = Timer(endTime);
        setOverTime(res.overtime);
        setDisplayTime(res.time);
      }, 1000);
      setIntervalID(intervalID);
    }
  };

  useEffect(() => {
    switch (status) {
      case "wait": {
        setDisplayTime("Dzień Dobry!");
        break;
      }
      case "workInProgress": {
        if (intervalID === null) checker(endTime);
        if (overTime) setStatus("overTime");
        const res = DifferenceTime(startTime, endTime);
        saveToDB(startTime, endTime, res.time, status, res.overTime);
        break;
      }
      case "overTime": {
        if (intervalID === null) checker(endTime);
        break;
      }
      case "finishWork": {
        clearInterval(intervalID);
        const res = DifferenceTime(startTime, endTime);
        setTotalWorkTime(res.time);
        setOverTime(res.overtime);
        setDisplayTime(res.time);
        saveToDB(startTime, endTime, res.time, status, res.overtime);
        break;
      }
      default:
        setDisplayTime("Status nie rozpoznany");
    }
  }, [status, overTime]);

  return (
    <div className={statusClass} onClick={canPunch ? () => changeStatus() : undefined}>
      <div className="flex justify-center items-center w-24 h-24 rounded-full text-6xl mx-auto px-4 py-3">{icon()}</div>
      <div className="flex-grow">
        <h2 className="mt-5 text-xl font-bold">
          {data.name} {data.surname}
        </h2>
        <p className="py-1 text-2xl mt-1">{displayTime}</p>
      </div>
    </div>
  );
};

export default Card;
