import classNames from "classnames";

// Mapowanie klucz koloru → gotowe klasy Tailwinda.
//
// Ten plik MUSI leżeć w components/, a klasy MUSZĄ być zapisane w całości.
// Tailwind skanuje tylko pages/ i components/ (tailwind.config.js) i wycina
// wszystko, czego nie zobaczy dosłownie w źródle — `bg-${color}-100` nie
// zadziała, bo taki string nigdy nie pada w kodzie. Stąd pełne nazwy klas
// zamiast składania ich z kawałków.
//
// Klucze muszą się zgadzać z PROJECT_COLOR_KEYS w services/projects.js — siedzą
// w bazie i są walidowane po stronie serwera, więc wolno zmieniać odcienie,
// nie wolno nazw.
//
// Znacznik projektu jest KWADRATEM, a nie kółkiem, i to jest rozróżnienie
// niosące znaczenie: okrągły pulsujący punkt (components/liveDot.js) zawsze
// znaczy „to leci teraz”. Bez tego projekt o kolorze `amber` udawałby stan
// „na żywo”, bo bursztyn jest w tym systemie kolorem sygnału.
const PALETTE = {
  indigo: { chip: "bg-indigo-100 dark:bg-indigo-500/20 text-indigo-800 dark:text-indigo-200", mark: "bg-indigo-500", bar: "bg-indigo-500" },
  emerald: { chip: "bg-emerald-100 dark:bg-emerald-500/20 text-emerald-800 dark:text-emerald-200", mark: "bg-emerald-500", bar: "bg-emerald-500" },
  amber: { chip: "bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-200", mark: "bg-amber-500", bar: "bg-amber-500" },
  rose: { chip: "bg-rose-100 dark:bg-rose-500/20 text-rose-800 dark:text-rose-200", mark: "bg-rose-500", bar: "bg-rose-500" },
  sky: { chip: "bg-sky-100 dark:bg-sky-500/20 text-sky-800 dark:text-sky-200", mark: "bg-sky-500", bar: "bg-sky-500" },
  violet: { chip: "bg-violet-100 dark:bg-violet-500/20 text-violet-800 dark:text-violet-200", mark: "bg-violet-500", bar: "bg-violet-500" },
  slate: { chip: "bg-slate-200 dark:bg-slate-500/25 text-slate-800 dark:text-slate-200", mark: "bg-slate-500", bar: "bg-slate-500" },
};

const FALLBACK = PALETTE.slate;

/** @returns {{chip: string, mark: string, bar: string}} */
export const projectColor = (key) => PALETTE[key] || FALLBACK;

export const COLOR_KEYS = Object.keys(PALETTE);

const SIZES = { sm: "w-2 h-2", md: "w-2.5 h-2.5", lg: "w-3.5 h-3.5" };

// Wpis bez projektu (timer wystartowany jednym kliknięciem) dostaje kwadrat
// PUSTY, a nie szary. Bez tego wyglądałby identycznie jak projekt w kolorze
// `slate`, bo projectColor() zwraca dla nieznanego klucza FALLBACK — czyli
// właśnie slate. Kontur czyta się jako „miejsce jeszcze niewypełnione”.
const EMPTY_MARK = "border border-dashed border-line-strong bg-transparent";

/** Kwadratowy znacznik koloru projektu — w listach wpisów, tabelach raportów
 *  i przy wyborze projektu. `color` puste znaczy „bez projektu”. */
export const ProjectMark = ({ color, size = "md", className }) => (
  <span
    aria-hidden="true"
    className={classNames(
      "inline-block rounded-sm shrink-0",
      SIZES[size] || SIZES.md,
      color ? projectColor(color).mark : EMPTY_MARK,
      className
    )}
  />
);

export default projectColor;
