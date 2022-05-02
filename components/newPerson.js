import { useState, useEffect } from "react";
import moment from "moment";
import classNames from "classnames";

const NewPerson = ({ time }) => {
  moment.locale("pl");

  const [status, setStatus] = useState(time.status);
  const [startTime, setStartTime] = useState(moment(time.startTime).format());
  const [endTime, setEndTime] = useState(moment(time.endTime).format());
  const [timeNow, setTimeNow] = useState(moment(time.differenceTime).format()); //<--- zmienić nazwę zmiennej!!!
  const [intervalID, setIntervalID] = useState(null);
  const [overTime, setOverTime] = useState(time.overTime);
  const [message, setMessage] = useState("Dzień Dobry");

  useEffect(() => {
    if (moment(timeNow).utcOffset(0).format("HH:mm:ss") === "00:00:00" && !overTime) {
      clearInterval(intervalID);
      setOverTime(true);
      setStatus("overTime");
    }
    if (moment(timeNow).utcOffset(0).format("HH:mm:ss") === "23:59:50" && overTime) {
      setStatus("finishWork");
    }
  });

  useEffect(() => {
    clearInterval(intervalID);
    console.log(`uruchamiam useEffect`);
    switch (status) {
      case "workInProgress": {
        const timeNow = moment();
        const diff = moment(endTime).subtract(timeNow).format();
        setTimeNow(diff);
        if (checktime(endTime)) {
          setStatus("overTime");
          setOverTime(true);
        } else {
          DownTimer();
        }
        break;
      }
      case "overTime": {
        const timeNow = moment();
        const diff = moment(timeNow).diff(moment(endTime));
        setTimeNow(diff);
        UpTimer();
        break;
      }
      case "finishWork": {
        clearInterval(intervalID);
        setMessage("Do widzenia!");
        break;
      }
      default:
        console.log("nieobsługiwany status");
    }
  }, [status]);

  const checktime = (endTime) => {
    const check = moment().isSameOrAfter(endTime);
    //false = "za 2 minuty"
    return check;
  };

  // GOTOWY na przyjście --> Guzik wyświtla napis "przyjście" - status - WAIT
  // OBECNY W PRACY --> Guzik wyświtla napis "wcześniejsze wyjście" - status - STARTWORK
  // PRACA ---> Guzik wyświtla napis "wcześniejsze wyjście" - status - workInProgress
  // WYJŚCIE PRZED CZASEM --> Guzik wyświtla napis "koniec pracy" - status - ENDHOME
  // WYJŚCIE PO 8h --> Guzik wyświtla napis "koniec pracy" - status - ENDHOME
  // czy były nadgodziny? --> status - FALSE - wcześniejsze wyjście; status - TRUE - wyjście po 8h

  const saveToDB = async (timeStart, timeEnd, differenceTime, status, overTime = false) => {
    const payload = {
      userID: time.userID,
      name: time.name,
      surname: time.surname,
      section: time.section,
      location: time.location,
      data: moment(time.data).format(),
      startTime: moment(timeStart).format(),
      endTime: moment(timeEnd).format(),
      differenceTime: moment(differenceTime).format(),
      status: status,
      overTime: overTime,
    };

    await fetch(`/api/time/${time.airtableID}`, {
      method: "PUT",
      body: JSON.stringify(payload),
      headers: {
        "Content-Type": "application/json",
      },
    });
  };

  const changeStatus = () => {
    if (status === "wait") {
      const timeStart = moment().format();
      const timeEnd = moment(timeStart).add(8, "hours").format();
      const differenceTime = moment(timeStart).add(8, "hours").format();
      const status = "workInProgress";
      setStartTime(timeStart);
      setEndTime(timeEnd);
      setStatus(status);
      saveToDB(timeStart, timeEnd, differenceTime, status);
    }
    if (status === "workInProgress") {
      const timeStart = moment(startTime).format();
      const timeEnd = moment().format();
      const differenceTime = moment(timeEnd).diff(moment(timeStart));
      const status = "finishWork";
      setEndTime(timeEnd);
      setStatus(status);
      saveToDB(timeStart, timeEnd, differenceTime, status, overTime);
    }

    if (status === "overTime") {
      const timeStart = moment(startTime).format();
      const timeEnd = moment().format();
      const differenceTime = moment(timeEnd).diff(moment(timeStart));
      const status = "finishWork";
      const overTime = true;
      setEndTime(timeEnd);
      setStatus(status);
      saveToDB(timeStart, timeEnd, differenceTime, status, overTime);
    }
    //ten status nie powienien działać -- zostawiam wrazie awarii
    if (status === "endWork") {
      const timeStart = moment(startTime).format();
      const timeEnd = moment().format();
      const differenceTime = moment(timeEnd).diff(moment(timeStart));
      const status = "finishWork";
      setEndTime(timeEnd);
      setStatus(status);
      saveToDB(timeStart, timeEnd, differenceTime, status, overTime);
    }
  };

  const UpTimer = () => {
    const intervalID = setInterval(() => {
      const timeNow = moment();
      const diff = moment(timeNow).diff(moment(endTime));
      setTimeNow(diff);
    }, 1000);
    setIntervalID(intervalID);
  };

  const DownTimer = () => {
    const intervalID = setInterval(() => {
      const timeNow = moment();
      const diff = moment(endTime).subtract(timeNow).format();
      setTimeNow(diff);
    }, 1000);
    setIntervalID(intervalID);
  };

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

  const textDisplay = () => {
    if (status === "wait") return "Dzień Dobry";
    else return moment(timeNow).utcOffset(0).format("HH:mm:ss");
  };

  return (
    <div className={statusClass} onClick={() => changeStatus()}>
      <div className="flex justify-center items-center w-24 h-24 rounded-full text-6xl mx-auto px-4 py-3">{icon()}</div>
      <div className="flex-grow">
        <h2 className="mt-5 text-xl font-bold">
          {time.name} {time.surname}
        </h2>
        <p className="py-1 text-2xl mt-1">{textDisplay()}</p>
      </div>
    </div>
  );
};

export default NewPerson;
