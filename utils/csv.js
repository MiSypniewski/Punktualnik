// Budowanie CSV dla polskiego Excela / LibreOffice.
//
// Wyciągnięte z pages/api/report/index.js, żeby eksport czasów i eksport
// nadgodzin nie miały dwóch osobnych (i rozjeżdżających się) implementacji
// tych samych trzech pułapek: cudzysłowów, separatora i kodowania.

// Cudzysłów wokół każdego pola + podwojenie cudzysłowów w środku (RFC 4180).
export const csvCell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;

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

/** Liczba po polsku — przecinek dziesiętny, inaczej Excel potraktuje ją jak tekst. */
export const plNumber = (n, decimals = 2) => Number(n).toFixed(decimals).replace(".", ",");

export const sendCsv = (res, filename, csv) => {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  return res.status(200).send(csv);
};
