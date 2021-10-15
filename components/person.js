import { useState, useEffect } from "react";
import moment from "moment";

const Person = ({ name, surname, section, location }) => {
  moment.locale("pl");

  const [status, setStatus] = useState("PRZYJŚCIE");
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(0);
  const [time, setTime] = useState(0);
  const [intervalID, setIntervalID] = useState(null);
  const [overtime, setOverTime] = useState(false);

  useEffect(() => {
    if (moment(time).format("HH:mm:ss") === "00:00:00") {
      // console.log(`OVERTIME!`);
      clearInterval(intervalID);
      setStatus("WYJŚCIE");
      setOverTime(true);
      setTime((prevState) => {
        const newState = moment(prevState).add(1, "seconds");
        return newState;
      });
      UpTimer();
    }
  });

  // useEffect(() => {
  //   saveToDB();
  // }, [startTime]);

  // GOTOWY na przyjście --> Guzik wyświtla napis "przyjście" - status - WAIT
  // OBECNY W PRACY --> Guzik wyświtla napis "wcześniejsze wyjście" - status - STARTWORK
  // WYJŚCIE PRZED CZASEM --> Guzik wyświtla napis "koniec pracy" - status - ENDHOME
  // WYJŚCIE PO 8h --> Guzik wyświtla napis "koniec pracy" - status - ENDHOME
  // czy były nadgodziny? --> status - FALSE - wcześniejsze wyjście; status - TRUE - wyjście po 8h

  const saveToDB = async () => {
    const payload = {
      Name: name,
      Surname: surname,
      Section: section,
      Location: location,
      Data: moment().format("DD-MM-YYYY"),
      StartTime: moment(startTime).format("HH:mm:ss"),
      EndTime: moment(endTime).format("HH:mm:ss"),
      DifferenceTime: moment(time).format("HH:mm:ss"),
      OverTime: overtime,
    };

    await fetch("/api/times", {
      method: "POST",
      body: JSON.stringify(payload),
      headers: {
        "Content-Type": "application/json",
      },
    });
  };

  const changeStatus = (status) => {
    if (status === "PRZYJŚCIE") {
      const now = moment.now();
      const timeNow = moment(now);
      const timeEnd = moment(timeNow).add(10, "seconds");
      // const timeEnd = moment(timeNow).add(8, "hours");
      const tmp = moment(timeEnd).subtract(timeNow);
      const remanig = moment(tmp).subtract(1, "hour");
      setStartTime(timeNow);
      setEndTime(timeEnd);
      setTime(remanig);
      DownTimer();
      setStatus("WCZEŚNIEJSZE WYJŚCIE");
    }
    if (status === "WCZEŚNIEJSZE WYJŚCIE") {
      setEndTime(moment.now());
      clearInterval(intervalID);
      setStatus("KONIEC PRACY");
    }
    if (status === "WYJŚCIE") {
      setEndTime(moment.now());
      clearInterval(intervalID);
      setStatus("KONIEC PRACY");
    }
  };

  const UpTimer = () => {
    const intervalID = setInterval(() => {
      setTime((prevState) => {
        const newState = moment(prevState).add(1, "seconds");
        return newState;
      });
    }, 1000);
    setIntervalID(intervalID);
  };

  const DownTimer = () => {
    const intervalID = setInterval(() => {
      setTime((prevState) => {
        const newState = moment(prevState).subtract(1, "seconds");
        return newState;
      });
    }, 1000);
    setIntervalID(intervalID);
  };

  return (
    <div className="w-full h-48 rounded-lg bg-blue-300 text-center p-2 shadow-xl">
      <h2 className="mt-2 text-2xl font-bold">
        {name} {surname}
      </h2>
      <p className="py-1 text-3xl mt-1">
        {time !== 0 ? moment(time).format("HH:mm:ss") : moment().format("DD-MM-YYYY")}
      </p>
      <div className="flex py-3 mt-1">
        {status === "PRZYJŚCIE" ? (
          <button
            value={status}
            onClick={(e) => changeStatus(e.target.value)}
            className="block w-40 h-16 rounded-lg font-bold text-white shadow-lg mx-auto px-4 py-2 bg-green-600 hover:bg-green-700"
          >
            {status}
          </button>
        ) : null}
        {status === "WCZEŚNIEJSZE WYJŚCIE" ? (
          <button
            value={status}
            onClick={(e) => changeStatus(e.target.value)}
            className="block w-40 h-16 rounded-lg font-bold text-white shadow-lg mx-auto px-4 py-2 bg-red-600 hover:bg-red-700"
          >
            {status}
          </button>
        ) : null}
        {status === "WYJŚCIE" ? (
          <button
            value={status}
            onClick={(e) => changeStatus(e.target.value)}
            className="block w-40 h-16 rounded-lg font-bold text-white shadow-lg mx-auto px-4 py-2 bg-green-600 hover:bg-green-700"
          >
            {status}
          </button>
        ) : null}
        {status === "KONIEC PRACY" ? (
          <button
            value={status}
            className="block w-40 h-16 rounded-lg font-bold text-white text-4xl shadow-lg mx-auto px-4 py-2 bg-green-600 hover:bg-green-700"
          >
            👍
          </button>
        ) : null}
        <button
          onClick={() => saveToDB()}
          className="block w-40 h-16 rounded-lg font-bold text-white text-lg shadow-lg mx-auto px-4 py-2 bg-yellow-600 hover:bg-yellow-700"
        >
          Zapisz
        </button>
      </div>
    </div>
  );
};

export default Person;
