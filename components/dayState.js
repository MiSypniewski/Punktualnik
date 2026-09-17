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
  pending_absence: { label: "Bez karty", tone: "neutral" },
  no_card: { label: "Bez karty", tone: "neutral" },
};

/**
 * Etykieta i ton chipa stanu.
 *
 * Dwa doprecyzowania wobec surowej mapy wyżej:
 *  - pełna dniówka dostaje zieleń, ale karta domknięta nocą NIGDY — ósemka
 *    wpisana przez zadanie nocne jest założona, nie zmierzona, a zieleń w tym
 *    systemie znaczy "przepracowane i pełne";
 *  - brak karty robi się czerwony dopiero wtedy, gdy przestaje znaczyć
 *    "jeszcze nie przyszedł" (flagę `latePunch` ustawia serwer, bo zegar
 *    przeglądarki bywa przestawiony).
 */
export const stateBadge = (person) => {
  const base = STATES[person.state] || STATES.no_card;

  if (person.state === "done" && person.full && !person.autoClosed) {
    return { label: base.label, tone: "ok" };
  }
  if ((person.state === "no_card" || person.state === "pending_absence") && person.latePunch) {
    return { label: base.label, tone: "danger" };
  }
  return base;
};

/** Czy ten stan znaczy "pracuje TERAZ" — jedyne uprawnienie do bursztynu. */
export const isLive = (person) => person.state === "working" || person.state === "absent_present";

/**
 * Drobne dopiski w kolumnie "Uwagi": wyłącznie rzeczy, które zmieniają odczyt
 * godzin albo wymagają reakcji. Każdy to para {label, tone, title}.
 */
export const remarks = (person) => {
  const out = [];

  if (person.autoClosed) {
    out.push({
      label: "auto",
      tone: "neutral",
      title: "Kartę domknęło zadanie nocne na osiem godzin od wejścia — godzina jest założona, nie zmierzona",
    });
  }
  if (person.editedByName) {
    out.push({ label: `popr. ${person.editedByName}`, tone: "neutral", title: "Karta poprawiona przez kierownika" });
  }
  if (person.earlyLeaveMin > 0) {
    out.push({
      label: `wcześniej o ${formatMinutes(person.earlyLeaveMin)}`,
      tone: "accent",
      title: "Zatwierdzony wniosek o wcześniejsze wyjście — planowane wyjście jest o tyle wcześniej",
    });
  }
  if (person.stayLongerMin > 0) {
    out.push({
      label: `dłużej o ${formatMinutes(person.stayLongerMin)}`,
      tone: "accent",
      title: "Zatwierdzony wniosek o zostanie dłużej — planowane wyjście jest o tyle później",
    });
  }
  // Karta otwarta po godzinie, o której miała się zamknąć. To prawie zawsze
  // zapomniane drugie dotknięcie kafelka, a zadanie nocne złapie je dopiero
  // o 3:00 — ten chip jest jedynym miejscem, gdzie da się zareagować tego
  // samego dnia. Bursztyn, bo mówi o stanie "teraz".
  if (person.overdue) {
    out.push({
      label: "po planowanym wyjściu",
      tone: "signal",
      title:
        "Karta wisi otwarta po wyliczonej godzinie wyjścia — sprawdź, czy ktoś nie zapomniał drugiego dotknięcia kafelka",
    });
  }
  if (person.state === "absent_present") {
    out.push({
      label: "karta mimo nieobecności",
      tone: "signal",
      title: "Ma zatwierdzoną nieobecność na ten dzień, a jednak odbił kartę",
    });
  }
  // Wniosek oczekujący dopisujemy niezależnie od stanu, a nie tylko przy
  // `pending_absence`: ktoś, kto zgłosił urlop na dziś i mimo to odbił kartę,
  // jest dokładnie tą sytuacją, o której kierownik ma wiedzieć przed decyzją.
  if (person.absence && person.absence.status === "pending") {
    out.push({ label: "wniosek oczekuje", tone: "accent", title: "Nieobecność na ten dzień czeka na decyzję" });
  }
  // Saldo nadgodzin to stan NARASTAJĄCY, bez własnej daty — nie ma nic wspólnego
  // z wnioskiem o wcześniejsze wyjście z tego dnia. Pokazujemy je tylko na
  // minusie, bo tylko wtedy jest czego dopilnować (przypomnienie o niedogodzinach
  // wraca w każdy wtorek, dopóki saldo nie wróci nad progiem).
  if (person.balanceMin < 0) {
    out.push({
      label: `saldo ${formatMinutes(person.balanceMin)}`,
      tone: "danger",
      title: "Ujemne saldo nadgodzin — do pokrycia urlopem i osobnym wnioskiem",
    });
  }

  return out;
};

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
