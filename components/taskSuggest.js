import { forwardRef, useMemo, useRef, useState } from "react";
import classNames from "classnames";
import { Input } from "./ui/field";
import { ProjectMark } from "./projectColors";

// Pole opisu zadania z własną listą podpowiedzi — to, co ludzie znają z Clockify:
// po dwóch znakach rozwija się lista wcześniejszych zadań, każde z nazwą projektu
// obok, a wybór wypełnia opis I USTAWIA PROJEKT.
//
// Dlaczego nie natywny <datalist>, którego reszta strony używa dalej: on nie umie
// pokazać drugiej etykiety, więc nazwy projektu w liście nie widać wcale, a wybór
// pozycji projektu nie ustawia. W dwóch pozostałych polach opisu na /zadania
// (wpis ręczny i edycja zamkniętego wpisu) to nie przeszkadza — tam projekt jest
// już wybrany i lista filtruje się po nim. W obu paskach timera jest odwrotnie:
// zaczyna się od tego, CO się robi, a projekt ma się dobrać sam.
//
// ---------------------------------------------------------------------------
// KOSZT: ZERO ZAPYTAŃ PRZY PISANIU. Ta uwaga jest tu po to, żeby przetrwała.
//
// Filtrujemy tablicę, która przyjechała w propsach strony (services/entrySuggestions.js
// — jedno zapytanie w getServerSideProps, 50 pozycji). Żadnego fetcha na naciśnięcie
// klawisza, żadnego debounce'a, żadnego endpointu wyszukującego.
//
// To nie jest przesadna ostrożność: better-sqlite3 jest SYNCHRONICZNE, a całą firmę
// obsługuje jeden proces Node. Zapytanie do bazy na każdy znak razy kilkanaście osób
// piszących naraz to dokładnie ten wzorzec, który 21.08.2026 położył serwer
// (README, „Kiedy aplikacja muli”). Jeśli kiedyś zabraknie podpowiedzi, właściwą
// odpowiedzią jest podniesienie LIMIT w services/entrySuggestions.js, a NIE
// przeniesienie wyszukiwania na serwer.
// ---------------------------------------------------------------------------

// Poniżej dwóch znaków lista się nie otwiera. Przy jednym znaku „pasuje” prawie
// cała historia, więc lista przestaje być podpowiedzią, a staje się szumem
// zasłaniającym połowę ekranu. Ta sama liczba co w Clockify.
const MIN_CHARS = 2;

// Więcej niż tyle i lista zaczyna zasłaniać wpisy pod paskiem, a i tak nikt nie
// czyta dziesiątej pozycji — od szukania w głąb jest wpisanie kolejnego znaku.
const MAX_ITEMS = 8;

/**
 * Tekst do porównywania: małe litery i BEZ DIAKRYTYKÓW.
 *
 * „mape” ma znaleźć „Mapę tras”. Ludzie piszą w pośpiechu i bez ogonków, a wtedy
 * dosłowne porównanie nie znajduje własnego zadania sprzed tygodnia — czyli
 * podpowiedź zawodzi dokładnie w sytuacji, dla której powstała.
 *
 * NFD rozkłada „ą” na „a” + znak łączący, a druga część zdejmuje te znaki.
 * Polskie „ł” nie jest literą z diakrytykiem w sensie Unicode i tak się nie
 * rozłoży, więc dopisujemy je ręcznie.
 */
const fold = (text) =>
  String(text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ł/g, "l");

/**
 * Dopasowania posortowane tak, żeby to, czego szukał piszący, było na górze.
 *
 * Kolejność wejściowa jest już sensowna — services/entrySuggestions.js sortuje po
 * LICZBIE UŻYĆ, więc codzienna rutyna stoi wyżej niż coś zrobionego raz. Tutaj
 * dokładamy dwa kryteria PRZED tamtym, oba stabilne (Array.sort w JS jest stabilny
 * od ES2019, więc pozycje o równym wyniku zachowują kolejność z serwera):
 *
 *  1. dopasowanie od POCZĄTKU opisu przed dopasowaniem w środku — kto pisze „ma”,
 *     szuka „Mapowania”, a nie „Reklamacji”;
 *  2. pozycje z aktualnie wybranego projektu wyżej.
 *
 * Punkt 2 to RANKING, nie filtr. Wybór projektu nie może niczego ukrywać: cała
 * rzecz polega na tym, żeby dało się znaleźć zadanie, nie wiedząc jeszcze,
 * w którym projekcie było.
 */
const match = (suggestions, query, projectID) => {
  const needle = fold(query);
  if (needle.length < MIN_CHARS) return [];

  const scored = [];
  for (const s of suggestions) {
    const at = fold(s.description).indexOf(needle);
    if (at === -1) continue;
    scored.push({ s, prefix: at === 0 ? 0 : 1, sameProject: Number(s.projectID) === Number(projectID) ? 0 : 1 });
  }

  scored.sort((a, b) => a.prefix - b.prefix || a.sameProject - b.sameProject);
  return scored.slice(0, MAX_ITEMS).map((x) => x.s);
};

/**
 * @param {object[]} suggestions pozycje {projectID, description, projectName, projectColor}
 * @param {string} value treść pola
 * @param {number|string} projectID aktualnie wybrany projekt — do RANKINGU, nie do filtrowania
 * @param {(text: string) => void} onChange
 * @param {(pick: {description: string, projectID: number}) => void} onPick
 * @param {() => void} onSubmit Enter, gdy żadna pozycja nie jest podświetlona
 * @param {boolean} openOnFocus czy samo wejście w pole ma rozwinąć listę
 */
const TaskSuggest = forwardRef(({
  suggestions = [],
  value,
  projectID,
  onChange,
  onPick,
  onSubmit,
  // Pasek startu zaczyna od pustego pola, więc otwarcie na fokus nic nie zasłania
  // i skraca drogę do listy. Biegnący timer ma opis JUŻ wpisany, a tam każde
  // wejście w pole — choćby po to, żeby poprawić literówkę — rozwijałoby listę
  // na pół ekranu. Tam lista wychodzi dopiero przy pisaniu albo strzałką w dół.
  openOnFocus = true,
  id = "opis-zadania",
  className,
  ...inputProps
}, ref) => {
  const [open, setOpen] = useState(false);
  // -1 znaczy „nic nie podświetlone”, i to jest stan POCZĄTKOWY po każdej zmianie
  // tekstu. Gdyby domyślnie świeciła pierwsza pozycja, Enter po dopisaniu znaku
  // podmieniałby wpisany właśnie opis na cudzy — zamiast po prostu wystartować.
  const [active, setActive] = useState(-1);
  const boxRef = useRef(null);

  const items = useMemo(() => match(suggestions, value, projectID), [suggestions, value, projectID]);
  const visible = open && items.length > 0;

  const change = (text) => {
    onChange(text);
    setActive(-1);
    setOpen(text.length >= MIN_CHARS);
  };

  const choose = (item) => {
    onPick({ description: item.description, projectID: item.projectID });
    setOpen(false);
    setActive(-1);
  };

  const onKeyDown = (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!visible) {
        if (items.length > 0) setOpen(true);
        return;
      }
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      // Zawijanie w obie strony przez długość + 1, żeby dało się wrócić do stanu
      // „nic nie podświetlone” i wystartować wpisanym tekstem.
      setActive((prev) => {
        const next = prev + step;
        if (next < -1) return items.length - 1;
        if (next >= items.length) return -1;
        return next;
      });
      return;
    }

    if (event.key === "Enter") {
      if (visible && active >= 0) {
        // Bez preventDefault Enter poleciałby dalej i wystartował timer z opisem
        // sprzed wyboru — czyli wybór podpowiedzi kończyłby się złym wpisem.
        event.preventDefault();
        choose(items[active]);
        return;
      }
      setOpen(false);
      if (onSubmit) onSubmit();
      return;
    }

    if (event.key === "Escape") {
      // Tekst ZOSTAJE. Esc zamyka listę, a nie kasuje to, co ktoś napisał.
      setOpen(false);
      setActive(-1);
      return;
    }

    if (event.key === "Tab") setOpen(false);
  };

  return (
    <div
      ref={boxRef}
      className={classNames("relative", className)}
      // Zamykamy dopiero, gdy fokus wychodzi POZA cały komponent. Samo onBlur na
      // polu zamykałoby listę przy każdym kliknięciu w nią.
      onBlur={(event) => {
        if (!boxRef.current?.contains(event.relatedTarget)) {
          setOpen(false);
          setActive(-1);
        }
      }}
    >
      <Input
        // Ref idzie na SAMO pole, nie na wrapper: wołający ustawia nim kursor
        // w miejscu, którego brakuje (pages/zadania/index.js, walidacja przed Stop).
        ref={ref}
        type="text"
        id={id}
        value={value}
        onChange={(e) => change(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => setOpen(openOnFocus && value.length >= MIN_CHARS)}
        autoComplete="off"
        role="combobox"
        aria-expanded={visible}
        aria-controls={`${id}-lista`}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${id}-poz-${active}` : undefined}
        // UWAGA: propsy z zewnątrz rozwijają się PO tutejszych handlerach, więc
        // własny onKeyDown wołającego skasowałby całą obsługę strzałek, Enter
        // i Esc. Do zatwierdzenia służy onSubmit, nie onKeyDown. onBlur jest
        // bezpieczny: wybór pozycji idzie przez onMouseDown z preventDefault,
        // więc klik w listę nie wywołuje bluru pola.
        {...inputProps}
      />

      {visible && (
        // z-20: nad treścią strony, ale POD paskiem nawigacji (z-30), który jest
        // sticky — inaczej lista wchodziłaby na zegar i menu przy przewijaniu.
        <ul
          id={`${id}-lista`}
          role="listbox"
          className="absolute left-0 right-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded border border-line bg-surface shadow-plate"
        >
          {items.map((item, index) => (
            <li
              key={`${item.projectID}-${item.description}`}
              id={`${id}-poz-${index}`}
              role="option"
              aria-selected={index === active}
              // onMouseDown, NIE onClick: klik najpierw zabiera fokus polu, więc
              // onBlur zdążyłby zamknąć listę, zanim klik do niej dojdzie.
              // preventDefault zatrzymuje właśnie tamto przeniesienie fokusu.
              onMouseDown={(e) => {
                e.preventDefault();
                choose(item);
              }}
              onMouseEnter={() => setActive(index)}
              className={classNames(
                "flex items-center gap-2 px-3 py-2 cursor-pointer text-sm",
                index === active ? "bg-raised" : "bg-transparent"
              )}
            >
              <span className="min-w-0 flex-grow truncate text-body">{item.description}</span>
              <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted">
                <ProjectMark color={item.projectColor} size="sm" />
                <span className="max-w-[10rem] truncate">{item.projectName}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});

// forwardRef gubi nazwę komponentu w React DevTools i w komunikatach ostrzeżeń.
TaskSuggest.displayName = "TaskSuggest";

export default TaskSuggest;
