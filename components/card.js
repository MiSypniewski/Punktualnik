import { useState, useEffect } from "react";
import classNames from "classnames";
import { useSession } from "next-auth/react";
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

  let statusClass = classNames(
    "transition-all ease-in-out duration-300 flex sm:w-auto md:w-auto lg:w-full h-30 rounded-lg  text-center p-2 shadow-xl cursor-pointer",
    {
      // "bg-blue-400 hover:bg-blue-500": status === "wait",
      // "bg-gradient-to-br from-blue-400 via-blue-500 to-blue-600 hover:transition-all hover:-translate-y-1 hover:bg-gradient-to-tl hover:from-blue-600 hover:via-blue-500 hover:to-red-400":
      //   status === "wait",
      "bg-gradient-to-br to-red-400 via-blue-600 from-blue-400 bg-size-200 bg-pos-0 hover:bg-pos-100":
        status === "wait",
      // "bg-gradient-to-br from-blue-100 via-blue-300 to-blue-500": status === "wait",
      // "bg-red-500 hover:bg-red-600": status === "workInProgress",
      "bg-gradient-to-br to-yellow-400 via-red-600 from-red-400 bg-size-200 bg-pos-0 hover:bg-pos-100":
        status === "workInProgress",
      "bg-yellow-600 hover:bg-yellow-700": status === "overTime",
      "bg-green-600 hover:bg-green-700": status === "finishWork" && overTime,
      "bg-red-600 hover:bg-red-700": status === "finishWork" && !overTime,
    }
  );

  const saveToDB = async (startTime, endTime, totalWorkTime, status, overTime) => {
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
    if (session.user.role === "user") {
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
    <div className={statusClass} onClick={() => changeStatus()}>
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
