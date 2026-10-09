import { useState } from "react";
import classNames from "classnames";

// Wykresy raportu miesięcznego — bez biblioteki.
//
// Słupki są zwykłymi blokami HTML o wysokości w procentach, a SVG rysuje tylko
// to, czego blokiem zrobić się nie da (linię i pierścień). Dzięki temu podpisy
// są zwykłym tekstem strony: nie skalują się razem z wykresem, dziedziczą krój
// i oba motywy, a do bundla nie dochodzi nic.
//
// Barwy serii to zmienne --viz-1…8 ze styles/globals.css, przydzielane PO
// KOLEI (seriesColor). Tekst nigdy nie nosi barwy serii — tożsamość niesie
// kwadrat obok podpisu, a legenda z wartościami stoi przy każdym wykresie,
// bo trzy z ośmiu barw mają na jasnym tle kontrast poniżej 3:1.

export const SERIES_COUNT = 8;

/** Barwa serii nr `index` (od 0). Poza paletą — neutralna, jak „pozostałe”. */
export const seriesColor = (index) => (index >= 0 && index < SERIES_COUNT ? `var(--viz-${index + 1})` : OTHER_COLOR);

/** „Pozostałe”, „brak danych” i wszystko, co nie jest serią. */
export const OTHER_COLOR = "rgb(var(--c-line-strong))";

// --- dymek ------------------------------------------------------------------

const useTip = () => {
  const [tip, setTip] = useState(null);

  const bind = (title, lines) => ({
    onMouseEnter: (e) => setTip({ x: e.clientX, y: e.clientY, title, lines }),
    onMouseMove: (e) => setTip({ x: e.clientX, y: e.clientY, title, lines }),
    onMouseLeave: () => setTip(null),
  });

  const node = tip && (
    <div
      role="tooltip"
      className="pointer-events-none fixed z-50 max-w-xs px-2.5 py-1.5 rounded border border-line bg-surface shadow-plate text-xs print:hidden"
      style={{ left: tip.x + 12, top: tip.y + 12 }}
    >
      <p className="font-semibold">{tip.title}</p>
      {tip.lines.map(([color, name, value], i) => (
        <p key={i} className="mt-0.5 flex items-center gap-1.5 text-muted">
          {color && <span className="inline-block w-2 h-2 rounded-sm shrink-0" style={{ background: color }} />}
          <span className="flex-grow">{name}</span>
          <span className="font-mono tabular-nums text-body">{value}</span>
        </p>
      ))}
    </div>
  );

  return [bind, node];
};

// --- oś ---------------------------------------------------------------------

/** Okrągła górna granica osi i podziałka — 4 lub 5 kresek zamiast „37,4”. */
const niceScale = (max) => {
  if (!(max > 0)) return { top: 1, ticks: [0, 1] };
  const rough = max / 4;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= rough);
  const top = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(Math.round(v * 100) / 100);
  return { top, ticks };
};

const Grid = ({ ticks, top, format }) => (
  <>
    {ticks.map((t) => (
      <div
        key={t}
        className="absolute left-0 right-0 border-t border-line-subtle"
        style={{ bottom: `${(t / top) * 100}%` }}
      >
        <span className="absolute -left-1 -translate-x-full -translate-y-1/2 text-[0.625rem] font-mono tabular-nums text-muted">
          {format(t)}
        </span>
      </div>
    ))}
  </>
);

// --- legenda ----------------------------------------------------------------

/** @param {{name: string, color: string, value?: string, dashed?: boolean}[]} items */
export const Legend = ({ items, className }) => (
  <ul className={classNames("flex flex-wrap gap-x-4 gap-y-1 text-xs", className)}>
    {items.map((item) => (
      <li key={item.name} className="flex items-center gap-1.5">
        <span
          aria-hidden="true"
          className={classNames("inline-block shrink-0", item.dashed ? "w-4 border-t-2 border-dashed" : "w-2.5 h-2.5 rounded-sm")}
          style={item.dashed ? { borderColor: item.color } : { background: item.color }}
        />
        <span className="text-muted">{item.name}</span>
        {item.value !== undefined && <span className="font-mono tabular-nums">{item.value}</span>}
      </li>
    ))}
  </ul>
);

// --- słupki -----------------------------------------------------------------

/**
 * Słupki pionowe, pojedyncze albo skumulowane.
 *
 * @param {object} props
 * @param {{label: string, note?: string, noteTone?: string, title?: string, shaded?: boolean,
 *          segments: {name: string, value: number, color: string}[], marker?: number}[]} props.items
 * @param {(v: number) => string} props.format podpis wartości
 * @param {{value: number, label: string}} [props.reference] linia odniesienia (np. norma 8 h)
 * @param {string} [props.markerName] co znaczy kreska `marker` nad słupkiem
 * @param {boolean} [props.showValues] suma nad słupkiem — tylko przy kilku słupkach
 * @param {number} [props.max] wymuszona górna granica osi (wspólna skala kilku wykresów)
 */
export const Columns = ({ items, format, reference, markerName, showValues = false, max, height = 220 }) => {
  const [bind, tip] = useTip();

  const totals = items.map((item) => item.segments.reduce((sum, s) => sum + s.value, 0));
  const peak = Math.max(max || 0, reference?.value || 0, ...totals, ...items.map((i) => i.marker || 0));
  const { top, ticks } = niceScale(peak);
  const dense = items.length > 12;

  return (
    <div className="pl-9">
      <div className="relative" style={{ height }}>
        <Grid ticks={ticks} top={top} format={format} />

        {reference && (
          <div
            className="absolute left-0 right-0 border-t border-dashed border-muted z-10"
            style={{ bottom: `${(reference.value / top) * 100}%` }}
          >
            <span className="absolute right-0 -translate-y-full text-[0.625rem] text-muted bg-surface px-1">
              {reference.label}
            </span>
          </div>
        )}

        <div className={classNames("absolute inset-0 flex items-end", dense ? "gap-px sm:gap-0.5" : "gap-3 sm:gap-6 px-2")}>
          {items.map((item, i) => (
            <div
              key={i}
              className={classNames("relative flex-1 min-w-0 h-full flex flex-col justify-end", item.shaded && "bg-raised/60")}
              {...bind(item.title || item.label, [
                ...item.segments.filter((s) => s.value > 0).map((s) => [s.color, s.name, format(s.value)]),
                ...(item.marker ? [[null, markerName, format(item.marker)]] : []),
              ])}
            >
              {showValues && totals[i] > 0 && (
                <span className="mb-1 text-center text-[0.6875rem] font-mono tabular-nums">{format(totals[i])}</span>
              )}
              {/* Segmenty od dołu; 2 px przerwy w kolorze tła zamiast obrysu. */}
              <div
                className={classNames("mx-auto w-full flex flex-col-reverse gap-0.5", !dense && "max-w-[4.5rem]")}
                style={{ height: `${(totals[i] / top) * 100}%` }}
              >
                {item.segments
                  .filter((s) => s.value > 0)
                  .map((s, j, visible) => (
                    <div
                      key={s.name}
                      className={classNames("w-full min-h-[2px]", j === visible.length - 1 && "rounded-t-sm")}
                      style={{ flexGrow: s.value, flexBasis: 0, background: s.color }}
                    />
                  ))}
              </div>
              {item.marker > 0 && (
                <div
                  className="absolute left-0 right-0 mx-auto w-full border-t-2 border-body"
                  style={{ bottom: `${(item.marker / top) * 100}%`, maxWidth: dense ? undefined : "4.5rem" }}
                />
              )}
            </div>
          ))}
        </div>
      </div>

      <div className={classNames("flex border-t border-line", dense ? "gap-px sm:gap-0.5" : "gap-3 sm:gap-6 px-2")}>
        {items.map((item, i) => (
          <div key={i} className="flex-1 min-w-0 pt-1 text-center">
            <p className={classNames("truncate text-muted", dense ? "text-[0.625rem] font-mono" : "text-xs")}>{item.label}</p>
            {item.note && (
              <p
                className={classNames(
                  "text-[0.5625rem] font-semibold leading-tight truncate",
                  item.noteTone === "danger" ? "text-danger-strong" : "text-muted"
                )}
              >
                {item.note}
              </p>
            )}
          </div>
        ))}
      </div>
      {tip}
    </div>
  );
};

// --- linie ------------------------------------------------------------------

/**
 * Kilka serii na wspólnej osi. Linię rysuje SVG rozciągnięte na cały obszar
 * (grubość kreski nie skaluje się — vector-effect), punkty i podpisy są HTML-em.
 *
 * @param {string[]} labels
 * @param {{name: string, color: string, dashed?: boolean, values: (number|null)[]}[]} series
 */
export const Lines = ({ labels, series, format, height = 220 }) => {
  const [bind, tip] = useTip();

  const all = series.flatMap((s) => s.values).filter((v) => v !== null && v !== undefined);
  const { top, ticks } = niceScale(Math.max(0, ...all));
  // Punkty stoją na środkach kolumn, jak słupki obok — osie obu wykresów się zgadzają.
  const x = (i) => ((i + 0.5) / labels.length) * 100;
  const y = (v) => 100 - (v / top) * 100;

  return (
    <div className="pl-9">
      <div className="relative" style={{ height }}>
        <Grid ticks={ticks} top={top} format={format} />

        <svg className="absolute inset-0 w-full h-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none">
          {series.map((s) => (
            <polyline
              key={s.name}
              fill="none"
              stroke={s.color}
              strokeWidth="2"
              strokeDasharray={s.dashed ? "6 4" : undefined}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              points={s.values
                .map((v, i) => (v === null || v === undefined ? null : `${x(i)},${y(v)}`))
                .filter(Boolean)
                .join(" ")}
            />
          ))}
        </svg>

        {series.map((s) =>
          s.values.map((v, i) =>
            v === null || v === undefined ? null : (
              <span
                key={`${s.name}-${i}`}
                className="absolute w-2.5 h-2.5 -ml-[5px] -mt-[5px] rounded-full ring-2 ring-surface"
                style={{ left: `${x(i)}%`, top: `${y(v)}%`, background: s.color }}
              />
            )
          )
        )}

        {/* Pole najechania większe od punktu: cała kolumna miesiąca. */}
        <div className="absolute inset-0 flex">
          {labels.map((label, i) => (
            <div
              key={label}
              className="flex-1 hover:bg-raised/40"
              {...bind(
                label,
                series.filter((s) => s.values[i] !== null && s.values[i] !== undefined).map((s) => [s.color, s.name, format(s.values[i])])
              )}
            />
          ))}
        </div>
      </div>

      <div className="flex border-t border-line">
        {labels.map((label) => (
          <p key={label} className="flex-1 min-w-0 pt-1 text-center text-xs text-muted truncate">
            {label}
          </p>
        ))}
      </div>
      {tip}
    </div>
  );
};

// --- pierścień --------------------------------------------------------------

/**
 * Pierścień udziałów z liczbą w środku. Segmenty to łuki jednego okręgu
 * (pathLength = 100, więc długości są wprost procentami); przerwa między nimi
 * to brak kreski, przez który widać tło.
 *
 * @param {{name: string, value: number, color: string}[]} segments
 * @param {(v: number) => string} format
 */
export const Donut = ({ segments, format, value, label, size = 148 }) => {
  const [bind, tip] = useTip();

  const visible = segments.filter((s) => s.value > 0);
  const total = visible.reduce((sum, s) => sum + s.value, 0);
  const GAP = visible.length > 1 ? 0.8 : 0;
  let offset = 0;

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 42 42" className="w-full h-full -rotate-90">
        <circle cx="21" cy="21" r="15.9155" fill="none" stroke="rgb(var(--c-raised))" strokeWidth="6" />
        {visible.map((s) => {
          const length = (s.value / total) * 100;
          const arc = (
            <circle
              key={s.name}
              cx="21"
              cy="21"
              r="15.9155"
              fill="none"
              stroke={s.color}
              strokeWidth="6"
              pathLength="100"
              strokeDasharray={`${Math.max(0.5, length - GAP)} ${100 - Math.max(0.5, length - GAP)}`}
              strokeDashoffset={-offset}
              {...bind(s.name, [[s.color, `${Math.round(length)}%`, format(s.value)]])}
            />
          );
          offset += length;
          return arc;
        })}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="font-mono text-base font-medium tabular-nums leading-none">{value}</span>
        {label && <span className="mt-1 text-[0.625rem] uppercase tracking-signage text-muted">{label}</span>}
      </div>
      {tip}
    </div>
  );
};

// --- pasek poziomy ----------------------------------------------------------

/** Jeden pasek udziału (0–100%) z podpisem po lewej i wartością po prawej. */
export const ShareBar = ({ name, value, percent, color, mark }) => (
  <div className="grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 text-sm">
    <span className="flex items-center gap-2 min-w-0">
      {mark}
      <span className="truncate">{name}</span>
    </span>
    <span className="hidden sm:block h-2 rounded-sm bg-raised overflow-hidden">
      <span className="block h-2 rounded-sm" style={{ width: `${Math.max(1, percent)}%`, background: color }} />
    </span>
    <span className="font-mono tabular-nums text-right whitespace-nowrap">{value}</span>
  </div>
);
