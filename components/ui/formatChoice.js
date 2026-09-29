import classNames from "classnames";
import SegmentedChoice from "./segmentedChoice";

// Wybór formatu pliku dla eksportów: jeden przełącznik na stronę zamiast
// podwajania przycisków pobierania. Na /zadania/zarzadzaj eksporty są trzy —
// dwa formaty razy trzy tryby to sześć przycisków obok siebie i ekran, na
// którym nie widać już, co jest czym.
//
// Świadomie NIE jest to <Select>: opcje są dwie i obie mają się widzieć bez
// rozwijania listy. Świadomie też nie dwa zwykłe przyciski — bez `radiogroup`
// czytnik ekranu przeczytałby „CSV, przycisk. Excel, przycisk” i nic nie
// powiedziałby o tym, że jedno z nich jest już wybrane.

const OPTIONS = [
  { value: "csv", label: "CSV" },
  { value: "xlsx", label: "Excel" },
];

/**
 * @param {"csv"|"xlsx"} value
 * @param {(format: "csv"|"xlsx") => void} onChange
 */
const FormatChoice = ({ value, onChange, className }) => (
  <div className={classNames("flex items-center gap-2", className)}>
    <span className="text-xs font-semibold uppercase tracking-signage text-muted">Format</span>
    <SegmentedChoice options={OPTIONS} value={value} onChange={onChange} label="Format pliku" />
  </div>
);

export default FormatChoice;
