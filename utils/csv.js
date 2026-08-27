// Budowanie CSV dla polskiego Excela / LibreOffice.
//
// Wyciągnięte z pages/api/report/index.js, żeby eksport czasów i eksport
// nadgodzin nie miały dwóch osobnych (i rozjeżdżających się) implementacji
// tych samych trzech pułapek: cudzysłowów, separatora i kodowania.

/** Liczba po polsku — przecinek dziesiętny, inaczej Excel potraktuje ją jak tekst. */
export const plNumber = (n, decimals = 2) => Number(n).toFixed(decimals).replace(".", ",");

/**
 * Komórka liczbowa: w CSV zapisze się po polsku (przecinek dziesiętny), w XLSX
 * jako prawdziwa liczba, którą arkusz zsumuje.
 *
 * Znacznik jest tutaj, a nie w `utils/xlsx.js`, bo to `csvCell` musi go umieć
 * rozpakować — inaczej dołożenie XLSX zmieniłoby zawartość plików CSV, które
 * ludzie mają podpięte pod swoje formuły.
 */
export const num = (value, decimals = 2) => ({ num: Number(value), decimals });

export const isNumCell = (v) => typeof v === "object" && v !== null && "num" in v;

// Cudzysłów wokół każdego pola + podwojenie cudzysłowów w środku (RFC 4180).
export const csvCell = (v) => {
  const text = isNumCell(v) ? plNumber(v.num, v.decimals) : String(v ?? "");
  return `"${text.replace(/"/g, '""')}"`;
};

/**
 * @param {string[]} header nagłówki kolumn
 * @param {Array<Array<string|number>>} rows wiersze danych
 * @returns {string} gotowa zawartość pliku
 */
export const buildCsv = (header, rows) => {
  const lines = [header, ...rows].map((cells) => cells.map(csvCell).join(";"));
  // BOM (﻿) + separator ";" => polski Excel/LibreOffice rozbija na kolumny
  // i poprawnie pokazuje polskie znaki.
  return "﻿" + lines.join("\r\n") + "\r\n";
};

const csvHeaders = (res, filename) => {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  // Eksport zawiera dane osobowe i zawsze dotyczy "teraz" — nie ma czego
  // trzymać w cache przeglądarki ani pośrednika.
  res.setHeader("Cache-Control", "no-store");
};

export const sendCsv = (res, filename, csv) => {
  csvHeaders(res, filename);
  return res.status(200).send(csv);
};

// Ile wierszy sklejamy przed wypchnięciem do gniazda. Kompromis: mniejsze porcje
// to więcej wywołań write(), większe — więcej pamięci naraz.
const CHUNK_ROWS = 200;

/**
 * CSV pisany PORCJAMI, dla eksportów bez górnego ograniczenia liczby wierszy.
 *
 * buildCsv skleja cały plik w jeden string w pamięci, co przy eksporcie szerokiego
 * zakresu dat jest największą pojedynczą alokacją w całej aplikacji — a kontener
 * ma 1 GB i zero swapu, więc OOM-killer ubiłby proces bez śladu w logu.
 * Tutaj do pamięci trafia najwyżej CHUNK_ROWS wierszy naraz.
 *
 * @param {import("http").ServerResponse} res
 * @param {string} filename
 * @param {string[]} header
 * @param {Iterable<Array<string|number>>} rows leniwe źródło wierszy
 *   (np. better-sqlite3 stmt.iterate() przepuszczone przez mapowanie)
 */
export const streamCsv = (res, filename, header, rows) => {
  csvHeaders(res, filename);
  res.status(200);

  // BOM + separator ";" — tak samo jak w buildCsv, plik ma być nie do odróżnienia.
  let buffer = "﻿" + header.map(csvCell).join(";") + "\r\n";
  let pending = 0;

  for (const cells of rows) {
    buffer += cells.map(csvCell).join(";") + "\r\n";
    if (++pending >= CHUNK_ROWS) {
      res.write(buffer);
      buffer = "";
      pending = 0;
    }
  }

  res.write(buffer);
  return res.end();
};
