import Badge from "./ui/badge";
import { absenceStatusLabel } from "../services/absenceKinds";

// Wspólny dla strony pracownika i kierownika, żeby ten sam status nie miał
// dwóch różnych kolorów w dwóch miejscach aplikacji. Te same tony co przy
// nadgodzinach (components/overtimeBadge.js) — obieg jest ten sam, więc kolor
// „oczekuje” ma znaczyć to samo w obu modułach.
const TONES = {
  pending: "signal",
  approved: "ok",
  rejected: "danger",
  cancelled: "neutral",
};

const AbsenceBadge = ({ status }) => (
  <Badge tone={TONES[status] || "neutral"}>{absenceStatusLabel(status)}</Badge>
);

export default AbsenceBadge;
