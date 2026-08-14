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

export const kindLabel = (kind) => OVERTIME_KINDS[kind]?.label ?? kind;

export const kindSign = (kind) => OVERTIME_KINDS[kind]?.sign ?? 1;

// Minuty ze znakiem — tak, jak wpis wpływa na saldo.
export const signedMinutes = (row) => kindSign(row.kind) * row.minutes;

export const OVERTIME_STATUSES = {
  pending: "Oczekuje",
  approved: "Zatwierdzony",
  rejected: "Odrzucony",
  cancelled: "Anulowany",
};

export const STATUS_KEYS = Object.keys(OVERTIME_STATUSES);

export const statusLabel = (status) => OVERTIME_STATUSES[status] ?? status;
