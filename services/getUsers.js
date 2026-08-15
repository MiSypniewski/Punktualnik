import db from "./db";

// Kto dostaje kafelek z timerem w swojej sekcji: pracownicy i kierownicy.
// Kierownik też odbija swój czas pracy — rola opisuje uprawnienia, nie to,
// czy ktoś jest w zespole. Wyłączony jest wyłącznie `editor`: to wspólne
// konto kiosku na ekranie dotykowym, nie człowiek, więc nie ma czego liczyć.
const stmt = db.prepare(
  `SELECT * FROM Users WHERE section = ? AND role IN ('user', 'manager') AND isActive = 1`
);

const getUsers = async (section) => {
  const users = stmt.all(section);

  return users.map((user) => ({
    ...user,
    ID: user.id,
    passwordHash: ";)",
    passwordSalt: ";)",
    email: ";)",
  }));
};

export default getUsers;
