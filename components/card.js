import { useState, useEffect } from "react";
import classNames from "classnames";
import Timer from "./timer";

const Card = ({ data }) => {
  const [status, setStatus] = useState(data.status);
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

  const displayRematingTime = () => {
    if (status === "wait") return "Dzień Dobry";
    return Timer(endTime);
  };

  const changeStatus = () => {
    ///zmienić to jutro; Ładnie ustawić
  };

  return (
    <div className={statusClass} onClick={() => changeStatus()}>
      <div className="flex justify-center items-center w-24 h-24 rounded-full text-6xl mx-auto px-4 py-3">{icon()}</div>
      <div className="flex-grow">
        <h2 className="mt-5 text-xl font-bold">
          {data.name} {data.surname}
        </h2>
        <p className="py-1 text-2xl mt-1">{displayRematingTime()}</p>
      </div>
    </div>
  );
};

export default Card;
