import classNames from "classnames";

// Kafel liczby w duchu tablicy: drobna etykieta wersalikami nad wielką liczbą
// w monospace. Liczba jest tu treścią, etykieta tylko podpisem.
const TONES = {
  default: "border-line bg-surface",
  signal: "border-signal/40 bg-signal-soft",
  ok: "border-ok/40 bg-ok-soft",
  danger: "border-danger/40 bg-danger-soft",
};

const Stat = ({ label, value, hint, tone = "default", className }) => (
  <div className={classNames("px-3 py-2.5 border rounded", TONES[tone] || TONES.default, className)}>
    <p className="text-[0.6875rem] font-semibold uppercase tracking-signage text-muted">{label}</p>
    <p className="mt-1 font-mono text-xl font-medium tabular-nums leading-tight">{value}</p>
    {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
  </div>
);

export default Stat;
