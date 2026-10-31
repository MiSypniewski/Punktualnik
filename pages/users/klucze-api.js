import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import BaseLayout from "../../components/baseLayout";
import Alert from "../../components/ui/alert";
import Badge from "../../components/ui/badge";
import Button from "../../components/ui/button";
import { Checkbox, Field, Input, Select } from "../../components/ui/field";
import PageHeader from "../../components/ui/pageHeader";
import { getActiveToken } from "../../services/session";
import { canTrackTasks } from "../../services/roles";
import { API_KEY_DAYS, API_KEY_DEFAULT_DAYS, API_SCOPE_LABEL, API_SCOPES } from "../../utils/apiScopes";

// Klucze API właściciela konta. Kiosk tu nie wejdzie: jego konto jest współdzielone,
// a klucz musi mieć jednego właściciela.
export const getServerSideProps = async (context) => {
  const token = await getActiveToken(context.req);
  if (!token) {
    return { redirect: { destination: "/users/signin", permanent: false } };
  }
  if (!canTrackTasks(token.role)) {
    return { notFound: true };
  }
  return { props: {} };
};

const fetchKeys = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error("load_failed");
  return response.json();
};

const ERROR_MESSAGES = {
  wrong_password: "Hasło się nie zgadza.",
  too_many_attempts: "Za dużo nieudanych prób. Spróbuj ponownie za kwadrans.",
};

const STATUS = {
  active: { label: "aktywny", tone: "ok" },
  revoked: { label: "odwołany", tone: "neutral" },
  expired: { label: "wygasł", tone: "neutral" },
  invalidated: { label: "unieważniony", tone: "neutral" },
};

const day = (stamp) => (stamp ? String(stamp).slice(0, 10) : "");
const minute = (stamp) => (stamp ? String(stamp).slice(0, 16) : "jeszcze nie");

const NewKeyNotice = ({ token, onClose }) => {
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
    } catch {
      // Schowek działa tylko na https. Klucz da się wtedy zaznaczyć i skopiować ręcznie.
      setCopied(false);
    }
  };

  return (
    <div className="mb-8 p-4 border border-signal/40 rounded bg-signal-soft">
      <p className="font-medium">Skopiuj klucz teraz. Później nie będzie można go odczytać.</p>
      <code data-testid="new-api-key" className="block mt-3 p-2 rounded bg-surface font-mono text-sm break-all select-all">
        {token}
      </code>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" onClick={copy}>
          {copied ? "Skopiowano" : "Kopiuj"}
        </Button>
        <Button size="sm" variant="secondary" onClick={onClose}>
          Klucz zapisany
        </Button>
      </div>
      <p className="mt-4 text-sm text-muted">Sprawdzenie, czy działa:</p>
      <code className="block mt-1 p-2 rounded bg-surface font-mono text-xs break-all">
        curl -H &quot;Authorization: Bearer $PUNKTUALNIK_KEY&quot; {origin}/api/v1/me
      </code>
    </div>
  );
};

const KeyRow = ({ apiKey, onRevoke }) => {
  const status = STATUS[apiKey.status] ?? STATUS.revoked;
  return (
    <li className="py-3 border-t border-line-subtle first:border-t-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium break-words">
          {apiKey.name}
          <span className="ml-2 font-mono text-xs text-muted">{apiKey.prefix}…</span>
        </p>
        <div className="flex items-center gap-2">
          <Badge tone={status.tone}>{status.label}</Badge>
          {apiKey.status === "active" && (
            <Button size="sm" variant="secondary" onClick={() => onRevoke(apiKey)}>
              Odwołaj
            </Button>
          )}
        </div>
      </div>
      <p className="mt-1 text-sm text-muted break-words">{apiKey.scopes.join(", ")}</p>
      <p className="mt-1 text-xs text-muted">
        Utworzony {day(apiKey.createdAt)} · ważny do {day(apiKey.expiresAt)} · ostatnio użyty {minute(apiKey.lastUsedAt)}
      </p>
    </li>
  );
};

export default function ApiKeys() {
  const { data, error: loadError, mutate } = useSWR("/api/keys", fetchKeys);
  const formRef = useRef();
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [newToken, setNewToken] = useState(null);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);

    const form = new FormData(formRef.current);
    try {
      const response = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.get("name"),
          scopes: form.getAll("scopes"),
          days: Number(form.get("days")),
          password: form.get("password"),
        }),
      });
      const body = await response.json();

      if (!response.ok) {
        setError(ERROR_MESSAGES[body.error] || body.message || "Nie udało się utworzyć klucza.");
        return;
      }
      setNewToken(body.token);
      formRef.current.reset();
      mutate();
    } catch {
      setError("Brak połączenia z serwerem. Spróbuj ponownie.");
    } finally {
      setBusy(false);
    }
  };

  const handleRevoke = async (apiKey) => {
    if (!window.confirm(`Odwołać klucz „${apiKey.name}”? Korzystające z niego integracje przestaną działać.`)) return;
    setError(null);
    const response = await fetch(`/api/keys/${apiKey.id}`, { method: "DELETE" });
    if (!response.ok) setError("Nie udało się odwołać klucza. Odśwież stronę i spróbuj ponownie.");
    mutate();
  };

  return (
    <BaseLayout width="narrow">
      <PageHeader
        title="Klucze API"
        description="Sterowanie własnymi zadaniami i timerem ze skryptów, skrótów i innych programów."
      />

      <Alert tone="info" className="mb-6">
        Klucz działa jak dostęp do Twoich zadań, bez hasła. Nie wklejaj go do repozytorium ani do czatu. Dane, które
        odczyta program z kluczem, w tym nazwy projektów i klientów, trafiają tam, dokąd wysyła je ten program.
      </Alert>

      {newToken && <NewKeyNotice token={newToken} onClose={() => setNewToken(null)} />}

      <h2 className="mb-2 text-sm font-bold uppercase tracking-signage">Twoje klucze</h2>
      {loadError && <Alert>Nie udało się wczytać kluczy. Odśwież stronę.</Alert>}
      {data && data.keys.length === 0 && <p className="text-sm text-muted">Nie masz jeszcze żadnego klucza.</p>}
      {data && data.keys.length > 0 && (
        <ul>
          {data.keys.map((apiKey) => (
            <KeyRow key={apiKey.id} apiKey={apiKey} onRevoke={handleRevoke} />
          ))}
        </ul>
      )}

      <h2 className="mt-10 mb-4 text-sm font-bold uppercase tracking-signage">Nowy klucz</h2>
      <form ref={formRef} onSubmit={handleCreate} className="flex flex-col gap-4">
        <Field label="Nazwa" htmlFor="name" hint="Żeby później było wiadomo, gdzie ten klucz jest używany.">
          <Input id="name" name="name" maxLength={60} autoComplete="off" required />
        </Field>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">Uprawnienia</legend>
          {API_SCOPES.map((scope) => (
            <Checkbox key={scope} name="scopes" value={scope} label={API_SCOPE_LABEL[scope]} defaultChecked={scope === "read"} />
          ))}
          <p className="text-xs text-muted">
            Daj tylko to, co potrzebne. Agentowi AI zwykle wystarczy odczyt i timer. Kasowanie jest nieodwracalne.
          </p>
        </fieldset>

        <Field label="Ważność" htmlFor="days">
          <Select id="days" name="days" defaultValue={API_KEY_DEFAULT_DAYS}>
            {API_KEY_DAYS.map((days) => (
              <option key={days} value={days}>
                {days} dni
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Twoje hasło" htmlFor="password" hint="Potwierdzenie, że to Ty tworzysz klucz.">
          <Input type="password" id="password" name="password" autoComplete="current-password" required />
        </Field>

        {error && <Alert tone="danger">{error}</Alert>}

        <Button type="submit" disabled={busy} className="self-start mt-1">
          {busy ? "Tworzę…" : "Utwórz klucz"}
        </Button>
      </form>
    </BaseLayout>
  );
}
