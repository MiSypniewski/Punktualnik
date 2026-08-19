import classNames from "classnames";

// Jeden komunikat zamiast czterech konwencji błędu, które narosły przez lata
// (czerwona plama na białym tekście, blade tło bez ramki, tło z ramką, wersja
// najstarsza z users/*).
//
// Komunikat mówi, co się stało i co z tym zrobić — nie przeprasza.
const TONES = {
  danger: "bg-danger-soft border-danger/40 text-danger-strong",
  ok: "bg-ok-soft border-ok/40 text-ok-strong",
  warn: "bg-signal-soft border-signal/40 text-signal-strong",
  info: "bg-accent-soft border-line text-body",
};

const Alert = ({ tone = "danger", className, children, ...rest }) => {
  if (!children) return null;

  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={classNames("px-3 py-2 border rounded text-sm", TONES[tone] || TONES.danger, className)}
      {...rest}
    >
      {children}
    </div>
  );
};

export default Alert;
