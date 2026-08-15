// Role w systemie: 'user' | 'editor' | 'manager'.
//
//  user    — pracownik: własny czas pracy, własne nadgodziny.
//  editor  — obsługa kart czasu sekcji (klikanie statusów) + eksport CSV.
//  manager — kierownik: zatwierdza i odrzuca wnioski o nadgodziny,
//            widzi salda wszystkich pracowników. Ma też dostęp do eksportu.
//
// Rolę nadaje się z linii poleceń: npm run admin -- role <email|id> manager
// Uwaga: rola siedzi w tokenie JWT, więc po zmianie trzeba się przelogować.

export const ROLES = ["user", "editor", "manager"];

// Zatwierdzanie/odrzucanie wniosków o nadgodziny.
export const canApproveOvertime = (role) => role === "manager";

// Klikanie kafelków z licznikiem czasu (zapis do tabeli Times) — WYŁĄCZNIE
// `editor`, czyli wspólne stanowisko z ekranem dotykowym, przy którym
// pracownicy odbijają wejście i wyjście. Kierownik kafelki tylko ogląda:
// czas pracy ma odbijać ten sam sprzęt co wszystkim, a nie własna przeglądarka.
export const canPunchCards = (role) => role === "editor";

// Eksport czasów pracy do CSV — wyłącznie kierownik. Kiosk stoi na widoku
// publicznym, więc nie może dawać nikomu pobrania listy z całej sekcji.
export const canExportTimes = (role) => role === "manager";

// "Personel" — kto w ogóle ogląda cudze dane w swojej sekcji (kafelki sekcji).
// Uwaga: to NIE jest uprawnienie do zmiany czegokolwiek ani do eksportu —
// od tego są canPunchCards i canExportTimes.
export const isStaff = (role) => role === "editor" || role === "manager";
