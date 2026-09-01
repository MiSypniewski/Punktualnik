// Kafelki "Wznów" — część BEZ BAZY: granice, tożsamość kafelka i składanie
// listy do renderu. Zapytania i zapis siedzą w services/resumeTiles.js.
//
// Podział jest wymuszony przez bundler, a nie estetykę: pages/zadania/index.js
// używa tych stałych i tej funkcji także w przeglądarce (pole "ile kafelków",
// stan kłódki), a Next wycina z bundla klienta wyłącznie te importy, które są
// używane WYŁĄCZNIE w getServerSideProps. Import z services/ ciągnie za sobą
// services/db.js, a więc better-sqlite3 i `fs` — czyli "Module not found: Can't
// resolve 'fs'" przy pierwszym wejściu na stronę. Ten sam zabieg co
// utils/groupEntries.js.

// Zakres liczby kafelków. Dolna granica to dotychczasowa stała RESUME_TILES,
// czyli stan sprzed tej zmiany; górna bierze się z ekranu, nie z bazy —
// osiemnaście kafelków to na telefonie osiemnaście rzędów i dalej lista
// przestaje być listą skrótów.
export const MIN_TILES = 6;
export const MAX_TILES = 18;
export const DEFAULT_TILES = 6;

export const clampTileCount = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_TILES;
  return Math.min(MAX_TILES, Math.max(MIN_TILES, Math.round(n)));
};

// Tożsamość kafelka: para projekt + opis, bez wielkości liter i bez otaczających
// spacji. "Odprawa celna" i "odprawa celna " to dla człowieka jedno zadanie,
// a dwa nierozróżnialne kafelki obok siebie są defektem, nie wyborem.
//
// JEDNA definicja dla obu stron: serwer odsiewa nią duplikaty przy zapisie,
// przeglądarka rozstrzyga nią stan kłódki. Dwie kopie tej reguły rozjechałyby
// się na pierwszej spacji.
export const tileKey = (projectID, description) =>
  `${Number(projectID)} ${String(description ?? "").trim().toLowerCase()}`;

/**
 * Lista kafelków gotowa do renderu: najpierw przypięte w kolejności pracownika,
 * potem podpowiedzi z historii bez par już przypiętych, całość ucięta do `count`.
 *
 * `usableProjectIDs` to zbiór projektów, na które ta osoba MOŻE dziś raportować
 * (listProjects + projectScope na stronie). Przypięcie na projekcie
 * zarchiwizowanym albo przeniesionym do cudzej sekcji zostaje na ekranie
 * z `usable: false`, bo /api/entries i tak by je odrzuciło — a kafelek, który
 * po kliknięciu wyrzuca błąd, jest gorszy od kafelka widocznie wyłączonego.
 * Podpowiedź w tym samym stanie po prostu ODPADA: jej nikt nie wybierał, więc
 * nie ma czego tłumaczyć ani poprawiać.
 *
 * @returns {{projectID: number, description: string, projectName: string,
 *            projectColor: string, pinned: boolean, usable: boolean}[]}
 */
export const buildTiles = ({ pins = [], suggestions = [], count = DEFAULT_TILES, usableProjectIDs }) => {
  const usable = usableProjectIDs instanceof Set ? usableProjectIDs : new Set(usableProjectIDs ?? []);
  const taken = new Set(pins.map((p) => tileKey(p.projectID, p.description)));

  const pinned = pins.map((p) => ({
    projectID: p.projectID,
    description: p.description,
    projectName: p.projectName,
    projectColor: p.projectColor,
    pinned: true,
    usable: usable.has(Number(p.projectID)),
  }));

  const rest = suggestions
    .filter((s) => !taken.has(tileKey(s.projectID, s.description)))
    // Zasięg sekcji sprawdzamy także tutaj, choć zapytanie podpowiedzi bierze
    // tylko projekty aktywne: historia sięga 90 dni wstecz i pamięta również
    // projekt, który w międzyczasie przeszedł do cudzej sekcji.
    .filter((s) => usable.has(Number(s.projectID)))
    .map((s) => ({
      projectID: s.projectID,
      description: s.description,
      projectName: s.projectName,
      projectColor: s.projectColor,
      pinned: false,
      usable: true,
    }));

  return [...pinned, ...rest].slice(0, clampTileCount(count));
};

export default buildTiles;
