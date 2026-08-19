import { useState, useRef } from "react";
import { jsonFetcher } from "../../utils";
import { useRouter } from "next/router";
import BaseLayout from "../../components/baseLayout";
import Button from "../../components/ui/button";
import { Field, Input, Select } from "../../components/ui/field";
import Alert from "../../components/ui/alert";
import PageHeader from "../../components/ui/pageHeader";
import { listSections } from "../../services/sections";

// Lista sekcji jedzie z bazy, nie z kodu — dodanie działu to komenda
// `npm run admin -- section-add <slug> <Etykieta>`, bez builda i bez deployu.
export const getServerSideProps = async () => ({
  props: { sections: listSections() },
});

// Kody błędów z API po ludzku; nieznany kod pokazujemy jak leci.
const ERROR_MESSAGES = {
  email_taken: "Konto z tym adresem e-mail już istnieje.",
  unknown_section: "Wybrany dział nie istnieje. Odśwież stronę i spróbuj ponownie.",
};

export default function CreateUser({ sections }) {
  const userForm = useRef();
  const [error, setError] = useState();
  const [formProcessing, setFormProcessing] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (formProcessing) return;
    setError(null);
    setFormProcessing(true);
    const form = new FormData(userForm.current);
    const payload = {
      email: form.get("email"),
      name: form.get("name"),
      surname: form.get("surname"),
      password: form.get("password"),
      location: form.get("location"),
      section: form.get("section"),
    };

    if (payload.password !== form.get("passwordConfirm")) {
      setError("Hasła się nie zgadzają — wpisz to samo w obu polach.");
      setFormProcessing(false);
      return;
    }

    const response = await fetch("/api/users", {
      method: "POST",
      body: JSON.stringify(payload),
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (response.ok) {
      router.push("/users/comfirm");
    } else {
      const body = await response.json();
      setFormProcessing(false);
      setError(ERROR_MESSAGES[body.error] || body.error);
    }
  };

  return (
    <BaseLayout width="narrow">
      <PageHeader
        title="Nowe konto"
        description="Konto powstaje wyłączone — zanim będzie się dało zalogować, ktoś musi je aktywować."
      />

      <form ref={userForm} onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field label="E-mail" htmlFor="email">
          <Input type="email" id="email" name="email" autoComplete="email" required />
        </Field>

        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Hasło" htmlFor="password">
            <Input type="password" id="password" name="password" autoComplete="new-password" required />
          </Field>
          <Field label="Powtórz hasło" htmlFor="passwordConfirm">
            <Input
              type="password"
              id="passwordConfirm"
              name="passwordConfirm"
              autoComplete="new-password"
              required
            />
          </Field>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Imię" htmlFor="name">
            <Input type="text" id="name" name="name" autoComplete="given-name" required />
          </Field>
          <Field label="Nazwisko" htmlFor="surname">
            <Input type="text" id="surname" name="surname" autoComplete="family-name" required />
          </Field>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <Field
            label="Dział"
            htmlFor="section"
            error={sections.length === 0 ? "Brak zdefiniowanych działów — odezwij się do administratora." : undefined}
          >
            {/* Lista sekcji jedzie z bazy, nie z kodu — patrz getServerSideProps. */}
            <Select name="section" id="section" defaultValue="" required>
              <option value="" disabled>
                — wybierz —
              </option>
              {sections.map(({ slug, label }) => (
                <option key={slug} value={slug}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>

          {/* Adresy są tu wpisane na sztywno — w odróżnieniu od działów nie mają
              własnej tabeli. Nowe miejsce pracy wymaga zmiany w kodzie. */}
          <Field label="Miejsce pracy" htmlFor="location">
            <Select name="location" id="location" defaultValue="" required>
              <option value="" disabled>
                — wybierz —
              </option>
              <option value="gajowa 6">Gajowa 6</option>
              <option value="chlebowa 22">Chlebowa 22</option>
              <option value="chlebowa 26">Chlebowa 26</option>
            </Select>
          </Field>
        </div>

        {error && <Alert tone="danger">Konto nie powstało: {error}</Alert>}

        <Button type="submit" size="lg" disabled={formProcessing} className="self-start mt-1">
          {formProcessing ? "Zakładam…" : "Utwórz konto"}
        </Button>
      </form>
    </BaseLayout>
  );
}
