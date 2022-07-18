import { useState, useEffect } from "react";
import classNames from "classnames";
import { DifferenceTime, Timer } from "../utils";

import dayjs from "dayjs";
import "dayjs/locale/pl";
dayjs.locale("pl");

const Card = ({ data }) => {
  // console.log(data);
  const [status, setStatus] = useState(data.status);
  const [startTime, setStartTime] = useState(data.startTime);
  const [endTime, setEndTime] = useState(data.endTime);
  const [goHomeTime, setGoHomeTime] = useState("");
  const [displayTime, setDisplayTime] = useState("");
  const [overTime, setOverTime] = useState(false);
  const [intervalID, setIntervalID] = useState(null);

  let statusClass = classNames("flex sm:w-auto md:w-auto lg:w-full h-30 rounded-lg  text-center p-2 shadow-xl", {
    "bg-blue-400 hover:bg-blue-500": status === "wait",
    "bg-red-500 hover:bg-red-600": status === "workInProgress",
    "bg-yellow-600 hover:bg-yellow-700": status === "overTime",
    "bg-green-600 hover:bg-green-700": status === "finishWork" && overTime,
    "bg-red-600 hover:bg-red-700": status === "finishWork" && !overTime,
  });

  const icon = () => {
    if (status === "wait") return "👊";
    if (status === "workInProgress") return "⏱";
    if (status === "overTime") return "👋";
    if (status === "finishWork" && overTime) return "👍";
    if (status === "finishWork" && !overTime) return "👎";
  };

  const changeStatus = () => {
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
        break;
      }
      case "overTime": {
        if (intervalID === null) checker(endTime);
        break;
      }
      case "finishWork": {
        clearInterval(intervalID);
        const res = DifferenceTime(startTime, endTime);
        setOverTime(res.overtime);
        setDisplayTime(res.time);
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
