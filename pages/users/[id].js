import { getToken } from "next-auth/jwt";
import getUserData from "../../services/getUserData";
import BaseLayout from "../../components/baseLayout";
import Spinner from "../../components/spinner";
import Button from "../../components/ui/button";
import { Field, Input } from "../../components/ui/field";
import Alert from "../../components/ui/alert";
import PageHeader from "../../components/ui/pageHeader";
import { useSession } from "next-auth/react";
import { useRouter } from "next/router";
import { useEffect, useRef, useState } from "react";
import dayjs from "dayjs";
import "dayjs/locale/pl";
dayjs.locale("pl");

// Kontrola po stronie serwera. Wcześniej `getUserData` szło do bazy PRZED
// jakimkolwiek sprawdzeniem sesji, więc dane konta (imię, nazwisko, e-mail,
// dział, rola) trafiały do propsów każdemu, kto wpisał adres — także osobie
// niezalogowanej. Sprawdzenie w `useEffect` przekierowywało dopiero
// w przeglądarce, czyli PO wysłaniu danych.
export const getServerSideProps = async (context) => {
  const token = await getToken({ req: context.req });
  if (!token) {
    return { redirect: { destination: "/users/signin", permanent: false } };
  }

  // Cudzy profil to 404, a nie 403: odpowiedź „brak uprawnień” potwierdzałaby,
  // że konto o tym identyfikatorze istnieje.
  if (String(token.userID) !== String(context.params.id)) {
    return { notFound: true };
  }

  const userData = await getUserData(context.params.id);
  if (userData.length === 0) {
    return { notFound: true };
  }

  return {
    props: {
      userData,
      id: context.params.id,
    },
  };
};

// Kody błędów z API po ludzku; nieznany kod pokazujemy jak leci.
const ERROR_MESSAGES = {
  wrong_old_password: "Stare hasło się nie zgadza.",
  user_not_found: "Nie znaleziono konta. Zaloguj się ponownie.",
};

export default function UserData({ userData, id }) {
  const { data: session, status } = useSession();
  const user = { ...userData[0] };
  const router = useRouter();
  const userForm = useRef();
  // const loginForm = useRef();
  const [error, setError] = useState();
  const [formProcessing, setFormProcessing] = useState(false);

  // Cudzy profil odcina już getServerSideProps. Tutaj zostaje wyłącznie
  // przypadek sesji, która wygasła, kiedy strona była otwarta.
  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/users/signin");
    }
  }, [session, status]);

  const handleSubmit = async (e) => {
    // console.log(`session:`, session.user.id);
    e.preventDefault();
    if (formProcessing) return;
    setError(null);
    setFormProcessing(true);
    const form = new FormData(userForm.current);
    const payload = {
      userID: user.ID,
      oldPassword: form.get("oldPassword"),
      newPassword: form.get("newPassword"),
    };

    if (form.get("passwordConfirm").toLowerCase() === "potwierdzam") {
      setError("Śmieszek 😂😂😂");
      setFormProcessing(false);
      return;
    }

    if (payload.newPassword !== form.get("passwordConfirm")) {
      setError("Hasła się nie zgadzają!");
      setFormProcessing(false);
      return;
    }

    const response = await fetch("/api/users", {
      method: "PUT",
      body: JSON.stringify(payload),
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (response.ok) {
      router.push("/users/password");
    } else {
      const body = await response.json();
      setFormProcessing(false);
      setError(ERROR_MESSAGES[body.error] || body.error);
    }
  };

  if (status !== "authenticated") {
    // console.log(`loading`);
    return <Spinner />;
  }

  return (
    <BaseLayout width="narrow">
      <PageHeader
        title={`${user.name} ${user.surname}`}
        description={`${user.email} · dział: ${user.section}`}
      />

      <h2 className="mb-4 text-sm font-bold uppercase tracking-signage">Zmiana hasła</h2>

      <form ref={userForm} onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field label="Stare hasło" htmlFor="oldPassword">
          <Input
            type="password"
            id="oldPassword"
            name="oldPassword"
            autoComplete="current-password"
            required
          />
        </Field>
        <Field label="Nowe hasło" htmlFor="newPassword">
          <Input type="password" id="newPassword" name="newPassword" autoComplete="new-password" required />
        </Field>
        <Field label="Potwierdź nowe hasło" htmlFor="passwordConfirm">
          <Input
            type="password"
            id="passwordConfirm"
            name="passwordConfirm"
            autoComplete="new-password"
            required
          />
        </Field>

        {error && <Alert tone="danger">{error}</Alert>}

        <Button type="submit" size="lg" disabled={formProcessing} className="self-start mt-1">
          {formProcessing ? "Zmieniam…" : "Zmień hasło"}
        </Button>
      </form>
    </BaseLayout>
  );
}
