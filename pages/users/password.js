import { useRouter } from "next/router";
import AuthLayout from "../../components/authLayout";
import Button from "../../components/ui/button";

export default function PasswordChanged() {
  const router = useRouter();

  return (
    <AuthLayout title="Hasło zmienione" description="Od tej pory logujesz się nowym hasłem.">
      <Button size="lg" onClick={() => router.push("/")}>
        Wróć do aplikacji
      </Button>
    </AuthLayout>
  );
}
