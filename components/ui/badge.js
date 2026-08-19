import classNames from "classnames";

// Chip statusu. Ten sam status ma mieć ten sam kolor w każdym miejscu
// aplikacji — stąd jeden komponent zamiast klas dopisywanych na stronach.
const TONES = {
  neutral: "bg-raised text-muted",
  accent: "bg-accent-soft text-accent-strong",
  signal: "bg-signal-soft text-signal-strong",
  ok: "bg-ok-soft text-ok-strong",
  danger: "bg-danger-soft text-danger-strong",
};

const Badge = ({ tone = "neutral", className, children }) => (
  <span
    className={classNames(
      "inline-block px-2 py-0.5 rounded-sm text-xs font-semibold uppercase tracking-signage whitespace-nowrap",
      TONES[tone] || TONES.neutral,
      className
    )}
  >
    {children}
  </span>
);

export default Badge;
