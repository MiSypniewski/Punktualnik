import { useState } from "react";
import { useRouter } from "next/router";
import { getToken } from "next-auth/jwt";
import classNames from "classnames";
import BaseLayout from "../../components/baseLayout";
import { projectColor, ProjectMark, COLOR_KEYS } from "../../components/projectColors";
import Button from "../../components/ui/button";
import { Field, Input } from "../../components/ui/field";
import Alert from "../../components/ui/alert";
import Badge from "../../components/ui/badge";
import PageHeader from "../../components/ui/pageHeader";
import { listProjects, projectScope, PROJECT_COLOR_KEYS } from "../../services/projects";
import { listSections } from "../../services/sections";
import { canManageProjects } from "../../services/roles";

// Dwuwarstwowe zabezpieczenie, jak przy nadgodzinach i eksporcie: tu blokujemy
// wejście na stronę, a /api/projects niezależnie blokuje same dane.
export async function getServerSideProps(ctx) {
  const token = await getToken({ req: ctx.req });

  if (!token) {
    return { redirect: { destination: "/users/signin", permanent: false } };
  }
  if (!canManageProjects(token.role)) {
    return { notFound: true };
  }

  const scope = projectScope(token);

  return {
    props: {
      projects: listProjects({ sections: scope, includeArchived: true }),
      // Do checkboxów pokazujemy wyłącznie sekcje w zasięgu tego kierownika —
      // przypisania spoza zasięgu API i tak odrzuci (403 section_out_of_scope).
      sections: listSections().filter((s) => scope.includes(s.slug)),
      colorKeys: PROJECT_COLOR_KEYS,
    },
  };
}

const EMPTY = { name: "", client: "", color: "indigo", sections: [] };

export default function Projekty({ projects, sections, colorKeys }) {
  const router = useRouter();

  const [form, setForm] = useState(EMPTY);
  const [editId, setEditId] = useState(null); // null = formularz zakłada nowy
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const refresh = () => router.replace(router.asPath, undefined, { scroll: false });

  const toggleSection = (slug) =>
    setForm((f) => ({
      ...f,
      sections: f.sections.includes(slug) ? f.sections.filter((s) => s !== slug) : [...f.sections, slug],
    }));

  const startEdit = (p) => {
    setEditId(p.id);
    setForm({ name: p.name, client: p.client || "", color: p.color || "indigo", sections: p.sections });
    setErr("");
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const cancelEdit = () => {
    setEditId(null);
    setForm(EMPTY);
    setErr("");
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setErr("Podaj nazwę projektu.");
      return;
    }

    setBusy(true);
    setErr("");
    try {
      const res = editId
        ? await fetch(`/api/projects/${editId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "update", ...form }),
          })
        : await fetch("/api/projects", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(form),
          });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErr(
          body.error === "section_out_of_scope"
            ? "Nie możesz przypisać projektu do sekcji spoza swojego zasięgu."
            : body.error || "Nie udało się zapisać projektu."
        );
        return;
      }

      cancelEdit();
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const setActive = async (id, restore) => {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch(`/api/projects/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: restore ? "restore" : "archive" }),
      });
      if (!res.ok) setErr("Nie udało się zmienić stanu projektu.");
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const active = projects.filter((p) => p.isActive);
  const archived = projects.filter((p) => !p.isActive);

  return (
    <BaseLayout>
      <section>
        <PageHeader
          title="Projekty"
          description="Projekty wybierają pracownicy przy raportowaniu zadań. Projektu nie da się skasować — można go zarchiwizować, wtedy znika z wyboru, ale dotychczasowe wpisy zostają nienaruszone."
        />

        <form onSubmit={submit} className="mb-8 p-4 border border-line rounded bg-raised">
          <h2 className="mb-4 text-sm font-bold uppercase tracking-signage">
            {editId ? "Edycja projektu" : "Nowy projekt"}
          </h2>

          <div className="grid sm:grid-cols-2 gap-4 mb-4">
            <Field label="Nazwa">
              <Input
                type="text"
                value={form.name}
                maxLength={80}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </Field>
            <Field label="Klient" hint="Nieobowiązkowy — zostaw puste, jeśli projekt jest wewnętrzny.">
              <Input
                type="text"
                value={form.client}
                maxLength={80}
                onChange={(e) => setForm({ ...form, client: e.target.value })}
              />
            </Field>
          </div>

          <div className="mb-4">
            <span className="block mb-1 text-xs font-semibold uppercase tracking-signage text-muted">Kolor</span>
            <div className="flex gap-2 flex-wrap">
              {colorKeys.map((key) => (
                <button
                  key={key}
                  type="button"
                  aria-label={`Kolor ${key}`}
                  onClick={() => setForm({ ...form, color: key })}
                  className={classNames(
                    "w-8 h-8 rounded border-2",
                    projectColor(key).mark,
                    form.color === key ? "border-body" : "border-transparent hover:border-line-strong"
                  )}
                />
              ))}
            </div>
          </div>

          <div className="mb-4">
            <span className="block mb-1 text-xs font-semibold uppercase tracking-signage text-muted">Sekcje</span>
            <p className="text-xs text-muted mb-2">
              Nie zaznaczaj żadnej, jeśli projekt ma być dostępny dla całej firmy.
            </p>
            <div className="flex gap-4 flex-wrap">
              {sections.map((s) => (
                <label key={s.slug} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.sections.includes(s.slug)}
                    onChange={() => toggleSection(s.slug)}
                    className="rounded-sm border-line-strong text-accent focus:ring-0"
                  />
                  {s.label}
                </label>
              ))}
              {sections.length === 0 && (
                <span className="text-sm text-muted">
                  Nie masz przypisanej żadnej sekcji — założysz tylko projekt ogólnofirmowy.
                </span>
              )}
            </div>
          </div>

          {err && (
            <Alert tone="danger" className="mb-4">
              {err}
            </Alert>
          )}

          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>
              {editId ? "Zapisz zmiany" : "Dodaj projekt"}
            </Button>
            {editId && (
              <Button variant="secondary" onClick={cancelEdit}>
                Anuluj
              </Button>
            )}
          </div>
        </form>

        <h2 className="mb-3 text-sm font-bold uppercase tracking-signage">Aktywne ({active.length})</h2>
        {active.length === 0 && <p className="text-sm text-muted mb-6">Brak aktywnych projektów.</p>}
        <ul className="mb-8">
          {active.map((p) => (
            <ProjectRow key={p.id} p={p} busy={busy} onEdit={startEdit} onToggle={setActive} />
          ))}
        </ul>

        {archived.length > 0 && (
          <>
            <h2 className="mb-3 text-sm font-bold uppercase tracking-signage">Zarchiwizowane ({archived.length})</h2>
            <ul>
              {archived.map((p) => (
                <ProjectRow key={p.id} p={p} busy={busy} onEdit={startEdit} onToggle={setActive} />
              ))}
            </ul>
          </>
        )}
      </section>
    </BaseLayout>
  );
}

const ProjectRow = ({ p, busy, onEdit, onToggle }) => (
  <li
    className={classNames(
      "flex items-center gap-3 p-3 border-b border-line-subtle flex-wrap",
      !p.isActive && "opacity-60"
    )}
  >
    <ProjectMark color={p.color} size="lg" />
    <span className="font-medium">{p.name}</span>
    {p.client && <span className="text-sm text-muted">· {p.client}</span>}

    <span className="flex gap-1 flex-wrap">
      {p.sections.length === 0 ? (
        <Badge>cała firma</Badge>
      ) : (
        p.sections.map((s) => (
          <span
            key={s}
            className={`px-2 py-0.5 rounded-sm text-xs font-semibold uppercase tracking-signage ${projectColor(p.color).chip}`}
          >
            {s}
          </span>
        ))
      )}
    </span>

    <span className="ml-auto flex gap-2">
      {p.isActive && (
        <Button variant="secondary" size="sm" onClick={() => onEdit(p)} disabled={busy}>
          Edytuj
        </Button>
      )}
      <Button variant="secondary" size="sm" onClick={() => onToggle(p.id, !p.isActive)} disabled={busy}>
        {p.isActive ? "Archiwizuj" : "Przywróć"}
      </Button>
    </span>
  </li>
);
