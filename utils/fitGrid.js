// Układ tablicy kiosku: ile kolumn, żeby WSZYSTKIE kafelki stanęły na jednym
// ekranie, bez przewijania.
//
// Kiosk to tablet na ścianie (1024×768), którego nikt nie przewija — kafelek
// poniżej krawędzi ekranu to pracownik, który nie znajdzie swojej karty.
// Stały próg kolumn (lg:grid-cols-3) nie wystarczał: przy czternastu osobach
// dawał pięć rzędów, a na ekranie mieściły się niecałe trzy.
//
// Reguła: najmniej rzędów, przy których kafelek jest jeszcze dość szeroki na
// licznik i nazwisko. Liczba kolumn wynika potem z rzędów (ceil(n / rzędy)),
// żeby ostatni rząd nie wisiał z jednym kafelkiem — pięć osób to 3 + 2,
// a nie 4 + 1.
//
// Czysta funkcja, bez Reacta i bez DOM-u — pomiar robi components/kioskGrid.js.

// Poniżej tej szerokości licznik "00:00:00" (mono, 30 px) i nazwisko wersalikami
// przestają się mieścić w kafelku bez ucinania.
export const MIN_CARD_W = 210;
// Naturalna wysokość wariantu kompaktowego (components/card.js): stan, nazwisko
// z imieniem, licznik z podpisem, plus 2 px na znacznik nieobecności w rogu.
// Niżej podpis wychodziłby poza ramkę.
export const MIN_CARD_H = 136;
// Przy trzech osobach rząd rozciągnięty na cały ekran dawałby kafelki po 600 px —
// za wielkie, żeby wyglądać jak tablica.
export const MAX_CARD_H = 220;
// Kafelek co najmniej tej wysokości mieści pełny wariant (components/card.js)
// razem z podpisem złamanym na dwie linie; niższy przechodzi w kompaktowy.
// Obie wysokości zmierzone w przeglądarce, nie wyliczone z klas.
export const FULL_CARD_H = 214;

/**
 * @param {object} p
 * @param {number} p.count  liczba kafelków
 * @param {number} p.width  szerokość kontenera w px
 * @param {number} p.height wysokość kontenera w px
 * @param {number} p.gap    odstęp między kafelkami w px
 * @returns {{cols: number, rows: number, cardH: number, fits: boolean, density: "full"|"compact"}}
 */
export const fitGrid = ({ count, width, height, gap }) => {
  const n = Math.max(1, count);
  const maxCols = Math.max(1, Math.floor((width + gap) / (MIN_CARD_W + gap)));
  const rows = Math.ceil(n / Math.min(n, maxCols));
  const cols = Math.ceil(n / rows);

  const available = (height - (rows - 1) * gap) / rows;
  // Za dużo osób na jeden ekran (30+ przy 1024×768): kafelki zostają w minimalnej
  // wysokości, a kontener przewija się w środku. Lepsze to niż kafelki ściśnięte
  // tak, że licznik wychodzi poza ramkę.
  const fits = available >= MIN_CARD_H;
  const cardH = Math.floor(fits ? Math.min(available, MAX_CARD_H) : MIN_CARD_H);

  return { cols, rows, cardH, fits, density: cardH >= FULL_CARD_H ? "full" : "compact" };
};
