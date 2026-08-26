import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { signOut } from "next-auth/react";
import classNames from "classnames";
import Logo from "./logo";
import StationClock from "./stationClock";
import ThemeToggle from "./themeToggle";
import RunningStrip from "./runningStrip";
import {
  canEditTimes,
  canExportTimes,
  canApproveOvertime,
  canTrackTasks,
  canManageProjects,
  canSeeTeamTasks,
  canApproveLeave,
} from "../services/roles";

// Pasek stacyjny — jedyny element nawigacyjny aplikacji.
//
// `match` to ścieżka Z ROUTERA (z nawiasami klamrowymi), nie adres: porównanie
// po prefiksie zapalałoby „Zadania” także na „Raport zadań” i „Projekty”, bo
// wszystkie trzy zaczynają się od /zadania.
//
// `secondary: true` znaczy „nie na pasku, tylko pod przyciskiem menu”. Dotyczy
// stron, na które wchodzi się rzadko albo raz na jakiś czas: tablica własnej
// sekcji (kierownik zagląda na nią sporadycznie), słownik projektów, eksport
// i filtr GAM. Codzienna praca — raportowanie i akceptowanie — zostaje na
// wierzchu. Podział wchodzi w życie dopiero przy zatłoczonym pasku (niżej),
// więc pracownik i kiosk mają dalej komplet w jednym rzędzie.
const navItems = (user) => {
  const role = user.role;
  const items = [];

  // Powrót na tablicę kafelków własnej sekcji. Wcześniej prowadziła tu
  // wyłącznie tykająca data — nikt się tego nie domyślał.
  items.push({ href: `/time/${user.section}`, match: "/time/[id]", label: "Moja sekcja", secondary: true });

  // Kiosk (editor) nie raportuje zadań — konto jest współdzielone, więc wpis
  // nie miałby właściciela.
  if (canTrackTasks(role)) items.push({ href: "/zadania", match: "/zadania", label: "Zadania" });

  items.push({ href: "/nadgodziny", match: "/nadgodziny", label: "Nadgodziny" });

  // Kiosk dostaje tę pozycję razem z resztą: konto jest wprawdzie współdzielone,
  // ale strona pokazuje wyłącznie własne wnioski, a tych kiosk po prostu nie ma
  // — zobaczy pustą historię, nie cudze dane.
  items.push({ href: "/urlopy", match: "/urlopy", label: "Urlopy" });

  if (canSeeTeamTasks(role))
    items.push({ href: "/zadania/zarzadzaj", match: "/zadania/zarzadzaj", label: "Raport zadań" });
  if (canManageProjects(role))
    items.push({ href: "/zadania/projekty", match: "/zadania/projekty", label: "Projekty", secondary: true });
  if (canApproveOvertime(role))
    items.push({ href: "/nadgodziny/zarzadzaj", match: "/nadgodziny/zarzadzaj", label: "Wnioski" });
  if (canApproveLeave(role))
    items.push({ href: "/urlopy/zarzadzaj", match: "/urlopy/zarzadzaj", label: "Nieobecności" });
  // Korekta kart czasu — narzędzie doraźne, więc `secondary`. Kierownik zagląda
  // tu po zapomnianym odbiciu, nie codziennie. Trasa jest STATYCZNA, więc Next
  // dopasuje ją przed dynamiczną /time/[id] ("Moja sekcja") i obie pozycje
  // podświetlają się niezależnie.
  if (canEditTimes(role))
    items.push({ href: "/time/zarzadzaj", match: "/time/zarzadzaj", label: "Karty czasu", secondary: true });
  if (canExportTimes(role))
    items.push({ href: "/utils/eksport", match: "/utils/eksport", label: "Eksport", secondary: true });

  // Narzędzie doraźne spoza ewidencji czasu, stąd na końcu. Bez kiosku:
  // to konto stoi przy ekranie dotykowym w miejscu publicznym i ma prowadzić
  // do kafelków, a nie do narzędzi.
  if (role !== "editor")
    items.push({ href: "/utils/generujfiltr", match: "/utils/generujfiltr", label: "Filtr GAM", secondary: true });

  return items;
};

const RailLink = ({ item, active, onClick, block }) => (
  <Link href={item.href}>
    <a
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={classNames(
        "whitespace-nowrap font-medium rounded-sm",
        block
          ? "block px-2 py-2.5 border-l-2 text-base"
          : "inline-block px-1 py-4 border-b-2 text-sm",
        active
          ? "border-accent-strong text-accent-strong"
          : "border-transparent text-muted hover:text-body"
      )}
    >
      {item.label}
    </a>
  </Link>
);

// Od tylu pozycji pasek przestaje pokazywać komplet i dzieli je na dwie grupy:
// pierwszy plan zostaje w rzędzie, `secondary` chowa się pod przyciskiem.
//
// Powód jest mierzalny: kontener paska ma stałą maksymalną szerokość
// (max-w-wide, 85 rem), więc na monitorze 2560 px nawigacja dostaje dokładnie
// tyle samo miejsca co na 1360 px — podnoszenie progu breakpointa nic nie daje.
// Dziesięć pozycji kierownika razem ze znakiem, zegarem, kontem i przełącznikiem
// motywu po prostu się w tym nie mieści; przy dziewiątej "Filtr GAM" wchodził na
// imię użytkownika. Sześć pozycji mieści się z zapasem.
//
// Pracownik ma ich pięć, kiosk trzy — u nich podział się nie włącza i pasek
// wygląda jak dotąd.
const CROWDED_FROM = 8;

const MenuIcon = ({ open }) => (
  <svg viewBox="0 0 20 20" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
    {open ? (
      <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
    ) : (
      <path d="M3 6h14M3 10h14M3 14h14" strokeLinecap="round" />
    )}
  </svg>
);

const SignOutButton = ({ className }) => (
  <button
    type="button"
    onClick={() => signOut({ callbackUrl: "/users/signin" })}
    className={classNames("rounded-sm text-muted hover:text-body", className)}
  >
    Wyloguj
  </button>
);

export default function StationRail({ user }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const items = navItems(user);

  // Menu na telefonie zamyka się przy zmianie trasy — inaczej zostaje otwarte
  // nad stroną, na którą użytkownik właśnie wszedł.
  useEffect(() => {
    const close = () => setOpen(false);
    router.events.on("routeChangeComplete", close);
    return () => router.events.off("routeChangeComplete", close);
  }, [router.events]);

  // Kiosk to konto WSPÓŁDZIELONE przy ekranie dotykowym: świadomie bez linku do
  // profilu i bez wylogowania, żeby pracownik klikający kafelki nie wyklikał
  // się ze stanowiska.
  const isKiosk = user.role === "editor";

  // Podział wchodzi dopiero wtedy, gdy pozycji jest za dużo na jeden rząd.
  const split = items.length >= CROWDED_FROM;
  const railItems = split ? items.filter((i) => !i.secondary) : items;
  const menuItems = split ? items.filter((i) => i.secondary) : items;

  return (
    <header className="sticky top-0 z-30 bg-surface border-b border-line shadow-rail">
      <div className="mx-auto max-w-wide px-4">
        <div className="flex items-center gap-3 sm:gap-5 h-14">
          <Logo />
          <StationClock />

          {/* Próg 1280 px: poniżej niego pasek nie pokazuje żadnej pozycji,
              bo znak, zegar, konto i przełącznik motywu zajmują cały rząd —
              wszystko idzie wtedy pod przycisk. Powyżej stoją tu pozycje
              pierwszego planu (przy podziale) albo komplet. */}
          <nav
            className="hidden xl:flex items-center gap-4 2xl:gap-5 flex-grow min-w-0"
            aria-label="Sekcje aplikacji"
          >
            {railItems.map((item) => (
              <RailLink key={item.href} item={item} active={router.pathname === item.match} />
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2 sm:gap-3 shrink-0">
            {isKiosk ? (
              <p className="hidden sm:block capitalize text-sm text-muted">{user.name}</p>
            ) : (
              <>
                <Link href={`/users/${user.userID}`}>
                  <a className="hidden sm:block capitalize text-sm font-medium rounded-sm hover:text-accent-strong">
                    {user.name}
                  </a>
                </Link>
                <SignOutButton className="hidden xl:block text-sm" />
              </>
            )}
            {/* Poniżej 640 px przełącznik przenosi się do menu: znak, zegar,
                trzy przyciski motywu i hamburger nie mieszczą się w jednym
                rzędzie na telefonie. Kiosk stoi na tablecie, więc ma go dalej
                pod ręką w pasku. */}
            <span className="hidden sm:block">
              <ThemeToggle />
            </span>
            <button
              type="button"
              onClick={() => setOpen((prev) => !prev)}
              aria-expanded={open}
              aria-controls="menu-paska"
              aria-label={open ? "Zamknij menu" : "Otwórz menu"}
              className={classNames(
                "flex items-center justify-center w-9 h-9 rounded border border-line text-muted hover:text-body hover:bg-raised",
                // Przy podziale przycisk zostaje na KAŻDEJ szerokości — to
                // jedyne dojście do pozycji, których nie ma w pasku.
                !split && "xl:hidden"
              )}
            >
              <MenuIcon open={open} />
            </button>
          </div>
        </div>
      </div>

      {open && (
        <nav
          id="menu-paska"
          className={classNames("border-t border-line-subtle bg-surface", !split && "xl:hidden")}
          aria-label="Sekcje aplikacji"
        >
          <div className="mx-auto max-w-wide px-4 py-2">
            {/* Dwie listy, przełączane szerokością, bo CSS nie zmieni zawartości
                jednej: poniżej progu pasek nie pokazuje NICZEGO, więc menu musi
                mieć komplet; od progu pasek trzyma pierwszy plan, a tutaj
                zostaje wyłącznie reszta. Gdy podziału nie ma, obie listy są
                tym samym i renderuje się tylko pierwsza. */}
            <div className={split ? "xl:hidden" : undefined}>
              {items.map((item) => (
                <RailLink
                  key={item.href}
                  item={item}
                  block
                  active={router.pathname === item.match}
                  onClick={() => setOpen(false)}
                />
              ))}
            </div>
            {split && (
              <div className="hidden xl:block">
                {menuItems.map((item) => (
                  <RailLink
                    key={item.href}
                    item={item}
                    block
                    active={router.pathname === item.match}
                    onClick={() => setOpen(false)}
                  />
                ))}
              </div>
            )}
            {!isKiosk && (
              <div className="mt-2 pt-2 border-t border-line-subtle flex items-center justify-between">
                <Link href={`/users/${user.userID}`}>
                  <a className="capitalize px-2 py-2 text-sm font-medium rounded-sm">{user.name}</a>
                </Link>
                <SignOutButton className="px-2 py-2 text-sm" />
              </div>
            )}

            <div className="sm:hidden mt-2 pt-2 border-t border-line-subtle flex items-center justify-between">
              <span className="px-2 text-xs font-semibold uppercase tracking-signage text-muted">Motyw</span>
              <ThemeToggle />
            </div>
          </div>
        </nav>
      )}

      {/* Bursztynowa linia z biegnącym zadaniem. Sama znika, gdy timer nie leci;
          kiosk nie raportuje zadań, więc nie ma czego odpytywać. */}
      {canTrackTasks(user.role) && <RunningStrip />}
    </header>
  );
}
