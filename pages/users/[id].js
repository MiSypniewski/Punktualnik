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

export const getServerSideProps = async (context) => {
  const userData = await getUserData(context.params.id);

  return {
    props: {
      userData,
      id: context.params.id,
    },
  };
};

export default function UserData({ userData, id }) {
  const { data: session, status } = useSession();
  const user = { ...userData[0] };
  const router = useRouter();
  const userForm = useRef();
  // const loginForm = useRef();
  const [error, setError] = useState();
  const [formProcessing, setFormProcessing] = useState(false);

  //wywalenie użytkownika o innym ID
  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/");
    }
    if (status === "authenticated" && session.user.userID.toString() !== id) {
      router.push("/");
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
      const payload = await response.json();
      setFormProcessing(false);
      setError(payload.error);
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
