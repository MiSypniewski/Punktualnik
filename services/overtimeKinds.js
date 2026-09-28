// Rodzaje wniosków o nadgodziny — wspólne dla serwera i klienta.
//
// `minutes` w tabeli Overtime jest ZAWSZE dodatnie; o tym, czy wniosek dodaje
// czy odejmuje od salda, decyduje wyłącznie `kind`. Osobna kolumna ze znakiem
// mogłaby się rozjechać z rodzajem, więc znak żyje tylko tutaj i w jednym
// wyrażeniu SQL (services/overtimeBalanceSql.js).

export const OVERTIME_KINDS = {
  stay_longer: { label: "Zostaję dłużej w pracy", sign: +1 },
  extra_work: { label: "Praca poza godzinami (np. wieczorem w domu)", sign: +1 },
  early_leave: { label: "Wcześniejsze wyjście z pracy", sign: -1 },
};

export const KIND_KEYS = Object.keys(OVERTIME_KINDS);

// Rodzaje wniosków, które przesuwają godzinę wyjścia Z FIRMY — planowane
// wyjście na /urlopy/stan (services/dayBoard.js) i cel odliczania na kafelku
// kiosku (components/card.js, dane z services/getShiftsForDay.js).
//
// Lista jest WYPISANA, a nie wyliczona ze znaku, i to jest świadome:
// `extra_work` ("praca poza godzinami, np. wieczorem w domu") ma znak dodatni
// jak `stay_longer`, ale obecności na miejscu nie wydłuża. Wyliczenie po znaku
// przesuwałoby wyjście o czas przepracowany w domu. Nowy rodzaj wniosku trafia
// tutaj wtedy i tylko wtedy, gdy zmienia godzinę wyjścia z firmy.
export const SHIFT_KINDS = ["stay_longer", "early_leave"];

export const kindLabel = (kind) => OVERTIME_KINDS[kind]?.label ?? kind;

export const kindSign = (kind) => OVERTIME_KINDS[kind]?.sign ?? 1;

/**
 * Czy przy tym rodzaju powód jest obowiązkowy.
 *
 * Wymagamy go tam, gdzie wniosek DOPISUJE czas do salda: kierownik zatwierdza
 * wtedy godziny, za które firma zapłaci, i musi wiedzieć za co. "Wcześniejsze
 * wyjście" saldo obniża — pracownik oddaje własny czas i nie ma się z czego
 * tłumaczyć, więc tam powód zostaje nieobowiązkowy.
 *
 * Reguła WYNIKA ze znaku, a nie jest drugą listą rodzajów do utrzymania:
 * nowy rodzaj "na plus" dostanie wymagany powód sam z siebie.
 */
export const requiresReason = (kind) => kindSign(kind) > 0;

// Minuty ze znakiem — tak, jak wpis wpływa na saldo.
export const signedMinutes = (row) => kindSign(row.kind) * row.minutes;

// `cancelled` i `revoked` to dwie różne rzeczy i celowo mają dwie nazwy:
// anuluje PRACOWNIK własny wniosek, dopóki nikt go nie rozpatrzył; cofa
// KIEROWNIK, w dowolnym momencie i z obowiązkowym powodem. Jeden wspólny status
// znaczyłby, że po pół roku nie da się odróżnić "rozmyślił się" od "kierownik
// wycofał zatwierdzenie", a pod tym drugim stoi zmiana salda.
export const OVERTIME_STATUSES = {
  pending: "Oczekuje",
  approved: "Zatwierdzony",
  rejected: "Odrzucony",
  cancelled: "Anulowany",
  revoked: "Cofnięty",
};

export const STATUS_KEYS = Object.keys(OVERTIME_STATUSES);

export const statusLabel = (status) => OVERTIME_STATUSES[status] ?? status;

// Czasownik do podpisu pod wnioskiem ("Zatwierdził: Anna Kowalska").
//
// Jedno miejsce zamiast ternarnego `status === "approved" ? ... : ...`
// powtórzonego na czterech stronach — tamten zapis przy trzecim stanie zaczynał
// kłamać, bo cofnięty wniosek podpisywał się jako "Odrzucił".
export const decisionVerb = (status) =>
  ({ approved: "Zatwierdził", rejected: "Odrzucił", revoked: "Cofnął" }[status] ?? "Rozpatrzył");
