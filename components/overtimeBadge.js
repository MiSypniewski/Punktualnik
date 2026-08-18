import classNames from "classnames";
import { statusLabel } from "../services/overtimeKinds";

// Wspólny dla strony pracownika i kierownika, żeby ten sam status nie miał
// dwóch różnych kolorów w dwóch miejscach aplikacji.
const OvertimeBadge = ({ status }) => {
  const className = classNames("inline-block px-2 py-1 rounded text-xs font-semibold whitespace-nowrap", {
    "bg-yellow-200 text-yellow-900": status === "pending",
    "bg-green-200 text-green-900": status === "approved",
    "bg-red-200 text-red-900": status === "rejected",
    "bg-raised text-body": status === "cancelled",
  });

  return <span className={className}>{statusLabel(status)}</span>;
};

export default OvertimeBadge;
