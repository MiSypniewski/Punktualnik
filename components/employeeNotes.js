import { useState } from "react";
import useSWR from "swr";
import dayjs from "dayjs";
import "dayjs/locale/pl";
import Button from "./ui/button";
import Field, { Input, Textarea } from "./ui/field";
import Alert from "./ui/alert";
import { jsonFetcher } from "../utils";
import { NOTE_TEXT_MAX } from "../utils/employeeNotes";

// Notatki kierownika o pracowniku z jednego miesiąca: lista od najstarszej
// i formularz dopisania. Ten sam komponent stoi w widoku bieżącego miesiąca
// i w raporcie zamkniętego, obok formularza oceny.
//
// Po zapisie mutate(), nie router.replace: wpis w cache'u SWR nie ustępuje
// świeżym propsom SSR.

const API = "/api/report/miesieczny/notatki";

export const notesKey = (userID, month) => `${API}?userID=${userID}&miesiac=${month}`;

const dayLabel = (date) => dayjs(date).locale("pl").format("D MMMM, dddd");

const send = async (url, method, payload) => {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message || "Nie udało się zapisać notatki.");
  return body;
};

const NoteForm = ({ initial, min, max, busy, onSubmit, onCancel, submitLabel }) => {
  const [noteDate, setNoteDate] = useState(initial.noteDate);
  const [body, setBody] = useState(initial.body);
  const idBase = `note-${initial.id ?? "new"}`;

  const submit = async (e) => {
    e.preventDefault();
    const ok = await onSubmit({ noteDate, body });
    if (ok && !initial.id) setBody("");
  };

  return (
    <form onSubmit={submit} className="grid gap-3">
      <div className="grid sm:grid-cols-[11rem_1fr] gap-3">
        <Field label="Dzień" htmlFor={`${idBase}-date`}>
          <Input
            id={`${idBase}-date`}
            type="date"
            required
            min={min}
            max={max}
            value={noteDate}
            onChange={(e) => setNoteDate(e.target.value)}
          />
        </Field>
        <Field label="Notatka" htmlFor={`${idBase}-body`} hint="Widzą ją kierownicy sekcji, pracownik — nie.">
          <Textarea
            id={`${idBase}-body`}
            rows={3}
            required
            maxLength={NOTE_TEXT_MAX}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </Field>
      </div>
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={busy || !body.trim()}>
          {busy ? "Zapisywanie…" : submitLabel}
        </Button>
        {onCancel && (
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
            Anuluj
          </Button>
        )}
      </div>
    </form>
  );
};

/**
 * @param {object} props
 * @param {number} props.userID   pracownik
 * @param {string} props.month    'YYYY-MM'
 * @param {string} props.today    doba robocza serwera, 'YYYY-MM-DD'
 * @param {number} props.viewerID zalogowany — przy jego notatkach są przyciski
 * @param {object[]} [props.initialNotes] notatki z SSR
 * @param {(notes: object[]) => void} [props.onChange] po każdej zmianie, ze świeżą listą
 *        (np. do odświeżenia licznika na liście osób)
 */
export default function EmployeeNotes({ userID, month, today, viewerID, initialNotes, onChange }) {
  const key = notesKey(userID, month);
  const { data, mutate } = useSWR(key, jsonFetcher, initialNotes ? { fallbackData: { notes: initialNotes } } : undefined);
  const notes = data?.notes ?? [];

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [editing, setEditing] = useState(null);

  // Formularz pilnuje granic miesiąca: notatka z innego miesiąca zniknęłaby
  // z tej listy zaraz po zapisie.
  const first = `${month}-01`;
  const last = dayjs(first).endOf("month").format("YYYY-MM-DD");
  const max = last < today ? last : today;

  const run = async (action) => {
    setBusy(true);
    setErr("");
    try {
      await action();
      const fresh = await mutate();
      onChange?.(fresh?.notes ?? []);
      return true;
    } catch (e) {
      setErr(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const create = (fields) => run(() => send(API, "POST", { userID, ...fields }));
  const update = (id) => (fields) =>
    run(async () => {
      await send(`${API}/${id}`, "PATCH", fields);
      setEditing(null);
    });
  const remove = (id) => {
    if (!window.confirm("Usunąć tę notatkę?")) return;
    run(() => send(`${API}/${id}`, "DELETE"));
  };

  return (
    <div className="print:hidden">
      {notes.length === 0 ? (
        <p className="text-sm text-muted">Brak notatek z tego miesiąca.</p>
      ) : (
        <ul className="divide-y divide-line-subtle">
          {notes.map((note) => (
            <li key={note.id} className="py-3 first:pt-0">
              {editing === note.id ? (
                <NoteForm
                  initial={note}
                  min={first}
                  max={max}
                  busy={busy}
                  submitLabel="Zapisz zmiany"
                  onSubmit={update(note.id)}
                  onCancel={() => setEditing(null)}
                />
              ) : (
                <>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <p className="text-sm font-semibold">{dayLabel(note.noteDate)}</p>
                    {Number(note.createdBy) === Number(viewerID) && (
                      <div className="flex gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setEditing(note.id)} disabled={busy}>
                          Edytuj
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => remove(note.id)} disabled={busy}>
                          Usuń
                        </Button>
                      </div>
                    )}
                  </div>
                  <p className="mt-1 text-sm leading-relaxed whitespace-pre-line max-w-prose">{note.body}</p>
                  <p className="mt-1 text-xs text-muted">
                    {note.createdByName || "kierownik"} · {note.createdAt.slice(0, 16)}
                    {note.updatedAt ? ` · zmieniono ${note.updatedAt.slice(0, 16)}` : ""}
                  </p>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <Alert className="mt-3">{err}</Alert>

      {first <= today && (
        <div className="mt-4 pt-4 border-t border-line">
          <NoteForm
            key={`${userID}-${month}`}
            initial={{ noteDate: max, body: "" }}
            min={first}
            max={max}
            busy={busy}
            submitLabel="Dodaj notatkę"
            onSubmit={create}
          />
        </div>
      )}
    </div>
  );
}
