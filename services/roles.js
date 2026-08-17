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

// --- Moduł zadań (projekty + raportowanie czasu) ---------------------------

// Raportowanie własnych zadań: każdy zalogowany CZŁOWIEK, ale nie kiosk.
// Konto `editor` jest współdzielone przez całą sekcję — nie wiadomo, kto przy
// nim stoi, więc jego wpis nie miałby właściciela. To odwrotność canPunchCards:
// kartę czasu odbija się na wspólnym sprzęcie, a zadania raportuje się u siebie.
export const canTrackTasks = (role) => role === "user" || role === "manager";

// Słownik projektów: zakładanie, zmiana nazwy, archiwizacja. Świadomie w webie,
// a nie w scripts/admin.js — inaczej dodanie projektu wymagałoby wejścia na
// serwer, dokładnie tak jak przed powstaniem tabeli Sections.
export const canManageProjects = (role) => role === "manager";

// Oglądanie i korygowanie cudzych wpisów. Sama rola nie wystarcza — zasięg
// sekcyjny nakłada dodatkowo services/scope.js.
export const canSeeTeamTasks = (role) => role === "manager";

// Eksport wpisów do CSV — jak przy czasach pracy, wyłącznie kierownik.
export const canExportTasks = (role) => role === "manager";

// Okno "dziś i wczoraj" (services/workday.js) wiąże PRACOWNIKA — kierownika nie,
// także na WŁASNYCH wpisach. Wcześniej zdjęcie okna wisiało na warunku "to cudzy
// wpis", nie na roli, i wychodziła z tego reguła bez sensu: kierownik naprawiał
// cudzy błąd sprzed tygodnia, ale własnego już nie sięgał. Skoro odpowiada za
// poprawność ewidencji całej sekcji, to tym bardziej za swoją.
export const boundByEditWindow = (role) => !canSeeTeamTasks(role);
