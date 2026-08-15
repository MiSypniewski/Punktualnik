import db from "./db";

// Słownik sekcji (działów) — jedyne źródło prawdy o tym, jakie sekcje istnieją.
// Wcześniej odpowiedź na to pytanie brzmiała "te, które ktoś akurat ma
// w Users.section", przez co literówka tworzyła nową sekcję zamiast błędu,
// a `Spedycja` i `spedycja` były dwiema różnymi sekcjami.
//
// slug trafia do adresu /time/<slug> i do trzech kolumn tekstowych
// (Users.section, Times.section, ManagerSections.section), więc jest niezmienny
// — zmienia się wyłącznie label (etykieta dla człowieka).
//
// Aplikacja sekcje wyłącznie CZYTA. Dodawanie, zmiana etykiety i wyłączanie
// siedzą w scripts/admin.js (CommonJS, nie zaimportuje tego modułu) — tam też
// jest walidacja slugu. Gdyby kiedyś powstał panel webowy, zapis wraca tutaj.

const stmtListActive = db.prepare(
  `SELECT slug, label, isActive FROM Sections WHERE isActive = 1 ORDER BY label COLLATE NOCASE`
);
const stmtListAll = db.prepare(`SELECT slug, label, isActive FROM Sections ORDER BY label COLLATE NOCASE`);

// COLLATE NOCASE, bo sekcje odziedziczone sprzed tabeli Sections zachowują
// oryginalną pisownię (np. 'Spedycja') — muszą taką zostać, inaczej rozjechałyby
// się z Users.section i Times.section. Wyszukiwanie ma je znaleźć mimo to,
// a zwrócony slug jest zawsze tym zapisanym w bazie. Nowe slugi i tak są ASCII
// z małych liter, więc ograniczenie NOCASE do ASCII nie ma tu znaczenia.
const stmtGet = db.prepare(`SELECT slug, label, isActive FROM Sections WHERE slug = ? COLLATE NOCASE`);

const toRow = (row) => (row ? { ...row, isActive: Boolean(row.isActive) } : undefined);

/** @returns {{slug: string, label: string, isActive: boolean}[]} */
export const listSections = ({ includeInactive = false } = {}) =>
  (includeInactive ? stmtListAll : stmtListActive).all().map(toRow);

/** @returns sekcję w pisowni ZAPISANEJ w bazie albo undefined */
export const getSection = (slug) => toRow(stmtGet.get(String(slug ?? "").trim()));

export default listSections;
