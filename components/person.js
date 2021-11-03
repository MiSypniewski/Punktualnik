import { useState, useEffect } from "react";
import moment from "moment";

const Person = ({ time }) => {
  moment.locale("pl");

  const [status, setStatus] = useState(time.status);
  const [startTime, setStartTime] = useState(moment(time.startTime).format());
  const [endTime, setEndTime] = useState(moment(time.endTime).format());
  const [timeNow, setTimeNow] = useState(moment(time.differenceTime).format()); //<--- zmienić nazwę zmiennej!!!
  const [intervalID, setIntervalID] = useState(null);
  const [overTime, setOverTime] = useState(time.overTime);
  const [message, setMessage] = useState("Dzień Dobry");

  useEffect(() => {
    // checktime(endTime);
    if (moment(timeNow).zone(0).format("HH:mm:ss") === "00:00:00" && !overTime) {
      console.log();
      clearInterval(intervalID);
      setOverTime(true);
      setStatus("overTime");
      // checktime(endTime);
    }
    if (moment(timeNow).zone(0).format("HH:mm:ss") === "23:59:50" && overTime) {
      setStatus("finishWork");
    }
    // setInterval(() => {
    //   checktime(time.endTime);
    // }, 1000);
  });

  useEffect(() => {
    switch (status) {
      // case "startWork": {
      //
      // break;
      // }
      case "workInProgress": {
        const timeNow = moment();
        const diff = moment(endTime).subtract(timeNow).format();
        // const diff = moment(tmp).subtract(1, "hour").format();
        setTimeNow(diff);
        // setTimeNow(checktime(endTime));
        if (checktime(endTime)) {
          setStatus("overTime");
        } else {
          DownTimer();
        }

        // checktime(endTime);
        // saveToDB();
        break;
      }
      case "finishWork": {
        setEndTime(moment().format());
        clearInterval(intervalID);
        setMessage("Do widzenia!");
        break;
      }
      case "overTime": {
        const timeNow = moment();
        const diff = moment(timeNow).diff(moment(endTime));
        setTimeNow(diff);
        // setTimeNow(checktime(endTime));
        UpTimer();
        // saveToDB();
        break;
      }
      default:
        console.log("nieobsługiwany status");
    }
  }, [status]);

  //zmienić wyśtalnie na moment().to i moment().toNow()

  const checktime = (endTime) => {
    const check = moment().isSameOrAfter(endTime);
    //false = "za 2 minuty"
    moment.locale("pl");
    setMessage(moment().to(endTime));
    console.log(moment().to(endTime));

    return check;
    if (check) {
      clearInterval(intervalID);
      setStatus("overTime");
      setOverTime(true);
    }
    // const check = moment(moment().format()).diff(endTime);
    // const check = moment(moment().format()).isAfter(endTime);
    // console.log(check);
    // if (check > 0) {
    //   console.log(`check dodatni: ${check}`);
    //   setOverTime(true);
    //   setStatus("overTime");
    //   return moment(check).format();
    // } else if (check < 0) {
    //   console.log(`check ujemny: ${check}`);
    //   return moment(check).format();
    // } else {
    //   console.log(`check taki sam: ${check}`);
    //   setStatus("overTime");
    //   setOverTime(true);
    //   return moment(check).subtract(1, "hours").format();
    // }
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

  const changeStatus = (status) => {
    if (status === "startWork") {
      const timeStart = moment().format();
      const timeEnd = moment(timeStart).add(8, "hours").format();
      const differenceTime = moment(timeStart).hours(8).format();
      const status = "workInProgress";
      setStartTime(timeStart);
      setEndTime(timeEnd);
      setStatus(status);
      saveToDB(timeStart, timeEnd, differenceTime, status);
    }
    // if (status === "workInProgress") {
    //   DownTimer();
    // }
    if (status === "endWork") {
      const timeStart = moment(startTime).format();
      const timeEnd = moment().format();
      const differenceTime = moment(timeEnd).diff(moment(timeStart)); // zmienić na pradziwą wartość z OBLICZENIA!!!!
      const status = "finishWork";
      console.log(differenceTime);
      setEndTime(timeEnd);
      setStatus(status);
      saveToDB(timeStart, timeEnd, differenceTime, status, overTime);
    }
    if (status === "overTime") {
      const timeStart = moment(startTime).format();
      const timeEnd = moment().format();
      const differenceTime = moment(timeEnd).diff(moment(timeStart)); // zmienić na pradziwą wartość z OBLICZENIA!!!!
      const status = "finishWork";
      const overTime = true;
      console.log(differenceTime);
      setEndTime(timeEnd);
      setStatus(status);
      saveToDB(timeStart, timeEnd, differenceTime, status, overTime);
    }
  };

  const UpTimer = () => {
    const intervalID = setInterval(() => {
      setTimeNow((prevState) => {
        const newState = moment(prevState).add(1, "seconds");
        return newState;
      });
    }, 1000);
    // checktime(time.endTime);
    setIntervalID(intervalID);
  };

  const DownTimer = () => {
    const intervalID = setInterval(() => {
      setTimeNow((prevState) => {
        const newState = moment(prevState).subtract(1, "seconds");
        return newState;
      });
      // checktime(time.endTime);
    }, 1000);
    setIntervalID(intervalID);
  };

  return (
    <div className="sm:w-auto md:w-auto lg:w-full h-40 rounded-lg bg-blue-300 text-center p-2 shadow-xl">
      <h2 className="mt-1 text-xl font-bold">
        {time.name} {time.surname}
      </h2>
      <p className="py-1 text-2xl mt-1">{moment(timeNow).zone(0).format("HH:mm:ss")}</p>
      {/* <p className="py-1 text-2xl mt-1">{message}</p> */}
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
