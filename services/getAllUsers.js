import db from "./db";

// Lista kont do filtrów (dropdowny na stronach eksportu i panelu kierownika).
// Bez maskowania haseł — zwracamy tylko pola potrzebne do listy wyboru.
// Times.userID == Users.id.
const COLUMNS = `id, name, surname, section`;
const ORDER = `ORDER BY surname, name`;
// Konta `editor` to kioski z ekranem dotykowym, nie ludzie — w filtrach
// „wybierz pracownika" nie mają czego szukać.
const NOT_KIOSK = `role <> 'editor'`;

const stmtAll = db.prepare(`SELECT ${COLUMNS} FROM Users WHERE ${NOT_KIOSK} ${ORDER}`);

// Osobne zapytanie per liczba sekcji; nazwy sekcji zawsze przez binding.
const cache = new Map();
const stmtForSections = (count) => {
  if (!cache.has(count)) {
    const placeholders = Array.from({ length: count }, (_, i) => `@sec${i}`).join(", ");
    cache.set(
      count,
      db.prepare(`SELECT ${COLUMNS} FROM Users WHERE ${NOT_KIOSK} AND section IN (${placeholders}) ${ORDER}`)
    );
  }
  return cache.get(count);
};

/**
 * @param {string[]} [sections] zawężenie do sekcji; pominięcie = wszyscy,
 *   pusta tablica = nikt. Dzięki temu w filtrze nie widać nazwisk ludzi,
 *   których danych i tak nie wolno obejrzeć.
 */
const getAllUsers = (sections) => {
  if (!Array.isArray(sections)) return stmtAll.all();
  if (sections.length === 0) return [];

  const params = {};
  sections.forEach((s, i) => {
    params[`sec${i}`] = String(s);
  });
  return stmtForSections(sections.length).all(params);
};

export default getAllUsers;
