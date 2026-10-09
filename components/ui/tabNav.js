import Link from "next/link";
import { useRouter } from "next/router";
import classNames from "classnames";

// Podzakładki wewnątrz jednej pozycji paska stacyjnego.
//
// Używa ich pozycja „Wnioski” (components/requestTabs.js): panel wniosków
// urlopowych i panel nadgodzin to dwie strony, ale jedna praca kierownika,
// więc w pasku stoją pod jedną etykietą, a przechodzi się między nimi tutaj.
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
 * @param {{href: string, label: string, count?: number}[]} items
 *   `count` — liczba przy etykiecie (np. wnioski do rozpatrzenia); zero i brak
 *   wartości nie pokazują niczego
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
              {item.count > 0 && <span className="ml-1.5 font-mono tabular-nums">({item.count})</span>}
            </a>
          </Link>
        );
      })}
    </nav>
  );
};

export default TabNav;
