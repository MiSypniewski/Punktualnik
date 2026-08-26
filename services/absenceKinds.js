// Rodzaje nieobecności — wspólne dla serwera i klienta.
//
// Ten plik NIE importuje ./db, więc bezpiecznie wchodzi do bundla przeglądarki
// (formularze pokazują z niego etykiety). Ta sama zasada co w overtimeKinds.js:
// cokolwiek dotyka services/db.js, ciągnie za sobą better-sqlite3.

export const ABSENCE_KINDS = {
  // usesPool  — czy zdejmuje dni z puli urlopu wypoczynkowego
  // selfService — czy PRACOWNIK może to zgłosić sam; kierownik wpisuje wszystko
  vacation: { label: "Urlop wypoczynkowy", usesPool: true, selfService: true },
  // Formalnie pracownik ma do niego prawo, ale w praktyce zgłasza go telefonem
  // rano, a wpisuje kierownik po fakcie — stąd selfService: false.
  on_demand: { label: "Urlop na żądanie", usesPool: true, selfService: false },
  // L4 nie jest urlopem i puli nie rusza. Wpisuje wyłącznie kierownik, po
  // otrzymaniu zwolnienia — nie ma tu czego akceptować.
  sick_leave: { label: "Zwolnienie lekarskie (L4)", usesPool: false, selfService: false },
  unpaid: { label: "Urlop bezpłatny", usesPool: false, selfService: true },
  care: { label: "Opieka nad dzieckiem lub członkiem rodziny", usesPool: false, selfService: true },
  occasional: { label: "Urlop okolicznościowy", usesPool: false, selfService: true },
  // Zwolnienie od pracy dla honorowego dawcy krwi. Nie jest urlopem i puli
  // wypoczynkowej nie rusza — dzień oddania (a w praktyce także dzień badań)
  // przysługuje niezależnie od niej. Pracownik zgłasza sam, jak urlop
  // okolicznościowy: termin zna z wyprzedzeniem, a zaświadczenie ze stacji
  // krwiodawstwa donosi kierownikowi osobno, poza systemem.
  blood_donation: { label: "Oddanie krwi", usesPool: false, selfService: true },
};

export const ABSENCE_KIND_KEYS = Object.keys(ABSENCE_KINDS);

/** Rodzaje, które pracownik może zgłosić sam — reszta wyłącznie przez kierownika. */
export const SELF_SERVICE_KINDS = ABSENCE_KIND_KEYS.filter((k) => ABSENCE_KINDS[k].selfService);

/** Rodzaje zdejmujące dni z puli urlopowej. */
export const POOL_KINDS = ABSENCE_KIND_KEYS.filter((k) => ABSENCE_KINDS[k].usesPool);

export const absenceKindLabel = (kind) => ABSENCE_KINDS[kind]?.label ?? kind;

// Skróty na kafelek kiosku — tam na "Opieka nad dzieckiem lub członkiem rodziny"
// nie ma miejsca, a kafelek ma się czytać z drugiego końca hali.
const SHORT = {
  vacation: "Urlop",
  on_demand: "Na żądanie",
  sick_leave: "L4",
  unpaid: "Bezpłatny",
  care: "Opieka",
  occasional: "Okolicznościowy",
  blood_donation: "Krwiodawstwo",
};

export const absenceKindShort = (kind) => SHORT[kind] ?? absenceKindLabel(kind);

export const usesPool = (kind) => Boolean(ABSENCE_KINDS[kind]?.usesPool);

export const isSelfService = (kind) => Boolean(ABSENCE_KINDS[kind]?.selfService);

// Statusy jak przy nadgodzinach — ten sam obieg, te same etykiety, łącznie
// z rozdziałem "anulował pracownik" (cancelled) od "cofnął kierownik" (revoked).
// Powód rozdziału opisuje services/overtimeKinds.js.
export const ABSENCE_STATUSES = {
  pending: "Oczekuje",
  approved: "Zatwierdzony",
  rejected: "Odrzucony",
  cancelled: "Anulowany",
  revoked: "Cofnięty",
};

export const ABSENCE_STATUS_KEYS = Object.keys(ABSENCE_STATUSES);

export const absenceStatusLabel = (status) => ABSENCE_STATUSES[status] ?? status;

/** Czasownik do podpisu pod wnioskiem — jak w services/overtimeKinds.js. */
export const decisionVerb = (status) =>
  ({ approved: "Zatwierdził", rejected: "Odrzucił", revoked: "Cofnął" }[status] ?? "Rozpatrzył");
