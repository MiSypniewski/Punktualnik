import { useRouter } from "next/router";
import AuthLayout from "../../components/authLayout";
import Button from "../../components/ui/button";

// Nazwa pliku z literówką („comfirm”) zostaje: to adres, pod który trafia
// przeglądarka po rejestracji, i zmiana zerwałaby linki w mailach oraz
// zakładkach. Poprawiać ją warto razem z resztą tras, nie przy okazji wyglądu.
export default function Comfirm() {
  const router = useRouter();

  return (
    <AuthLayout
      title="Konto utworzone"
      description="Zanim się zalogujesz, ktoś musi je aktywować — konta włącza kierownik albo administrator."
    >
      <Button size="lg" onClick={() => router.push("/users/signin")}>
        Wróć do logowania
      </Button>
    </AuthLayout>
  );
}
