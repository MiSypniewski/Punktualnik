import dayjs from "dayjs";
import "dayjs/locale/pl";
import getUsers from "./getUsers";
import getSectionTime from "./getSectionTime";
import getAbsencesForDay from "./getAbsencesForDay";
import { workDay } from "./workday";

dayjs.locale("pl");

// Tablica kart sekcji — komplet danych ekranu kiosku (/time/[sekcja]).
//
// Logika siedziała wcześniej wprost w getServerSideProps tamtej strony. Wyjechała
// tutaj, kiedy tablica zaczęła się sama odświeżać: te same karty składa teraz
// SSR (pierwszy render) i GET /api/time/board (kolejne cykle). Gdyby każda ścieżka
// budowała je po swojemu, pierwsza poprawka rozjechałaby jedną z nich po cichu —
// błąd byłby widoczny dopiero po 45 sekundach patrzenia na ekran.
//
// Funkcja NICZEGO NIE ZAPISUJE i tak ma zostać. Jest wołana cyklicznie z każdego
// kiosku w firmie, a zapis przy odczycie to dokładnie ta przyczyna, która
// 21.08.2026 położyła serwer (README, "Kiedy aplikacja muli"): better-sqlite3 jest
// synchroniczne, więc kolizja o blokadę zapisu zamraża wszystkich naraz.

/**
 * Kafelek osoby, która dziś jeszcze nie odbiła karty.
 *
 * Kształt musi się zgadzać z wierszem z tabeli Times (services/getSectionTime.js),
 * bo components/card.js czyta jedno i drugie tak samo. Jedyna różnica to `ID`
 * z prefiksem `empty_` — POST kafelka leci pod ten adres i po nim właśnie API
 * poznaje, że wpisu jeszcze nie ma.
 */
const emptyCard = (user, stamp) => ({
  ID: `empty_${user.ID}`,
  userID: user.ID,
  name: user.name,
  surname: user.surname,
  section: user.section,
  location: user.location,
  data: stamp,
  startTime: stamp,
  endTime: stamp,
  totalWorkTime: `00:00:00`,
  status: "wait",
  overTime: false,
});

/**
 * @param {string} section slug sekcji
 * @returns {Promise<{cards: object[], workdayLabel: string, generatedAt: string}>}
 */
export const getSectionBoard = async (section) => {
  // Godzina 3:00 w `data` to spadek po Airtable i granica doby roboczej zarazem
  // — zob. komentarz w services/workday.js. Times trzyma pełne ISO z offsetem,
  // podczas gdy Absences ma gołe 'YYYY-MM-DD'; stąd niżej dwa różne formaty daty
  // w jednej funkcji. Ujednolicenie ich znaczyłoby ruszenie dopasowania kart,
  // czyli najstarszej i najmniej pilnowanej części aplikacji.
  const stamp = dayjs().hour(3).minute(0).second(0).millisecond(0).format();

  const users = await getUsers(section);
  const cardData = await getSectionTime(section, stamp);

  // Odbite karty w kolejności listy pracowników, reszta jako puste kafelki.
  // Kolejność wynika z getUsers, a nie z tabeli Times: inaczej tablica na ścianie
  // przestawiałaby kafelki w ciągu dnia, w miarę jak kto odbija.
  const byUser = new Map(cardData.map((card) => [card.userID, card]));
  const cards = users.map((user) => byUser.get(user.ID) ?? emptyCard(user, stamp));

  // Nieobecność dokładamy do GOTOWYCH kart, zamiast wplatać ją wyżej: dotyczy
  // zarówno tych, którzy karty nie odbili, jak i tych, którzy odbili mimo urlopu
  // (ktoś wraca z L4 wcześniej albo wpada na dwie godziny).
  const absences = getAbsencesForDay(section, workDay());
  cards.forEach((card) => {
    const absence = absences[card.userID];
    if (absence) card.absence = absence;
  });

  return {
    cards,
    // Doba robocza zaczyna się o 3:00, więc "dzisiaj" na tablicy to nie zawsze
    // dzisiaj w kalendarzu — stąd etykieta prosto z serwera.
    workdayLabel: dayjs(stamp).format("dddd, D MMMM YYYY"),
    generatedAt: dayjs().format(),
  };
};

export default getSectionBoard;
