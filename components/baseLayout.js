import { useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/router";
import AppShell from "./appShell";
import Spinner from "./spinner";
import TimerTitle from "./timerTitle";
import { canTrackTasks } from "../services/roles";

// Strażnik sesji. Cały wygląd powłoki (pasek, kontener, stopka) siedzi
// w components/appShell.js — tutaj zostaje wyłącznie pytanie „czy wolno wejść”.
//
// `width` przekazuje strona: "narrow" dla formularzy, "wide" dla raportów,
// "full" dla kiosku, domyślnie "page".
export default function BaseLayout({ children, width }) {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/users/signin");
    }
  }, [session, status]);

  if (status === "loading") {
    return <Spinner label="Ładowanie" />;
  }

  if (session === null && status === "unauthenticated") {
    return <Spinner label="Przekierowanie" />;
  }

  return (
    <>
      {/* Timer w pasku karty przeglądarki na KAŻDEJ stronie — stąd tutaj, a nie
          na /zadania. Kiosk (`editor`) nie raportuje zadań, więc nie ma własnego
          timera i nie ma po co odpytywać serwera. */}
      {canTrackTasks(session.user.role) && <TimerTitle />}
      <AppShell user={session.user} width={width}>
        {children}
      </AppShell>
    </>
  );
}
