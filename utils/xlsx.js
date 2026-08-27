// Budowanie XLSX — bliźniak utils/csv.js dla tych samych par (header, rows).
//
// Sens istnienia obok CSV jest jeden: w arkuszu liczby mają być LICZBAMI.
// CSV oddaje "1,75" jako tekst i kolumny "Czas [h]" czy "Saldo (h)" trzeba
// przed zsumowaniem konwertować ręcznie. Komórkę liczbową znaczy się
// helperem `num()` z utils/csv.js — tam, bo to `csvCell` musi umieć go
// rozpakować z powrotem do polskiego zapisu.
//
// Daty i godziny zostają TEKSTEM w formacie ISO, tak jak w CSV. Reguła
// "jeden format dat we wszystkich eksportach" (README, sekcja Daty) jest
// warta więcej niż filtrowanie po dacie w Excelu, a tekst `2026-08-27`
// i tak sortuje się chronologicznie.

import ExcelJS from "exceljs";
import { isNumCell } from "./csv";

const CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// Kod formatu Excela zawsze ma kropkę — separator dziesiętny podstawia sobie
// aplikacja wg ustawień regionalnych, więc w polskim Excelu zobaczymy przecinek.
const numFmt = (decimals) => (decimals > 0 ? `0.${"0".repeat(decimals)}` : "0");

// Szerokość kolumny z długości nagłówka: bez tego wszystkie mają domyślne 8
// znaków i pierwsze, co robi człowiek po otwarciu pliku, to rozciąganie ich myszą.
const widthFor = (headerCell) => Math.min(Math.max(String(headerCell).length + 4, 12), 42);

/**
 * Zapisuje arkusz prosto w odpowiedź HTTP.
 *
 * Zawsze STRUMIENIOWO (`WorkbookWriter`), więc — inaczej niż w CSV — nie ma tu
 * podziału na wariant "wszystko naraz" i "porcjami". Powód ten sam, który opisuje
 * `streamCsv` w utils/csv.js: kontener bez swapu, a `rows` bywa iteratorem prosto
 * z bazy, bez górnego ograniczenia liczby wierszy.
 *
 * @param {import("http").ServerResponse} res
 * @param {string} filename nazwa pliku z rozszerzeniem
 * @param {string} sheetName nazwa arkusza (Excel: max 31 znaków, bez : \ / ? * [ ])
 * @param {string[]} header nagłówki kolumn
 * @param {Iterable<Array<unknown>>} rows wiersze — tablica albo leniwy iterator
 */
export const sendXlsx = async (res, filename, sheetName, header, rows) => {
  res.setHeader("Content-Type", CONTENT_TYPE);
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  // Eksport zawiera dane osobowe i zawsze dotyczy "teraz" — nie ma czego
  // trzymać w cache przeglądarki ani pośrednika.
  res.setHeader("Cache-Control", "no-store");
  res.statusCode = 200;

  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream: res,
    // Style są potrzebne na format liczb i pogrubiony nagłówek.
    useStyles: true,
    // Słownik ciągów oszczędza miejsce, ale musiałby zostać w pamięci do końca
    // zapisu — czyli dokładnie to, czego strumień ma uniknąć.
    useSharedStrings: false,
  });

  const sheet = workbook.addWorksheet(sheetName, {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  // Same szerokości, bez `header` — inaczej exceljs sam dopisze wiersz nagłówka
  // i nie da się go już wystylować przed zatwierdzeniem.
  sheet.columns = header.map((h) => ({ width: widthFor(h) }));

  const head = sheet.addRow(header);
  head.font = { bold: true };
  head.commit();

  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: header.length } };

  for (const cells of rows) {
    const row = sheet.addRow(cells.map((c) => (isNumCell(c) ? c.num : c ?? "")));
    cells.forEach((c, i) => {
      if (isNumCell(c)) row.getCell(i + 1).numFmt = numFmt(c.decimals);
    });
    row.commit();
  }

  await sheet.commit();
  // Domyka ZIP-a i kończy odpowiedź — po tym nie wolno już nic pisać do `res`.
  return workbook.commit();
};
