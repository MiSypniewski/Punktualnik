import classNames from "classnames";
import { statusLabel } from "../services/overtimeKinds";

// Wspólny dla strony pracownika i kierownika, żeby ten sam status nie miał
// dwóch różnych kolorów w dwóch miejscach aplikacji.
const OvertimeBadge = ({ status }) => {
  const className = classNames("inline-block px-2 py-1 rounded text-xs font-semibold whitespace-nowrap", {
    "bg-yellow-200 dark:bg-yellow-500/25 text-yellow-900 dark:text-yellow-300": status === "pending",
    "bg-green-200 dark:bg-green-500/25 text-green-900 dark:text-green-300": status === "approved",
    "bg-red-200 dark:bg-red-500/25 text-red-900 dark:text-red-300": status === "rejected",
    "bg-raised text-body": status === "cancelled",
  });

  return <span className={className}>{statusLabel(status)}</span>;
};

export default OvertimeBadge;
