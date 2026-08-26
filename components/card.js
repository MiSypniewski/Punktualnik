import { useState, useEffect, useRef } from "react";
import classNames from "classnames";
import { useSession } from "next-auth/react";
import { canPunchCards } from "../services/roles";
import { absenceKindShort } from "../services/absenceKinds";
import { DifferenceTime, Timer, formatDate } from "../utils";
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
  // Nieobecność zatwierdzona na dziś — urlop, L4, opieka.
  //
  // Paleta NEUTRALNA, świadomie. Bursztyn w tym systemie znaczy wyłącznie
  // „teraz”, zieleń „przepracowane”, czerwień „za krótko” — nieobecność nie jest
  // żadnym z tych trzech. Od „Nie odbito” odróżnia ją ramka ciągła zamiast
  // kreskowanej: kreska znaczy „miejsce jeszcze puste”, a tu nie ma na co czekać.
  //
  // Odbicie zostaje MOŻLIWE: ktoś wraca z L4 dzień wcześniej albo wpada na dwie
  // godziny w środku urlopu. Kafelek informuje, nie blokuje — od pilnowania
  // zgodności jest kierownik, nie ekran na ścianie.
  absence: {
    label: "Nieobecność",
    plate: "bg-raised border-line-strong text-muted",
    caption: { punch: "Dotknij, jeśli mimo to jesteś w pracy", watch: "Nieobecny" },
  },
  // Karta, której nikt nie zamknął — domknięta o 3:00 przez zadanie nocne
  // (services/closeOpenCards.js) na osiem godzin od odbicia wejścia.
  //
  // Paleta NEUTRALNA, z tego samego powodu co przy nieobecności. Zieleń w tym
  // systemie znaczy „przepracowane i pełne", a tutaj liczba jest ZGADNIĘTA:
  // wiemy, o której ktoś przyszedł, i nie wiemy, o której wyszedł. Zielony
  // kafelek mówiłby, że dniówka się zgadza, a to jest dokładnie to zdanie,
  // którego nie wolno tu postawić.
  //
  // Dotknięcie niczego nie zmienia (changeStatus nie obsługuje finishWork) —
  // i tak ma zostać. Poprawia kierownik, na /time/zarzadzaj, z podpisem.
  autoClosed: {
    label: "Domknięto auto",
    plate: "bg-raised border-line-strong text-muted",
    caption: { punch: "Brak odbicia wyjścia · do korekty", watch: "Brak odbicia wyjścia" },
  },
};

const Card = ({ data, onSaved }) => {
  const { data: session } = useSession();
  const [airtableID, setAirtableID] = useState(data.airtableID);
  const [status, setStatus] = useState(data.status);
  const [startTime, setStartTime] = useState(data.startTime);
  const [endTime, setEndTime] = useState(data.endTime);
  const [totalWorkTime, setTotalWorkTime] = useState(data.totalWorkTime);
  const [displayTime, setDisplayTime] = useState("");
  const [overTime, setOverTime] = useState(false);
  const [intervalID, setIntervalID] = useState(null);

  // Pierwszy przebieg efektu poniżej NIE zapisuje do bazy.
  //
  // Stan początkowy karty pochodzi wprost z bazy, a zapisywana wartość
  // (DifferenceTime(startTime, endTime)) jest funkcją tych samych pól — czyli
  // zapis przy montowaniu odsyłał do bazy dokładnie to, co przed chwilą z niej
  // przyszło. Przy tablicy kiosku z kilkunastoma odbitymi kartami każde wejście
  // na stronę i każde przeładowanie o 3:30 wysyłało serię PUT-ów bez żadnego
  // skutku poza obciążeniem serwera.
  const skipInitialSave = useRef(true);

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
      const res = await fetch(`/api/time/${data.ID}`, {
        method: "POST",
        body: JSON.stringify(payload),
        headers: {
          "Content-Type": "application/json",
        },
      });

      // Nowe id bierzemy WPROST z odpowiedzi POST (services/saveTime.js zwraca
      // lastInsertRowid). Wcześniej szło po nie osobne GET /api/time/<userID>,
      // które wracało już po zamontowaniu kafelka — a między jednym a drugim
      // `airtableID` był pusty i kolejne dotknięcie kafelka zakładało DRUGI wpis
      // na ten sam dzień zamiast zamknąć pierwszy.
      const created = await res.json().catch(() => ({}));
      if (res.ok && created?.time?.id) setAirtableID(created.time.id);
    }

    // Tablica dociąga świeże karty od razu, zamiast czekać do końca cyklu
    // odpytywania — kiosk ma potwierdzić dotknięcie natychmiast.
    if (onSaved) onSaved();
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
    // Zapisujemy tylko zmiany dokonane TUTAJ, w przeglądarce — czyli od drugiego
    // przebiegu w górę. Licznik (checker) startuje normalnie, bo on nic nie zapisuje.
    const persist = (...args) => {
      if (skipInitialSave.current) return;
      saveToDB(...args);
    };

    switch (status) {
      case "wait": {
        setDisplayTime("");
        break;
      }
      case "workInProgress": {
        if (intervalID === null) checker(endTime);
        if (overTime) setStatus("overTime");
        const res = DifferenceTime(startTime, endTime);
        persist(startTime, endTime, res.time, status, res.overTime);
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
        persist(startTime, endTime, res.time, status, res.overtime);
        break;
      }
      default:
        setDisplayTime("");
    }

    skipInitialSave.current = false;
  }, [status, overTime]);

  const punched = status !== "wait";

  // Nieobecność bierze górę TYLKO dopóki karta nie została odbita. Kto przyszedł
  // mimo urlopu, ten jest w pracy i kafelek ma pokazywać jego czas — sam
  // znacznik urlopu zostaje wtedy w rogu, jako informacja.
  const absence = data.absence;

  // Flaga przychodzi WYŁĄCZNIE z serwera i nie ma jej w stanie komponentu:
  // kliknięcie kafelka nie potrafi jej zdjąć, a korekta kierownika zmienia
  // endTime, czyli sygnaturę w kluczu kafelka (pages/time/[id].js) — kafelek
  // przemontuje się wtedy ze świeżymi propsami.
  const autoClosed = Boolean(data.autoClosed) && status === "finishWork";

  const stateKey =
    absence && !punched
      ? "absence"
      : autoClosed
      ? "autoClosed"
      : status === "finishWork"
      ? overTime
        ? "finishFull"
        : "finishShort"
      : status;
  const state = STATES[stateKey] || STATES.wait;

  // Nagłówek nieobecnego mówi WPROST, co to za nieobecność: "Nieobecność" jest
  // prawdziwe, ale bezużyteczne — kierownik przy tablicy chce wiedzieć, czy to
  // urlop, czy zwolnienie.
  const label = stateKey === "absence" ? absenceKindShort(absence.kind) : state.label;

  // Do kiedy — żeby nie trzeba było sprawdzać w panelu, czy ktoś wraca jutro,
  // czy za dwa tygodnie.
  const caption =
    stateKey === "absence"
      ? `${state.caption[canPunch ? "punch" : "watch"]} · do ${formatDate(absence.dateTo)}`
      : state.caption[canPunch ? "punch" : "watch"];

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
          {label}
        </span>
        <span className="flex items-center gap-2">
          {/* Znacznik zostaje także po odbiciu karty: „w pracy, choć miał być na
              urlopie” to dokładnie ta sytuacja, o której kierownik ma wiedzieć. */}
          {absence && punched && (
            <span className="rounded-sm border border-current px-1.5 py-px text-[0.6rem] font-bold uppercase tracking-signage opacity-80">
              {absenceKindShort(absence.kind)}
            </span>
          )}
          {punched && (
            <span className="font-mono text-xs tabular-nums opacity-80">od {dayjs(startTime).format("HH:mm")}</span>
          )}
        </span>
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
        <p className="mt-1.5 text-xs opacity-80">{caption}</p>
      </div>
    </div>
  );
};

export default Card;
