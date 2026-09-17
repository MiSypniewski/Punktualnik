import { absenceKindShort } from "../services/absenceKinds";
import { formatMinutes } from "../utils";

// Słownik stanów pracownika w danym dniu — wspólny dla tabeli, kart na telefonie
// i osi czasu na /urlopy/stan.
//
// Osobny plik, bo te same trzy widoki muszą mówić o tym samym stanie tym samym
// słowem i tym samym kolorem. Gdyby etykiety żyły w każdym z nich osobno,
// pierwsza poprawka rozjechałaby oś z tabelą i nie byłoby widać, że to ten sam
// wiersz.
//
// Importujemy TYLKO services/absenceKinds.js — ten plik świadomie nie dotyka
// bazy, więc wolno mu wejść do bundla przeglądarki (jak services/overtimeKinds.js).

// Stan wylicza services/dayBoard.js; tutaj zostaje wyłącznie to, jak go nazwać
// i pokolorować.
//
// Etykiety są bezosobowe ("Po pracy", nie "Zakończył") — wiersz opisuje kartę
// czasu konkretnej osoby, a rodzaj gramatyczny tej osoby nie jest aplikacji
// znany i nie ma prawa się w nim zgadywać.
const STATES = {
  working: { label: "W pracy", tone: "signal" },
  absent_present: { label: "W pracy", tone: "signal" },
  done: { label: "Po pracy", tone: "neutral" },
  absent: { label: "Nieobecność", tone: "neutral" },
  // Etykieta mówi o WNIOSKU, nie o karcie: ktoś, kto zgłosił nieobecność na
  // ten dzień i czeka na decyzję, nie jest "bez karty" — jest przed decyzją.
  // Ta nazwa czyta się poprawnie i dla dnia minionego, i dla przyszłego.
  pending_absence: { label: "Wniosek", tone: "accent" },
  no_card: { label: "Bez karty", tone: "neutral" },
  // Tylko dla dnia przyszłego. "Bez karty" o dniu, w którym karty nie dało się
  // jeszcze odbić, byłoby zarzutem postawionym całemu zespołowi naraz.
  expected: { label: "W planie", tone: "neutral" },
};

/**
 * Etykieta i ton chipa stanu.
 *
 * Trzy doprecyzowania wobec surowej mapy wyżej:
 *  - pełna dniówka dostaje zieleń, ale karta domknięta nocą NIGDY — ósemka
 *    wpisana przez zadanie nocne jest założona, nie zmierzona, a zieleń w tym
 *    systemie znaczy "przepracowane i pełne";
 *  - dniówka NIEPEŁNA dostaje czerwień, tym samym podziałem, co belka na osi
 *    czasu (components/dayTimeline.js). Wcześniej była neutralna razem
 *    z domkniętą nocą i przez to niewidoczna, choć jest jedyną z trzech, która
 *    wymaga rozmowy z pracownikiem;
 *  - brak karty robi się czerwony dopiero wtedy, gdy przestaje znaczyć
 *    "jeszcze nie przyszedł" (flagę `latePunch` ustawia serwer, bo zegar
 *    przeglądarki bywa przestawiony).
 */
export const stateBadge = (person) => {
  const base = STATES[person.state] || STATES.no_card;

  if (person.state === "done" && !person.autoClosed) {
    return { label: base.label, tone: person.full ? "ok" : "danger" };
  }
  // Tylko `no_card`. `pending_absence` zostaje w tonie wniosku, bo tam brak
  // karty ma już wyjaśnienie — ktoś zgłosił nieobecność i czeka na decyzję.
  if (person.state === "no_card" && person.latePunch) {
    return { label: base.label, tone: "danger" };
  }
  return base;
};

/** Czy ten stan znaczy "pracuje TERAZ" — jedyne uprawnienie do bursztynu. */
export const isLive = (person) => person.state === "working" || person.state === "absent_present";

// --- dopiski przy godzinach -------------------------------------------------
//
// Do września 2026 wszystko poniżej stało w osobnej kolumnie "Uwagi" jako rządek
// chipów wersalikami. Przy trzech chipach w wierszu kolumna przestawała się
// czytać, a ekran, który ma dawać odpowiedź JEDNYM SPOJRZENIEM, kazał czytać
// siedem wielkich napisów obok każdego nazwiska.
//
// Dopiski wróciły więc tam, o czym mówią: znaczniki karty stoją przy godzinie
// wyjścia, wyprowadzenie tej godziny siedzi w jej dymku, a stany, o których
// mówi już chip stanu i podpis nieobecności ("karta mimo nieobecności",
// "wniosek oczekuje"), nie są powtarzane wcale.

/**
 * Skąd wzięła się godzina w kolumnie "Wyjście" — treść dymka.
 *
 * Wyprowadzenie wpisane słowami, a nie chip "wcześniej o 1h 30min": kierownik
 * patrzący na 14:00 pyta „czemu 14:00", a nie „czy jest tu jakiś wniosek".
 */
export const exitNote = (person) => {
  if (!person.startHm) return "";

  const parts = [];

  if (person.endIsPlanned) {
    const shift = [];
    if (person.stayLongerMin > 0)
      shift.push(`+ ${formatMinutes(person.stayLongerMin)} (zatwierdzone zostanie dłużej)`);
    if (person.earlyLeaveMin > 0)
      shift.push(`− ${formatMinutes(person.earlyLeaveMin)} (zatwierdzone wcześniejsze wyjście)`);

    parts.push(
      `Godzina WYLICZONA: ${person.startHm} + 8 h${shift.length ? ` ${shift.join(" ")}` : ""}.` +
        " Aplikacja nie zna grafiku pracy, więc to prognoza, nie ustalenie."
    );
    if (person.overdue) {
      parts.push(
        "Karta wisi otwarta po tej godzinie — sprawdź, czy ktoś nie zapomniał drugiego dotknięcia kafelka."
      );
    }
  }

  if (person.autoClosed) {
    parts.push(
      "Kartę domknęło zadanie nocne na osiem godzin od wejścia — ta godzina jest założona, nie zmierzona."
    );
  }
  if (person.editedByName) {
    parts.push(`Kartę poprawił kierownik: ${person.editedByName}.`);
  }

  return parts.join(" ");
};

/**
 * Znaczniki karty przy godzinie wyjścia — drobnym tekstem, nie chipem
 * wersalikami. To przypis do liczby obok, nie osobna informacja.
 */
export const exitMarks = (person) => {
  const out = [];
  if (person.autoClosed) out.push("auto");
  if (person.editedByName) out.push("popr.");
  return out;
};

/**
 * Czy godzina wyjścia sama ma krzyczeć. Bursztyn, bo mówi o stanie "teraz":
 * karta otwarta po wyliczonej godzinie wyjścia to prawie zawsze zapomniane
 * drugie dotknięcie kafelka, a zadanie nocne złapie je dopiero o 3:00.
 */
export const exitAlarming = (person) => Boolean(person.overdue);

/**
 * Dymek przy nazwisku: ujemne saldo nadgodzin.
 *
 * Saldo jest stanem NARASTAJĄCYM, bez własnej daty — nie ma nic wspólnego z tym
 * konkretnym dniem i dlatego zeszło z wiersza do dymka. Na plusie milczy: nie
 * ma czego pilnować, a przypomnienie o niedogodzinach wraca w każdy wtorek,
 * dopóki saldo jest pod progiem.
 */
export const nameNote = (person) =>
  person.balanceMin < 0
    ? `Saldo nadgodzin ${formatMinutes(person.balanceMin)} — do pokrycia urlopem i osobnym wnioskiem.`
    : "";

/**
 * Rodzaj nieobecności w skrócie z terminem powrotu, albo puste.
 *
 * Wniosek oczekujący dostaje przedrostek "wniosek:" — bez niego wiersz czytałby
 * się jak zatwierdzona nieobecność, a to jest różnica między faktem i zamiarem.
 * Skrót zostaje taki, jak w słowniku ("L4", nie "l4").
 */
export const absenceLabel = (person) => {
  if (!person.absence) return "";
  const prefix = person.absence.status === "pending" ? "wniosek: " : "";
  return `${prefix}${absenceKindShort(person.absence.kind)} do ${person.absence.dateTo}`;
};
