import { useEffect } from "react";
import { useRouter } from "next/router";
import classNames from "classnames";
import dayjs from "dayjs";
import "dayjs/locale/pl";
import { ChevronLeftIcon, ChevronRightIcon, IconButton, Input } from "./ui";

dayjs.locale("pl");

// Wybór dnia dla ekranu "Aktualny stan": strzałki, trzy skróty i pole daty.
//
// Dzień żyje w ADRESIE (?dzien=RRRR-MM-DD), nie w stanie komponentu — ten sam
// wzorzec, co filtry w panelu wniosków i w raporcie zadań. Dzięki temu widok da
// się zalinkować ("zobacz, co było w poniedziałek"), odświeżyć i cofnąć
// przyciskiem przeglądarki, a getServerSideProps ma z czego policzyć dane.
//
// Dziś zdejmuje parametr z adresu, zamiast wpisywać w niego dzisiejszą datę.
// Inaczej link wysłany komuś jutro pokazywałby wczoraj — a "Aktualny stan"
// ma domyślnie znaczyć "teraz".

const OPTIONS = [
  { key: "yesterday", label: "Wczoraj", offset: -1 },
  { key: "today", label: "Dziś", offset: 0 },
  { key: "tomorrow", label: "Jutro", offset: 1 },
];

const optionClass = (active) =>
  classNames(
    "px-3 py-1.5 text-sm font-medium transition-colors",
    active ? "bg-accent text-accent-ink" : "bg-surface text-muted hover:bg-raised hover:text-body"
  );

/**
 * Data słownie — piąte miejsce w aplikacji, gdzie data NIE jest daną
 * (zob. README, „Cztery miejsca z datą słowną”). Nikt tego napisu nie
 * przepisuje ani nie porównuje z arkuszem; ma odpowiedzieć na pytanie „który to
 * dzień”, rzucone kątem oka. Obok stoi to samo w postaci RRRR-MM-DD, w polu
 * daty — do czytania jako dana.
 */
const wordy = (day) => dayjs(day).format("dddd, D MMMM YYYY");

/**
 * @param {string} day wybrany dzień 'YYYY-MM-DD'
 * @param {string} today doba robocza z serwera — NIE dayjs() w przeglądarce:
 *   doba zaczyna się o 3:00, a o 1:00 w nocy "dziś" znaczy dzień poprzedni
 *   i zegar przeglądarki tego nie wie.
 */
const DayNav = ({ day, today }) => {
  const router = useRouter();

  const go = (nextDay) => {
    const query = { ...router.query };
    // Dzisiejszy dzień zostawia adres czysty — patrz komentarz na górze pliku.
    if (nextDay === today) delete query.dzien;
    else query.dzien = nextDay;

    router.push({ pathname: router.pathname, query }, undefined, { scroll: false });
  };

  const shift = (days) => go(dayjs(day).add(days, "day").format("YYYY-MM-DD"));

  // Strzałki klawiatury przesuwają dzień — kierownik przeglądający tydzień
  // wstecz nie musi celować w przycisk. Pomijamy je, gdy fokus stoi w polu
  // formularza: tam strzałki przesuwają kursor i podmieniają wartość daty.
  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;

      if (e.key === "ArrowLeft") shift(-1);
      if (e.key === "ArrowRight") shift(1);
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day, today, router.asPath]);

  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
      <div className="flex items-center gap-1">
        <IconButton label="Dzień wcześniej" onClick={() => shift(-1)}>
          <ChevronLeftIcon />
        </IconButton>

        <div
          role="radiogroup"
          aria-label="Wybór dnia"
          className="inline-flex rounded border border-line-strong overflow-hidden divide-x divide-line-strong"
        >
          {OPTIONS.map((o) => {
            const target = dayjs(today).add(o.offset, "day").format("YYYY-MM-DD");
            return (
              <button
                key={o.key}
                type="button"
                role="radio"
                aria-checked={day === target}
                onClick={() => go(target)}
                className={optionClass(day === target)}
              >
                {o.label}
              </button>
            );
          })}
        </div>

        <IconButton label="Dzień później" onClick={() => shift(1)}>
          <ChevronRightIcon />
        </IconButton>
      </div>

      {/* Pole daty jest wąskie przez `!w-44`: @tailwindcss/forms maluje pola
          selektorem atrybutowym i wymusza w-full, z którym sam `w-44` przegrywa
          kolejnością reguł w arkuszu, a nie kolejnością w atrybucie class. */}
      <Input
        type="date"
        value={day}
        aria-label="Wybierz datę"
        onChange={(e) => e.target.value && go(e.target.value)}
        className="!w-44"
      />

      <p className="text-sm text-muted first-letter:uppercase">{wordy(day)}</p>
    </div>
  );
};

export default DayNav;
