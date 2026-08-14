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

// "Personel" — wszystko powyżej zwykłego pracownika (eksport CSV, widoki zbiorcze).
export const isStaff = (role) => role === "editor" || role === "manager";
