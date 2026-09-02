import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import { signIn } from "next-auth/react";
import AuthLayout from "../../components/authLayout";
import Button from "../../components/ui/button";
import { Field, Input } from "../../components/ui/field";
import Alert from "../../components/ui/alert";

// Kody błędów, którymi next-auth przekierowuje na tę stronę (pages.error
// w pages/api/auth/[...nextauth].js). Wcześniej użytkownik widział je na surowej
// stronie /api/auth/error jako jedno angielskie słowo "Error".
const ERROR_MESSAGES = {
  // CredentialsSignin celowo NIE ma tu własnego wpisu — authorize() zwraca null
  // tak samo przy złym haśle, jak i przy koncie czekającym na aktywację, więc
  // komunikat musi wspominać o obu (patrz DEFAULT_FAILURE niżej).
  SessionRequired: "Ta strona wymaga zalogowania.",
  // Rzucane przez services/authorizeUser.js, gdy nie udało się odczytać konta
  // z bazy. Hasło użytkownika może być poprawne — problem jest po naszej stronie.
  server_error: "Serwer chwilowo nie odpowiada. Odczekaj chwilę i spróbuj ponownie.",
  // Rzucane przez services/loginRateLimit.js po serii nieudanych prób.
  //
  // Komunikat jest ODRĘBNY świadomie i NIE jest wyrocznią enumeracyjną — pod
  // jednym warunkiem, który musi zostać spełniony w limiterze: porażki dla
  // adresów NIEISTNIEJĄCYCH lądują w tym samym kubełku co dla istniejących.
  // Wtedy to zdanie mówi wyłącznie "ten adres był ostatnio wielokrotnie
  // próbowany", czyli powtarza atakującemu jego własne działanie. Gdyby ktoś
  // kiedyś przestał liczyć te porażki, komunikat natychmiast zacznie zdradzać,
  // które konta istnieją.
  //
  // Za odrębnym zdaniem przemawia koszt obsługi: bez niego pracownik, który
  // pomylił hasło pięć razy, przez kwadrans widzi "niepoprawny e-mail lub hasło"
  // mimo wpisywania poprawnego — i dzwoni do kierownika, że aplikacja jest zepsuta.
  too_many_attempts: "Za dużo nieudanych prób logowania. Odczekaj 15 minut i spróbuj ponownie.",
  // Configuration to najczęściej rozjechany NEXTAUTH_URL albo brak NEXTAUTH_SECRET
  // na serwerze — użytkownik nie ma jak tego naprawić, ale musi wiedzieć, że to
  // nie jego wina i że warto to komuś zgłosić.
  Configuration: "Błąd konfiguracji logowania po stronie serwera. Zgłoś to kierownikowi.",
  AccessDenied: "Brak dostępu do tego konta.",
  Verification: "Link wygasł lub został już użyty.",
};

const DEFAULT_FAILURE =
  "Niepoprawny e-mail lub hasło. Konto może też czekać na aktywację — wtedy odezwij się do kierownika.";

export default function LogIn() {
  const loginForm = useRef();
  const [error, setError] = useState();
  const [formProcessing, setFormProcessing] = useState(false);
  const router = useRouter();

  // Błąd przekazany w adresie przez next-auth (przekierowanie z pages.error).
  useEffect(() => {
    const code = router.query.error;
    if (!code) return;
    setError(ERROR_MESSAGES[code] || DEFAULT_FAILURE);
  }, [router.query.error]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (formProcessing) return;
    setError(null);
    setFormProcessing(true);
    const form = new FormData(loginForm.current);

    // try/catch nie jest ozdobą: gdy serwer nie odpowiada (a 21.08.2026 nie
    // odpowiadał), signIn rzuca wyjątkiem. Bez tego obsługa kończyła się cicho
    // na nieobsłużonym odrzuceniu, formularz zostawał na zawsze w stanie
    // "Sprawdzam…", a użytkownik nie widział ŻADNEGO komunikatu.
    try {
      const result = await signIn("credentials", {
        redirect: false,
        email: form.get("email"),
        password: form.get("password"),
      });

      if (result?.ok) {
        router.push("/");
        return;
      }
      setError(ERROR_MESSAGES[result?.error] || DEFAULT_FAILURE);
    } catch {
      setError("Serwer nie odpowiada. Odczekaj chwilę i spróbuj ponownie.");
    }
    setFormProcessing(false);
  };

  return (
    <AuthLayout title="Logowanie" description="Ewidencja czasu pracy, nadgodzin i zadań.">
      <form ref={loginForm} onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field label="E-mail" htmlFor="email">
          <Input type="email" id="email" name="email" autoComplete="username" required />
        </Field>

        <Field label="Hasło" htmlFor="password">
          <Input type="password" id="password" name="password" autoComplete="current-password" required />
        </Field>

        {error && <Alert tone="danger">{error}</Alert>}

        <Button type="submit" size="lg" disabled={formProcessing} className="mt-1">
          {formProcessing ? "Sprawdzam…" : "Zaloguj się"}
        </Button>
      </form>
    </AuthLayout>
  );
}
