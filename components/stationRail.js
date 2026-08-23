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
const navItems = (user) => {
  const role = user.role;
  const items = [];

  // Powrót na tablicę kafelków własnej sekcji. Wcześniej prowadziła tu
  // wyłącznie tykająca data — nikt się tego nie domyślał.
  items.push({ href: `/time/${user.section}`, match: "/time/[id]", label: "Moja sekcja" });

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
    items.push({ href: "/zadania/projekty", match: "/zadania/projekty", label: "Projekty" });
  if (canApproveOvertime(role))
    items.push({ href: "/nadgodziny/zarzadzaj", match: "/nadgodziny/zarzadzaj", label: "Wnioski" });
  if (canApproveLeave(role))
    items.push({ href: "/urlopy/zarzadzaj", match: "/urlopy/zarzadzaj", label: "Nieobecności" });
  if (canExportTimes(role))
    items.push({ href: "/utils/eksport", match: "/utils/eksport", label: "Eksport" });

  // Narzędzie doraźne spoza ewidencji czasu, stąd na końcu. Bez kiosku:
  // to konto stoi przy ekranie dotykowym w miejscu publicznym i ma prowadzić
  // do kafelków, a nie do narzędzi.
  if (role !== "editor")
    items.push({ href: "/utils/generujfiltr", match: "/utils/generujfiltr", label: "Filtr GAM" });

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

  return (
    <header className="sticky top-0 z-30 bg-surface border-b border-line shadow-rail">
      <div className="mx-auto max-w-wide px-4">
        <div className="flex items-center gap-3 sm:gap-5 h-14">
          <Logo />
          <StationClock />

          {/* Próg 1280 px, nie 1024: przy siedmiu pozycjach kierownika, zegarze,
              znaku, koncie i przełączniku motywu pasek nie mieścił się na
              tablecie i wypychał stronę w poziomie. Poniżej — menu pod
              przyciskiem. */}
          <nav className="hidden xl:flex items-center gap-4 2xl:gap-5 flex-grow min-w-0" aria-label="Sekcje aplikacji">
            {items.map((item) => (
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
              className="xl:hidden flex items-center justify-center w-9 h-9 rounded border border-line text-muted hover:text-body hover:bg-raised"
            >
              <MenuIcon open={open} />
            </button>
          </div>
        </div>
      </div>

      {open && (
        <nav
          id="menu-paska"
          className="xl:hidden border-t border-line-subtle bg-surface"
          aria-label="Sekcje aplikacji"
        >
          <div className="mx-auto max-w-wide px-4 py-2">
            {items.map((item) => (
              <RailLink
                key={item.href}
                item={item}
                block
                active={router.pathname === item.match}
                onClick={() => setOpen(false)}
              />
            ))}
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
