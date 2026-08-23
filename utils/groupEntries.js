/**
 * Zwijanie powtórzeń na liście dnia: wpisy o TYM SAMYM opisie i TYM SAMYM
 * projekcie stają się jedną pozycją z licznikiem, łącznym wymiarem i rozpiętością
 * godzin. To odpowiednik "group similar time entries" z Clockify.
 *
 * Funkcja jest czysta i nie dotyka ani bazy, ani Reacta — stąd utils/, a nie
 * services/. Import z services/ wciągnąłby zresztą better-sqlite3 do bundla
 * przeglądarki (ten sam powód, dla którego w utils/index.js siedzi TASK_QUERY_MAX).
 *
 * Para (projectID, description) to dokładnie ten sam klucz, po którym grupuje
 * SQL w services/entrySuggestions.js — kafelki "wznów" i ta lista mają mówić
 * o tych samych zadaniach.
 */

// Separator klucza: U+001F (unit separator). Zwykły znak — myślnik, dwukropek,
// kreska pionowa — może wystąpić w opisie, a wtedy projekt 1 z opisem "2:x"
// i projekt 12 z opisem "x" wpadłyby do jednej grupy. Tego znaku nie da się
// wpisać z klawiatury w pole opisu.
const SEP = String.fromCharCode(31);

/** Klucz grupy: para (projekt, opis) — ta sama co w services/entrySuggestions.js. */
const keyOf = (entry) => `${entry.projectID ?? ""}${SEP}${String(entry.description ?? "").trim()}`;

/**
 * @typedef {object} Group
 * @property {string}   key       klucz grupowania (stabilny — nadaje się na React key)
 * @property {object[]} entries   wpisy w kolejności wejściowej (najnowszy pierwszy)
 * @property {number}   seconds   SUMA wymiarów, nie różnica krańców
 * @property {string}   startedAt najwcześniejszy początek
 * @property {string}   endedAt   najpóźniejszy koniec
 */

/**
 * @param {object[]} list wpisy jednego dnia, posortowane malejąco po startedAt
 *   (tak zwraca services/taskEntries.js: ORDER BY e.data DESC, e.startedAt DESC)
 * @returns {Group[]} grupy w kolejności najnowszego wpisu każdej z nich;
 *   grupa jednoelementowa też jest grupą — o tym, czy narysować ją jako zwykły
 *   wiersz, decyduje widok po entries.length
 */
export const groupEntries = (list) => {
  const map = new Map();
  const out = [];

  list.forEach((entry) => {
    // Wpis domknięty automatycznie NIE wchodzi do grupy. Ma własne ostrzeżenie
    // ("sprawdź czas i popraw wpis") i bursztynowe tło, a zwinięcie schowałoby
    // dokładnie ten sygnał, który woła o poprawkę. To zarazem jedyne wpisy, które
    // bywają bez projektu i bez opisu — zwykły Stop wymusza komplet
    // (services/taskEntries.js: assertComplete) — więc zlewałyby się w bezużyteczny
    // worek "(bez opisu)". Każdy taki wpis dostaje własną, jednoelementową grupę.
    const grouped = !entry.autoClosed;
    const key = grouped ? keyOf(entry) : `auto${SEP}${entry.id}`;
    const found = grouped ? map.get(key) : undefined;

    if (found) {
      found.entries.push(entry);
      found.seconds += entry.seconds || 0;
      // Kolejność wejściowa gwarantuje malejące startedAt, ale porównanie i tak
      // jest tu tanie, a rozpiętość grupy nie ma prawa zależeć od sortowania.
      if (entry.startedAt < found.startedAt) found.startedAt = entry.startedAt;
      if (entry.endedAt > found.endedAt) found.endedAt = entry.endedAt;
      return;
    }

    const group = {
      key,
      entries: [entry],
      seconds: entry.seconds || 0,
      startedAt: entry.startedAt,
      endedAt: entry.endedAt,
    };
    // Grupa staje w miejscu swojego NAJNOWSZEGO wpisu — czyli tego, przy którym
    // powstała. Dzięki temu włączenie grupowania nie przetasowuje listy: wiersze
    // zjeżdżają się do góry, ale żaden nie przeskakuje ponad wcześniejszy.
    if (grouped) map.set(key, group);
    out.push(group);
  });

  return out;
};

export default groupEntries;
