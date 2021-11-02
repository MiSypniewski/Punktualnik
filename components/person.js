import { useState, useEffect } from "react";
import moment from "moment";

const Person = ({ time }) => {
  moment.locale("pl");

  const [status, setStatus] = useState(time.status);
  const [startTime, setStartTime] = useState(moment(time.startTime).format());
  const [endTime, setEndTime] = useState(moment(time.endTime).format());
  const [timeNow, setTimeNow] = useState(moment(time.differenceTime).format());
  const [intervalID, setIntervalID] = useState(null);
  const [overTime, setOverTime] = useState(time.overTime);

  useEffect(() => {
    if (moment(timeNow).format("HH:mm:ss") === "00:00:00" && !overTime) {
      clearInterval(intervalID);
      setOverTime(true);
      setStatus("overTime");
    }
    if (moment(timeNow).format("HH:mm:ss") === "23:59:50" && overTime) {
      setStatus("finishWork");
    }
  });

  useEffect(() => {
    switch (status) {
      // case "startWork": {
      //
      // break;
      // }
      case "workInProgress": {
        const timeNow = moment();
        const tmp = moment(endTime).subtract(timeNow).format();
        const diff = moment(tmp).subtract(1, "hour").format();
        setTimeNow(diff);
        DownTimer();
        saveToDB();
        break;
      }
      case "finishWork": {
        setEndTime(moment().format());
        clearInterval(intervalID);
        saveToDB();
        break;
      }
      case "overTime": {
        const timeNow = moment();
        const diff = moment(timeNow).diff(moment(endTime));
        setTimeNow(checkDiff(timeNow, diff));
        UpTimer();
        saveToDB();
        break;
      }
      default:
        console.log("nieobsługiwany status");
    }
  }, [status]);

  const checkDiff = (timeNow, diff) => {
    console.log(`diff`);
    console.log(diff);
    if (diff <= 0) {
      const tmp = moment(endTime).add(1, "hours").format();
      return moment(timeNow).diff(moment(tmp));
    } else {
      return moment(diff).format();
    }
  };

  // GOTOWY na przyjście --> Guzik wyświtla napis "przyjście" - status - WAIT
  // OBECNY W PRACY --> Guzik wyświtla napis "wcześniejsze wyjście" - status - STARTWORK
  // PRACA ---> Guzik wyświtla napis "wcześniejsze wyjście" - status - workInProgress
  // WYJŚCIE PRZED CZASEM --> Guzik wyświtla napis "koniec pracy" - status - ENDHOME
  // WYJŚCIE PO 8h --> Guzik wyświtla napis "koniec pracy" - status - ENDHOME
  // czy były nadgodziny? --> status - FALSE - wcześniejsze wyjście; status - TRUE - wyjście po 8h

  const saveToDB = async () => {
    const payload = {
      userID: time.userID,
      name: time.name,
      surname: time.surname,
      section: time.section,
      location: time.location,
      data: moment(time.data).format(),
      startTime: moment(startTime).format(),
      endTime: moment(endTime).format(),
      differenceTime: moment(timeNow).format(),
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

  const changeStatus = (status) => {
    if (status === "startWork") {
      const timeNow = moment().format();
      const timeEnd = moment(timeNow).add(8, "hours").format();
      setStartTime(timeNow);
      setEndTime(timeEnd);
      setStatus("workInProgress");
    }
    // if (status === "workInProgress") {
    //   DownTimer();
    // }
    if (status === "endWork") {
      setStatus("finishWork");
    }
    if (status === "overTime") {
      setStatus("finishWork");
    }
  };

  const UpTimer = () => {
    const intervalID = setInterval(() => {
      setTimeNow((prevState) => {
        const newState = moment(prevState).add(1, "seconds");
        return newState;
      });
    }, 1000);
    setIntervalID(intervalID);
  };

  const DownTimer = () => {
    const intervalID = setInterval(() => {
      setTimeNow((prevState) => {
        const newState = moment(prevState).subtract(1, "seconds");
        return newState;
      });
    }, 1000);
    setIntervalID(intervalID);
  };

  return (
    <div className="w-full h-40 rounded-lg bg-blue-300 text-center p-2 shadow-xl">
      <h2 className="mt-1 text-xl font-bold">
        {time.name} {time.surname}
      </h2>
      <p className="py-1 text-2xl mt-1">{moment(timeNow).format("HH:mm:ss")}</p>
      <div className="flex py-3">
        {status === "wait" ? (
          <button
            value="startWork"
            onClick={(e) => changeStatus(e.target.value)}
            className="block w-40 h-14 rounded-lg font-bold text-white shadow-lg mx-auto px-4 py-1 bg-green-600 hover:bg-green-700"
          >
            PRZYJŚCIE
          </button>
        ) : null}

        {status === "workInProgress" ? (
          <button
            value="endWork"
            onClick={(e) => changeStatus(e.target.value)}
            className="block w-40 h-14 rounded-lg font-bold text-white shadow-lg mx-auto px-4 py-1 bg-red-600 hover:bg-red-700"
          >
            WCZEŚNIEJSZE WYJŚCIE
          </button>
        ) : null}
        {status === "overTime" ? (
          <button
            value="endWork"
            onClick={(e) => changeStatus(e.target.value)}
            className="block w-40 h-14 rounded-lg font-bold text-white shadow-lg mx-auto px-4 py-1 bg-green-600 hover:bg-green-700"
          >
            WYJŚCIE
          </button>
        ) : null}
        {status === "finishWork" ? (
          <button
            value={status}
            className="block w-40 h-14 rounded-lg font-bold text-white text-4xl shadow-lg mx-auto px-4 py-1 bg-green-600 hover:bg-green-700"
          >
            👍
          </button>
        ) : null}
      </div>
    </div>
  );
};

export default Person;
