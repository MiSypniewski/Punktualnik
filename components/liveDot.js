import classNames from "classnames";

// Pulsujący punkt sygnału — jedyna animacja w aplikacji. Znaczy dokładnie jedno:
// „to leci teraz”. Ruch wyłącza globalna reguła prefers-reduced-motion
// w styles/globals.css; sam punkt zostaje widoczny, bo niesie treść.
// `tone="current"` bierze kolor z otoczenia — potrzebne tam, gdzie punkt leży
// na bursztynowej płycie i sam bursztyn byłby niewidoczny.
const TONES = { signal: "bg-signal", current: "bg-current" };

const LiveDot = ({ className, size = "sm", tone = "signal" }) => (
  <span
    aria-hidden="true"
    className={classNames(
      "inline-block shrink-0 rounded-full animate-signal-pulse",
      TONES[tone] || TONES.signal,
      size === "lg" ? "w-3 h-3" : "w-2 h-2",
      className
    )}
  />
);

export default LiveDot;
