import Badge from "./ui/badge";
import { statusLabel } from "../services/overtimeKinds";

// Wspólny dla strony pracownika i kierownika, żeby ten sam status nie miał
// dwóch różnych kolorów w dwóch miejscach aplikacji.
const TONES = {
  pending: "signal",
  approved: "ok",
  rejected: "danger",
  cancelled: "neutral",
};

const OvertimeBadge = ({ status }) => <Badge tone={TONES[status] || "neutral"}>{statusLabel(status)}</Badge>;

export default OvertimeBadge;
