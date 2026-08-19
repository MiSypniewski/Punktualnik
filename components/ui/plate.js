import classNames from "classnames";

// Płyta — podstawowa powierzchnia aplikacji. Emaliowana tabliczka, nie karta
// z cieniem: włosowa ramka, promień 3 px, cień ledwie obecny (w motywie ciemnym
// żaden, bo tam rolę wypukłości przejmuje ramka).
const TONES = {
  default: "bg-surface border-line",
  raised: "bg-raised border-line",
  // Stan „teraz” — jedyne miejsce, gdzie płyta robi się bursztynowa.
  signal: "bg-signal-soft border-signal/40",
  ok: "bg-ok-soft border-ok/40",
  danger: "bg-danger-soft border-danger/40",
};

export const Plate = ({ tone = "default", className, children, ...rest }) => (
  <div
    className={classNames("border rounded shadow-plate", TONES[tone] || TONES.default, className)}
    {...rest}
  >
    {children}
  </div>
);

/** Pasek nagłówka płyty: tytuł wersalikami po lewej, kontekst po prawej. */
export const PlateHeader = ({ title, aside, className, children }) => (
  <div
    className={classNames(
      "flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-3 py-2 border-b border-line",
      className
    )}
  >
    {title && (
      <h2 className="text-xs font-bold uppercase tracking-signage">{title}</h2>
    )}
    {children}
    {aside && <div className="text-xs text-muted">{aside}</div>}
  </div>
);

export default Plate;
