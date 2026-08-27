import classNames from "classnames";

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

const optionClass = (active) =>
  classNames(
    "px-3 py-1.5 text-sm font-medium transition-colors",
    active ? "bg-accent text-accent-ink" : "bg-surface text-muted hover:bg-raised hover:text-body"
  );

/**
 * @param {"csv"|"xlsx"} value
 * @param {(format: "csv"|"xlsx") => void} onChange
 */
const FormatChoice = ({ value, onChange, className }) => (
  <div className={classNames("flex items-center gap-2", className)}>
    <span className="text-xs font-semibold uppercase tracking-signage text-muted">Format</span>
    <div
      role="radiogroup"
      aria-label="Format pliku"
      className="inline-flex rounded border border-line-strong overflow-hidden divide-x divide-line-strong"
    >
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={optionClass(value === o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  </div>
);

export default FormatChoice;
