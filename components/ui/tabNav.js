import Link from "next/link";
import { useRouter } from "next/router";
import classNames from "classnames";

// Podzakładki wewnątrz modułu — pierwszy taki element w aplikacji.
//
// Do tej pory każdy ekran był osobną pozycją w pasku stacyjnym i to działało,
// dopóki moduł miał jeden ekran dla kierownika. Nieobecności mają dwa: dzień
// zespołu (/urlopy/stan) i obieg wniosków z historią (/urlopy/zarzadzaj).
// Bez tego paska kierownik wracałby między nimi przez pasek stacyjny, w którym
// obie pozycje stoją daleko od siebie i nic nie mówi, że to jeden moduł.
//
// <Link>, a nie <button> z router.push: to nawigacja między STRONAMI, więc
// środkowy przycisk myszy ma otwierać nową kartę, a czytnik ekranu ma czytać
// „odnośnik”. Wygląd jest ten sam co w komponencie FormatChoice, ale ta
// zbieżność jest powierzchowna — tam wybiera się wartość, nie adres.

const tabClass = (active) =>
  classNames(
    "px-3 py-1.5 text-sm font-medium transition-colors",
    active ? "bg-accent text-accent-ink" : "bg-surface text-muted hover:bg-raised hover:text-body"
  );

/**
 * @param {{href: string, label: string}[]} items
 * @param {string} [label] etykieta nawigacji dla czytników ekranu
 */
const TabNav = ({ items, label = "Podstrony modułu", className }) => {
  const router = useRouter();

  return (
    <nav
      aria-label={label}
      className={classNames(
        "inline-flex rounded border border-line-strong overflow-hidden divide-x divide-line-strong",
        className
      )}
    >
      {items.map((item) => {
        // Porównanie DOKŁADNE po pathname, jak w components/stationRail.js:
        // dopasowanie po prefiksie zapaliłoby "stan" także na "/urlopy".
        const active = router.pathname === item.href;

        return (
          <Link key={item.href} href={item.href}>
            <a aria-current={active ? "page" : undefined} className={tabClass(active)}>
              {item.label}
            </a>
          </Link>
        );
      })}
    </nav>
  );
};

export default TabNav;
