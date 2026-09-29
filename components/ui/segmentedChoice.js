import classNames from "classnames";

// Wybór jednej z kilku widocznych naraz opcji: format pliku przy eksporcie,
// stan karty czasu w panelu korekty. `radiogroup` zamiast zwykłych przycisków,
// żeby czytnik ekranu powiedział, która opcja jest już wybrana.

const optionClass = (active) =>
  classNames(
    "px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors disabled:opacity-50",
    active ? "bg-accent text-accent-ink" : "bg-surface text-muted hover:bg-raised hover:text-body"
  );

/**
 * @param {{value: string, label: string}[]} options
 * @param {string} value
 * @param {(value: string) => void} onChange
 * @param {string} label etykieta grupy dla czytników ekranu
 */
const SegmentedChoice = ({ options, value, onChange, label, disabled, className }) => (
  <div
    role="radiogroup"
    aria-label={label}
    className={classNames(
      "inline-flex rounded border border-line-strong overflow-hidden divide-x divide-line-strong",
      className
    )}
  >
    {options.map((o) => (
      <button
        key={o.value}
        type="button"
        role="radio"
        aria-checked={value === o.value}
        onClick={() => onChange(o.value)}
        disabled={disabled}
        className={optionClass(value === o.value)}
      >
        {o.label}
      </button>
    ))}
  </div>
);

export default SegmentedChoice;
