import BaseLayout from "../components/baseLayout";
import Spinner from "../components/spinner";
import { useSession } from "next-auth/react";
import { useRouter } from "next/router";
import { useEffect } from "react";

// Ekran przejściowy: po zalogowaniu każdy trafia na tablicę kafelków swojej
// sekcji. Sam w sobie nic nie pokazuje — stąd tylko wskaźnik oczekiwania.
export default function Home() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "authenticated") {
      router.push(`/time/${session.user.section}`);
    }
  }, [session, status]);

  return (
    <BaseLayout>
      <Spinner label="Przechodzę do twojej sekcji" />
    </BaseLayout>
  );
}
