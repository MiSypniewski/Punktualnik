import classNames from "classnames";

// Pulsujący punkt sygnału — jedyna animacja w aplikacji. Znaczy dokładnie jedno:
// „to leci teraz”. Ruch wyłącza globalna reguła prefers-reduced-motion
// w styles/globals.css; sam punkt zostaje widoczny, bo niesie treść.
const LiveDot = ({ className, size = "sm" }) => (
  <span
    aria-hidden="true"
    className={classNames(
      "inline-block shrink-0 rounded-full bg-signal animate-signal-pulse",
      size === "lg" ? "w-3 h-3" : "w-2 h-2",
      className
    )}
  />
);

export default LiveDot;
