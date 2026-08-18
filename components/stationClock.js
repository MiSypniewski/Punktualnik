import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import dayjs from "dayjs";
import "dayjs/locale/pl";
dayjs.locale("pl");

// Zegar stacyjny w pasku: data słownie, godzina w monospace z sekundami.
//
// Renderujemy pustkę do czasu zamontowania — serwer i przeglądarka nigdy nie
// trafią w tę samą sekundę, więc render początkowy MUSI być pusty, inaczej
// React zgłasza niezgodność hydratacji. Miejsce jest zarezerwowane szerokością,
// żeby pasek nie skakał.
//
// Przeładowanie o 03:30 zostaje z poprzedniej wersji i ma sens: doba robocza
// zaczyna się o 3:00 (services/workday.js), a kiosk potrafi stać otwarty tydzień
// i pokazywałby wczorajszą tablicę. Poprzednia wersja trzymała ten interwał
// w komponencie nawigacji BEZ sprzątania — wisiał po odmontowaniu.
const StationClock = () => {
  const [now, setNow] = useState(null);
  const router = useRouter();

  useEffect(() => {
    setNow(dayjs());

    const handle = setInterval(() => {
      const tick = dayjs();
      if (tick.format("HH:mm:ss") === "03:30:00") router.reload();
      setNow(tick);
    }, 1000);

    return () => clearInterval(handle);
  }, [router]);

  if (now === null) {
    return <span className="w-[9.5rem] shrink-0" aria-hidden="true" />;
  }

  return (
    <span className="flex items-baseline gap-2 shrink-0 leading-none">
      <span className="hidden md:inline text-xs text-muted first-letter:uppercase whitespace-nowrap">
        {now.format("dddd, D MMMM")}
      </span>
      <time
        className="font-mono text-sm font-medium tabular-nums"
        dateTime={now.format()}
        aria-label={`Godzina ${now.format("HH:mm")}`}
      >
        {now.format("HH:mm:ss")}
      </time>
    </span>
  );
};

export default StationClock;
