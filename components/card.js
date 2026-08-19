import { useState, useEffect } from "react";
import classNames from "classnames";
import { useSession } from "next-auth/react";
import { canPunchCards } from "../services/roles";
import { DifferenceTime, Timer } from "../utils";
import LiveDot from "./liveDot";

import dayjs from "dayjs";
import "dayjs/locale/pl";
dayjs.locale("pl");

// Kafelek pracownika na tablicy sekcji — ekran oglądany z drugiego końca
// pomieszczenia, więc rządzi nim czytelność z dystansu: nazwisko wersalikami,
// licznik monospace na 2,5 rem, status słowem.
//
// Emoji (👊 ⏱ 👋 👍 👎) wyleciały: nie skalowały się, nie dawały się odczytać
// pod kątem i oceniały pracownika (kciuk w dół za krótszą dniówkę), zamiast
// nazwać stan.
//
// Kolory kodują to samo co w reszcie aplikacji: bursztyn znaczy „teraz”,
// zieleń „zamknięte i pełne”, czerwień „zamknięte, ale krótsze niż osiem
// godzin”. Wcześniej „w pracy” było czerwone, a „zakończono” raz zielone, raz
// czerwone — ten sam kolor znaczył dwie różne rzeczy.
const STATES = {
  wait: {
    label: "Nie odbito",
    plate: "bg-surface border-dashed border-line-strong text-muted",
    caption: { punch: "Dotknij, aby odbić wejście", watch: "Brak odbicia" },
  },
  workInProgress: {
    label: "W pracy",
    plate: "bg-signal-soft border-signal text-signal-strong",
    caption: { punch: "Do końca dniówki · dotknij, aby wyjść", watch: "Do końca dniówki" },
    live: true,
  },
  overTime: {
    label: "Nadgodziny",
    plate: "bg-signal border-signal text-signal-ink",
    caption: { punch: "Ponad osiem godzin · dotknij, aby wyjść", watch: "Ponad osiem godzin" },
    live: true,
  },
  finishFull: {
    label: "Zakończono",
    plate: "bg-ok-soft border-ok/60 text-ok-strong",
    caption: { punch: "Przepracowano", watch: "Przepracowano" },
  },
  finishShort: {
    label: "Niepełna dniówka",
    plate: "bg-danger-soft border-danger/60 text-danger-strong",
    caption: { punch: "Przepracowano", watch: "Przepracowano" },
  },
};

const Card = ({ data }) => {
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
      await fetch(`/api/time/${airtableID}`, {
        method: "PUT",
        body: JSON.stringify(payload),
        headers: {
          "Content-Type": "application/json",
        },
      });
    }

    // jeżeli nie ma wpisu w bazie, tworzy nowy wpis i aktualizuje ID w komponencie
    if (!airtableID) {
      await fetch(`/api/time/${data.ID}`, {
        method: "POST",
        body: JSON.stringify(payload),
        headers: {
          "Content-Type": "application/json",
        },
      });

      fetch(`/api/time/${data.userID}`, {
        method: "GET",
      })
        .then((res) => res.json())
        .then((data) => {
          setAirtableID(data[0].airtableID);
        });
    }
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
        setDisplayTime("");
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
        setDisplayTime("");
    }
  }, [status, overTime]);

  const stateKey = status === "finishWork" ? (overTime ? "finishFull" : "finishShort") : status;
  const state = STATES[stateKey] || STATES.wait;
  const punched = status !== "wait";

  return (
    <div
      className={classNames(
        "flex flex-col justify-between min-h-[8.5rem] p-4 border-2 rounded",
        state.plate,
        canPunch ? "cursor-pointer" : "cursor-default"
      )}
      onClick={canPunch ? () => changeStatus() : undefined}
      onKeyDown={
        canPunch
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                changeStatus();
              }
            }
          : undefined
      }
      role={canPunch ? "button" : undefined}
      tabIndex={canPunch ? 0 : undefined}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-signage">
          {state.live && <LiveDot tone="current" />}
          {state.label}
        </span>
        {punched && (
          <span className="font-mono text-xs tabular-nums opacity-80">od {dayjs(startTime).format("HH:mm")}</span>
        )}
      </div>

      <div className="mt-3">
        <p className="text-lg font-bold uppercase tracking-wide leading-tight truncate" title={`${data.surname} ${data.name}`}>
          {data.surname}
        </p>
        <p className="text-sm opacity-80 truncate">{data.name}</p>
      </div>

      <div className="mt-3">
        <p className="font-mono text-3xl sm:text-4xl font-medium tabular-nums leading-none">
          {displayTime || "--:--:--"}
        </p>
        <p className="mt-1.5 text-xs opacity-80">{canPunch ? state.caption.punch : state.caption.watch}</p>
      </div>
    </div>
  );
};

export default Card;
