import db from "./db";

// Kto dostaje kafelek z timerem w swojej sekcji: pracownicy i kierownicy.
// Kierownik też odbija swój czas pracy — rola opisuje uprawnienia, nie to,
// czy ktoś jest w zespole. Wyłączony jest wyłącznie `editor`: to wspólne
// konto kiosku na ekranie dotykowym, nie człowiek, więc nie ma czego liczyć.
//
// Kolumny wypisane jawnie. Wcześniej było tu `SELECT *`, a hash i sól (512 znaków
// hex na osobę) maskowano dopiero w JS — czyli bezpieczeństwo zależało od tego,
// czy ktoś pamiętał o podmianie. Teraz te pola po prostu nie opuszczają bazy.
// E-maila też nie ma: tablica kiosku wisi na widoku publicznym.
const stmt = db.prepare(
  `SELECT id, name, surname, section, location, role, isActive
     FROM Users
    WHERE section = ? AND role IN ('user', 'manager') AND isActive = 1`
);

const getUsers = async (section) => {
  const users = stmt.all(section);

  // ID (wielkimi literami) to nazwa, na której stoi components/card.js.
  return users.map((user) => ({ ...user, ID: user.id }));
};

export default getUsers;
