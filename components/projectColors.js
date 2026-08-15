// Mapowanie klucz koloru → gotowe klasy Tailwinda.
//
// Ten plik MUSI leżeć w components/, a klasy MUSZĄ być zapisane w całości.
// Tailwind skanuje tylko pages/ i components/ (tailwind.config.js) i wycina
// wszystko, czego nie zobaczy dosłownie w źródle — `bg-${color}-100` nie
// zadziała, bo taki string nigdy nie pada w kodzie. Stąd pełne nazwy klas
// zamiast składania ich z kawałków.
//
// Klucze muszą się zgadzać z PROJECT_COLOR_KEYS w services/projects.js.

const PALETTE = {
  indigo: { chip: "bg-indigo-100 text-indigo-800", dot: "bg-indigo-500", bar: "bg-indigo-500" },
  emerald: { chip: "bg-emerald-100 text-emerald-800", dot: "bg-emerald-500", bar: "bg-emerald-500" },
  amber: { chip: "bg-amber-100 text-amber-800", dot: "bg-amber-500", bar: "bg-amber-500" },
  rose: { chip: "bg-rose-100 text-rose-800", dot: "bg-rose-500", bar: "bg-rose-500" },
  sky: { chip: "bg-sky-100 text-sky-800", dot: "bg-sky-500", bar: "bg-sky-500" },
  violet: { chip: "bg-violet-100 text-violet-800", dot: "bg-violet-500", bar: "bg-violet-500" },
  slate: { chip: "bg-slate-100 text-slate-800", dot: "bg-slate-500", bar: "bg-slate-500" },
};

const FALLBACK = PALETTE.slate;

/** @returns {{chip: string, dot: string, bar: string}} */
export const projectColor = (key) => PALETTE[key] || FALLBACK;

export const COLOR_KEYS = Object.keys(PALETTE);

/** Kropka z kolorem projektu — używana w listach wpisów i w tabelach raportów. */
export const ProjectDot = ({ color }) => (
  <span className={`inline-block w-2.5 h-2.5 rounded-full mr-2 shrink-0 ${projectColor(color).dot}`} />
);

export default projectColor;
