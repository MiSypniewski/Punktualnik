import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { signOut } from "next-auth/react";
import useSWR from "swr";
import classNames from "classnames";
import Logo from "./logo";
import StationClock from "./stationClock";
import ThemeToggle from "./themeToggle";
import RunningStrip from "./runningStrip";
import EmptyTimerNudge from "./emptyTimerNudge";
import {
  canEditTimes,
  canApproveOvertime,
  canTrackTasks,
  canManageProjects,
  canSeeTeamTasks,
  canApproveLeave,
  canSeeMonthlyReports,
} from "../services/roles";
import { fetchLive, PENDING_KEY, PENDING_POLL_MS } from "../utils/live";

// Pasek stacyjny — jedyny element nawigacyjny aplikacji.
//
// `match` to ścieżka Z ROUTERA (z nawiasami klamrowymi), nie adres: porównanie
// po prefiksie zapalałoby „Zadania” także na „Raport zadań” i „Projekty”, bo
// wszystkie trzy zaczynają się od /zadania. Może być tablicą — „Wnioski” to
// jedna pozycja na dwie strony (patrz niżej).
//
// `group` dzieli pozycje na „moje” (własny czas, własne wnioski) i „zespół”
// (cudze dane i decyzje). Do października 2026 stały w jednym rzędzie na
// przemian i kierownik miał obok siebie „Urlopy” (swoje) i „Nieobecności”
// (wnioski urlopowe pracowników) — ten sam moduł pod dwiema nazwami, bez
// żadnej podpowiedzi, które jest czyje. Podpisy grup renderują się tylko
// wtedy, gdy istnieją OBIE: pracownik i kiosk nie mają pozycji zespołowych,
// więc ich pasek wygląda jak dotąd.
//
// `secondary: true` znaczy „nie na pasku, tylko pod przyciskiem menu”. Dotyczy
// stron, na które wchodzi się rzadko albo raz na jakiś czas: tablica własnej
// sekcji (kierownik zagląda na nią sporadycznie), słownik projektów, korekta
// kart i filtr GAM. Codzienna praca — raportowanie i akceptowanie — zostaje na
// wierzchu. Podział wchodzi w życie dopiero przy zatłoczonym pasku (niżej),
// więc pracownik i kiosk mają dalej komplet w jednym rzędzie.
const GROUPS = [
  { key: "moje", label: "Moje" },
  { key: "zespol", label: "Zespół" },
];

const navItems = (user, pending) => {
  const role = user.role;
  const items = [];

  // --- Moje ---------------------------------------------------------------

  // Powrót na tablicę kafelków własnej sekcji. Wcześniej prowadziła tu
  // wyłącznie tykająca data — nikt się tego nie domyślał.
  items.push({
    href: `/time/${user.section}`,
    match: "/time/[id]",
    label: "Moja sekcja",
    group: "moje",
    secondary: true,
  });

  // Kiosk (editor) nie raportuje zadań — konto jest współdzielone, więc wpis
  // nie miałby właściciela.
  if (canTrackTasks(role)) items.push({ href: "/zadania", match: "/zadania", label: "Zadania", group: "moje" });

  items.push({ href: "/nadgodziny", match: "/nadgodziny", label: "Nadgodziny", group: "moje" });

  // Kiosk dostaje tę pozycję razem z resztą: konto jest wprawdzie współdzielone,
  // ale strona pokazuje wyłącznie własne wnioski, a tych kiosk po prostu nie ma
  // — zobaczy pustą historię, nie cudze dane.
  items.push({ href: "/urlopy", match: "/urlopy", label: "Urlopy", group: "moje" });

  // --- Zespół -------------------------------------------------------------

  // Dzień zespołu na jednym ekranie — spojrzenie rzucane codziennie rano,
  // stąd pierwsze miejsce w grupie. Etykieta „Dziś”, bo odnośnik otwiera
  // zawsze dzisiejszy dzień; inną datę wybiera się już na samym ekranie.
  if (canApproveLeave(role))
    items.push({ href: "/urlopy/stan", match: "/urlopy/stan", label: "Dziś", group: "zespol" });

  // JEDNA pozycja na oba panele wniosków. Wcześniej były dwie: „Wnioski”
  // (wyłącznie nadgodziny, czego etykieta nie mówiła) i „Nieobecności” (wnioski
  // urlopowe). Między urlopami a nadgodzinami przechodzi się zakładkami na
  // samej stronie (components/requestTabs.js).
  //
  // Odnośnik prowadzi tam, gdzie coś czeka: przy samych wnioskach
  // nadgodzinowych zakładka urlopów byłaby pustym ekranem z licznikiem „(2)”
  // w pasku.
  if (canApproveLeave(role) || canApproveOvertime(role)) {
    const absences = pending?.absences ?? 0;
    const overtime = pending?.overtime ?? 0;
    items.push({
      href: absences === 0 && overtime > 0 ? "/nadgodziny/zarzadzaj" : "/urlopy/zarzadzaj",
      match: ["/urlopy/zarzadzaj", "/nadgodziny/zarzadzaj"],
      label: "Wnioski",
      group: "zespol",
      count: absences + overtime,
    });
  }

  if (canSeeTeamTasks(role))
    items.push({ href: "/zadania/zarzadzaj", match: "/zadania/zarzadzaj", label: "Raport zadań", group: "zespol" });
  if (canManageProjects(role))
    items.push({
      href: "/zadania/projekty",
      match: "/zadania/projekty",
      label: "Projekty",
      group: "zespol",
      secondary: true,
    });
  // Korekta kart czasu — narzędzie doraźne, więc `secondary`. Kierownik zagląda
  // tu po zapomnianym odbiciu, nie codziennie. Trasa jest STATYCZNA, więc Next
  // dopasuje ją przed dynamiczną /time/[id] ("Moja sekcja") i obie pozycje
  // podświetlają się niezależnie.
  //
  // Tu siedzi też eksport czasów pracy. Osobna pozycja "Eksport"
  // (/utils/eksport) była drugim formularzem do tego samego zapytania:
  // te same trzy filtry, te same dane, inny ekran.
  if (canEditTimes(role))
    items.push({
      href: "/time/zarzadzaj",
      match: "/time/zarzadzaj",
      label: "Karty czasu",
      group: "zespol",
      secondary: true,
    });

  // Miesięczne podsumowania — otwierane raz w miesiącu, więc na samym końcu
  // grupy i `secondary`, jak pozostałe narzędzia doraźne.
  if (canSeeMonthlyReports(role))
    items.push({
      href: "/zadania/podsumowanie",
      match: "/zadania/podsumowanie",
      label: "Podsumowania",
      group: "zespol",
      secondary: true,
    });

  // Narzędzie doraźne spoza ewidencji czasu. Bez kiosku: to konto stoi przy
  // ekranie dotykowym w miejscu publicznym i ma prowadzić do kafelków, a nie
  // do narzędzi.
  if (role !== "editor")
    items.push({
      href: "/utils/generujfiltr",
      match: "/utils/generujfiltr",
      label: "Filtr GAM",
      group: "moje",
      secondary: true,
    });

  return items;
};

const isActive = (item, pathname) => [].concat(item.match).includes(pathname);

// Licznik wniosków czekających na decyzję. Kolor `accent`, NIE bursztyn:
// bursztyn znaczy w tym systemie wyłącznie „teraz” (biegnący timer), a wniosek
// czeka, nie biegnie.
const Count = ({ value }) =>
  value > 0 ? (
    <span className="ml-1.5 inline-block rounded-sm bg-accent text-accent-ink px-1.5 font-mono text-xs leading-5 tabular-nums align-baseline">
      <span className="sr-only">czeka: </span>
      {value}
    </span>
  ) : null;

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
      <Count value={item.count} />
    </a>
  </Link>
);

const GroupLabel = ({ children, className }) => (
  <span className={classNames("text-[0.625rem] font-semibold uppercase tracking-signage text-faint", className)}>
    {children}
  </span>
);

// Pozycje podzielone na grupy, w kolejności z GROUPS. Bez podziału (pracownik,
// kiosk) wraca jedna grupa bez podpisu, czyli lista taka jak dotąd.
const grouped = (items, withGroups) =>
  withGroups
    ? GROUPS.map((g) => ({ ...g, items: items.filter((i) => i.group === g.key) })).filter((g) => g.items.length)
    : [{ key: "all", label: null, items }];

// Lista w rozwijanym menu: te same grupy co w pasku, z podpisem nad każdą.
const MenuList = ({ items, withGroups, pathname, onPick }) =>
  grouped(items, withGroups).map((group, i) => (
    <div key={group.key} className={i > 0 ? "mt-2 pt-2 border-t border-line-subtle" : undefined}>
      {group.label && <GroupLabel className="block px-2 pt-1 pb-0.5">{group.label}</GroupLabel>}
      {group.items.map((item) => (
        <RailLink key={item.label} item={item} block active={isActive(item, pathname)} onClick={onPick} />
      ))}
    </div>
  ));

// Od tylu pozycji pasek przestaje pokazywać komplet i dzieli je na dwie grupy:
// pierwszy plan zostaje w rzędzie, `secondary` chowa się pod przyciskiem.
//
// Powód jest mierzalny: kontener paska ma stałą maksymalną szerokość
// (max-w-wide, 85 rem), więc na monitorze 2560 px nawigacja dostaje dokładnie
// tyle samo miejsca co na 1360 px — podnoszenie progu breakpointa nic nie daje.
// Komplet pozycji kierownika razem ze znakiem, zegarem, kontem i przełącznikiem
// motywu po prostu się w tym nie mieści; przy dziewiątej "Filtr GAM" wchodził na
// imię użytkownika. Sześć pozycji (trzy „moje”, trzy „zespołu”) mieści się
// z zapasem.
//
// Kierownik ma ich dziesięć, pracownik pięć, kiosk trzy — u dwóch ostatnich
// podział się nie włącza i pasek wygląda jak dotąd.
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

  // Liczba wniosków do rozpatrzenia. Klucz `null` wyłącza zapytanie u każdego,
  // kto wniosków nie rozpatruje — pracownik i kiosk nie pytają o nic.
  const { data: pending } = useSWR(canApproveLeave(user.role) ? PENDING_KEY : null, fetchLive, {
    refreshInterval: PENDING_POLL_MS,
  });

  const items = navItems(user, pending);
  // Podpisy grup mają sens tylko wtedy, gdy jest co rozróżniać.
  const withGroups = items.some((i) => i.group === "zespol");

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
            {grouped(railItems, withGroups).map((group, i) => (
              // Podpis grupy stoi NAD pozycjami, w wolnym pasie u góry paska:
              // obok nich zabierałby szerokość, której kierownikowi i tak
              // brakuje (patrz CROWDED_FROM).
              <div
                key={group.key}
                className={classNames(
                  "relative flex items-center gap-4 2xl:gap-5",
                  i > 0 && "pl-4 2xl:pl-5 border-l border-line"
                )}
              >
                {group.label && (
                  <GroupLabel className={classNames("absolute top-1 leading-none", i > 0 ? "left-5 2xl:left-6" : "left-1")}>
                    {group.label}
                  </GroupLabel>
                )}
                {group.items.map((item) => (
                  <RailLink key={item.label} item={item} active={isActive(item, router.pathname)} />
                ))}
              </div>
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
              <MenuList
                items={items}
                withGroups={withGroups}
                pathname={router.pathname}
                onPick={() => setOpen(false)}
              />
            </div>
            {split && (
              <div className="hidden xl:block">
                <MenuList
                  items={menuItems}
                  withGroups={withGroups}
                  pathname={router.pathname}
                  onPick={() => setOpen(false)}
                />
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
      {/* Pod nim przypomnienie o timerze bez opisu i projektu (15/20 min). */}
      {canTrackTasks(user.role) && <EmptyTimerNudge />}
    </header>
  );
}
