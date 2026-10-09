import useSWR from "swr";
import TabNav from "./ui/tabNav";
import { fetchLive, PENDING_KEY, PENDING_POLL_MS } from "../utils/live";

// Zakładki pozycji „Wnioski”: Urlopy | Nadgodziny.
//
// Jedna lista w jednym pliku — oba panele (pages/urlopy/zarzadzaj.js
// i pages/nadgodziny/zarzadzaj.js) renderują ten sam komponent, więc kolejność
// i nazwy nie mają jak się rozjechać.
//
// Liczniki idą z TEGO SAMEGO klucza SWR co licznik w pasku stacyjnym
// (components/stationRail.js). SWR dedupikuje po kluczu, więc to dalej jedno
// zapytanie na cykl, a pasek i zakładki nie mogą pokazać dwóch różnych liczb.
const RequestTabs = ({ className = "mb-6" }) => {
  const { data } = useSWR(PENDING_KEY, fetchLive, { refreshInterval: PENDING_POLL_MS });

  return (
    <TabNav
      label="Rodzaj wniosków"
      className={className}
      items={[
        { href: "/urlopy/zarzadzaj", label: "Urlopy", count: data?.absences },
        { href: "/nadgodziny/zarzadzaj", label: "Nadgodziny", count: data?.overtime },
      ]}
    />
  );
};

export default RequestTabs;
