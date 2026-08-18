import { useState } from "react";
import { useRouter } from "next/router";
import { getToken } from "next-auth/jwt";
import classNames from "classnames";
import BaseLayout from "../../components/baseLayout";
import { projectColor, COLOR_KEYS } from "../../components/projectColors";
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
      <section className="mx-auto p-4 mt-6 mb-8 max-w-4xl">
        <h1 className="text-2xl font-bold mb-1">Projekty</h1>
        <p className="text-sm text-muted mb-6">
          Projekty wybierają pracownicy przy raportowaniu zadań. Projektu nie da się skasować — można go
          zarchiwizować, wtedy znika z wyboru, ale dotychczasowe wpisy zostają nienaruszone.
        </p>

        <form onSubmit={submit} className="mb-8 p-4 border border-line rounded bg-raised">
          <h2 className="font-bold mb-4">{editId ? "Edycja projektu" : "Nowy projekt"}</h2>

          <div className="grid sm:grid-cols-2 gap-4 mb-4">
            <div className="flex flex-col">
              <label className="mb-1 text-sm font-medium">Nazwa</label>
              <input
                type="text"
                value={form.name}
                maxLength={80}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="p-2 border border-indigo-400 rounded"
                required
              />
            </div>
            <div className="flex flex-col">
              <label className="mb-1 text-sm font-medium">Klient (opcjonalnie)</label>
              <input
                type="text"
                value={form.client}
                maxLength={80}
                onChange={(e) => setForm({ ...form, client: e.target.value })}
                className="p-2 border border-indigo-400 rounded"
              />
            </div>
          </div>

          <div className="mb-4">
            <span className="block mb-1 text-sm font-medium">Kolor</span>
            <div className="flex gap-2 flex-wrap">
              {colorKeys.map((key) => (
                <button
                  key={key}
                  type="button"
                  aria-label={`Kolor ${key}`}
                  onClick={() => setForm({ ...form, color: key })}
                  className={classNames(
                    "w-8 h-8 rounded-full border-2",
                    projectColor(key).dot,
                    form.color === key ? "border-body" : "border-transparent"
                  )}
                />
              ))}
            </div>
          </div>

          <div className="mb-4">
            <span className="block mb-1 text-sm font-medium">Sekcje</span>
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
                    className="rounded border-indigo-400"
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

          {err && <p className="mb-4 text-red-600 text-sm">{err}</p>}

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={busy}
              className="text-white bg-indigo-500 border-0 py-2 px-6 hover:bg-indigo-600 rounded disabled:opacity-50"
            >
              {editId ? "Zapisz zmiany" : "Dodaj projekt"}
            </button>
            {editId && (
              <button type="button" onClick={cancelEdit} className="py-2 px-6 border border-line-strong rounded">
                Anuluj
              </button>
            )}
          </div>
        </form>

        <h2 className="font-bold mb-3">Aktywne ({active.length})</h2>
        {active.length === 0 && <p className="text-sm text-muted mb-6">Brak aktywnych projektów.</p>}
        <ul className="mb-8">
          {active.map((p) => (
            <ProjectRow key={p.id} p={p} busy={busy} onEdit={startEdit} onToggle={setActive} />
          ))}
        </ul>

        {archived.length > 0 && (
          <>
            <h2 className="font-bold mb-3">Zarchiwizowane ({archived.length})</h2>
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
    <span className={`w-3 h-3 rounded-full shrink-0 ${projectColor(p.color).dot}`} />
    <span className="font-medium">{p.name}</span>
    {p.client && <span className="text-sm text-muted">· {p.client}</span>}

    <span className="flex gap-1 flex-wrap">
      {p.sections.length === 0 ? (
        <span className="text-xs px-2 py-0.5 rounded bg-raised text-body">cała firma</span>
      ) : (
        p.sections.map((s) => (
          <span key={s} className={`text-xs px-2 py-0.5 rounded ${projectColor(p.color).chip}`}>
            {s}
          </span>
        ))
      )}
    </span>

    <span className="ml-auto flex gap-2">
      {p.isActive && (
        <button
          onClick={() => onEdit(p)}
          disabled={busy}
          className="text-sm py-1 px-3 border border-line-strong rounded disabled:opacity-50"
        >
          Edytuj
        </button>
      )}
      <button
        onClick={() => onToggle(p.id, !p.isActive)}
        disabled={busy}
        className="text-sm py-1 px-3 border border-line-strong rounded disabled:opacity-50"
      >
        {p.isActive ? "Archiwizuj" : "Przywróć"}
      </button>
    </span>
  </li>
);
