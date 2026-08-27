// Jedno miejsce, w którym eksport rozgałęzia się na format pliku.
//
// Bez tego każdy z czterech endpointów w pages/api/report/ powtarzałby ten sam
// `if (format === "xlsx")`, a nazwy plików rozjechałyby się przy pierwszej
// zmianie w którymkolwiek z nich.

import { buildCsv, sendCsv, streamCsv } from "./csv";
import { sendXlsx } from "./xlsx";

export const FORMATS = ["csv", "xlsx"];

export const isFormat = (v) => FORMATS.includes(v);

/**
 * @param {import("http").ServerResponse} res
 * @param {object} opts
 * @param {"csv"|"xlsx"} opts.format
 * @param {string} opts.basename nazwa pliku BEZ rozszerzenia — dokłada je format
 * @param {string} opts.sheet nazwa arkusza (ignorowana przy CSV)
 * @param {string[]} opts.header
 * @param {Array<Array<unknown>>} opts.rows
 */
export const sendReport = (res, { format, basename, sheet, header, rows }) =>
  format === "xlsx"
    ? sendXlsx(res, `${basename}.xlsx`, sheet, header, rows)
    : sendCsv(res, `${basename}.csv`, buildCsv(header, rows));

/**
 * To samo dla eksportów bez górnego ograniczenia liczby wierszy: `rows` jest
 * leniwym iteratorem i nie wolno go zmaterializować w pamięci. Po stronie XLSX
 * nie ma osobnej ścieżki — `sendXlsx` i tak pisze strumieniowo.
 */
export const streamReport = (res, { format, basename, sheet, header, rows }) =>
  format === "xlsx"
    ? sendXlsx(res, `${basename}.xlsx`, sheet, header, rows)
    : streamCsv(res, `${basename}.csv`, header, rows);
