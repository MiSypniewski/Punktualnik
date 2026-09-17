import { TabNav } from "./ui";

// Pasek podzakładek modułu Nieobecności — jedna definicja dla obu stron.
//
// Lista jest TUTAJ, a nie po jednej kopii w każdej ze stron, bo dodanie
// trzeciej podstrony albo zmiana etykiety musi zadziałać na obu naraz.
// Kopia w każdym pliku znaczyłaby pasek, który na jednym ekranie ma trzy
// pozycje, a na drugim dwie — i nikt by nie zauważył, dopóki ktoś nie zgubiłby
// się w nawigacji.
//
// Kolejność odpowiada temu, jak moduł się używa: najpierw spojrzenie na dzień,
// potem praca z wnioskami.
const ITEMS = [
  { href: "/urlopy/stan", label: "Aktualny stan" },
  { href: "/urlopy/zarzadzaj", label: "Wnioski i historia" },
];

const AbsenceTabs = ({ className }) => (
  <TabNav items={ITEMS} label="Podstrony modułu Nieobecności" className={className} />
);

export default AbsenceTabs;
