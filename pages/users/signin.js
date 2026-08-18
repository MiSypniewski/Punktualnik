import { useRef, useState } from "react";
import { useRouter } from "next/router";
import { signIn } from "next-auth/react";
import AuthLayout from "../../components/authLayout";
import Button from "../../components/ui/button";
import { Field, Input } from "../../components/ui/field";
import Alert from "../../components/ui/alert";

export default function LogIn() {
  const loginForm = useRef();
  const [error, setError] = useState();
  const [formProcessing, setFormProcessing] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (formProcessing) return;
    setError(null);
    setFormProcessing(true);
    const form = new FormData(loginForm.current);
    const { ok } = await signIn("credentials", {
      redirect: false,
      email: form.get("email"),
      password: form.get("password"),
    });

    if (ok) {
      router.push("/");
    } else {
      setError("Niepoprawny e-mail lub hasło. Konto może też czekać na aktywację — wtedy odezwij się do kierownika.");
      setFormProcessing(false);
    }
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
