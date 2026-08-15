import Joi from "joi";
import dayjs from "dayjs";
import db from "./db";
import { TS_FORMAT, toStamp, workDay, workDayStart, minEditableDay, WORKDAY_START_HOUR } from "./workday";

// Wpisy czasu: "ile czasu i na czym zeszło".
//
// To JEDYNE miejsce, w którym przeliczana jest kolumna minutes. Jest ona
// redundantna wobec pary startedAt/endedAt i trzymamy ją tylko dlatego, że
// raporty ją sumują — więc każde rozejście się tych trzech wartości byłoby
// błędem cichym i nie do wykrycia z zewnątrz.

const COLS = `
  e.id, e.userID, e.projectID, e.description, e.data, e.startedAt, e.endedAt,
  e.minutes, e.section, e.autoClosed, e.createdAt, e.editedAt, e.editedBy, e.editedByName`;

const SELECT_ONE = `SELECT ${COLS} FROM TaskEntries e WHERE e.id = ?`;

const stmtById = db.prepare(SELECT_ONE);
const stmtRunning = db.prepare(`SELECT ${COLS} FROM TaskEntries e WHERE e.userID = ? AND e.endedAt IS NULL`);

const toRow = (r) => (r ? { ...r, autoClosed: Boolean(r.autoClosed) } : undefined);

const minutesBetween = (start, end) => Math.max(0, dayjs(end).diff(dayjs(start), "minute"));

// --- auto-domykanie ---------------------------------------------------------

// Na Mikrusie nie ma crona, a pm2 pilnuje tylko procesu Next.js — więc timer
// zapomniany na noc domykamy LENIWIE, przy okazji dowolnego odczytu.
//
// Domknięcie leci na koniec doby roboczej, w której wpis WYSTARTOWAŁ, a nie na
// bieżącą granicę. Inaczej timer zapomniany w piątek zamknąłby się dopiero
// w poniedziałek i dałby wpis na 70 godzin; tak zamyka się w sobotę o 3:00
// i żaden wpis nie przekroczy doby.
//
// Zapytanie jest idempotentne i zwykle nie rusza ani jednego wiersza (indeks
// częściowy idx_entries_running), więc wołanie go przy każdym wejściu na stronę
// jest tanie.
const stmtCloseStale = db.prepare(`
  UPDATE TaskEntries
     SET endedAt    = datetime(data || ' ${String(WORKDAY_START_HOUR).padStart(2, "0")}:00:00', '+1 day'),
         minutes    = CAST((julianday(datetime(data || ' ${String(WORKDAY_START_HOUR).padStart(2, "0")}:00:00', '+1 day'))
                            - julianday(startedAt)) * 1440 AS INTEGER),
         autoClosed = 1
   WHERE endedAt IS NULL
     AND startedAt < @boundary`);

/** @returns {number} ile timerów domknięto (zwykle 0) */
export const closeStaleEntries = (now = dayjs()) =>
  stmtCloseStale.run({ boundary: workDayStart(now).format(TS_FORMAT) }).changes;

// --- odczyt -----------------------------------------------------------------

export const getEntry = (id) => toRow(stmtById.get(Number(id)));

export const getRunningEntry = (userID) => toRow(stmtRunning.get(Number(userID)));

const stmtForUser = db.prepare(`
  SELECT ${COLS}, p.name AS projectName, p.color AS projectColor, p.client AS projectClient
    FROM TaskEntries e
    JOIN Projects p ON p.id = e.projectID
   WHERE e.userID = @userID AND e.data BETWEEN @from AND @to
   ORDER BY e.data DESC, e.startedAt DESC`);

export const getEntriesForUser = ({ userID, from, to }) =>
  stmtForUser.all({ userID: Number(userID), from, to }).map(toRow);

// --- reguły -----------------------------------------------------------------

const fail = (code, message) => {
  const err = new Error(message);
  err.code = code;
  throw err;
};

// Kolizje wykrywamy tylko wobec wpisów ZAMKNIĘTYCH: biegnący timer nie ma
// jeszcze końca, więc nie da się powiedzieć, czy na coś nachodzi. Praktycznie
// nie boli, bo start nowego timera i tak sprawdza, czy jego moment startu nie
// wpada w istniejący wpis (stmtCoveringAt niżej).
const stmtOverlap = db.prepare(`
  SELECT id, startedAt, endedAt FROM TaskEntries
   WHERE userID = @userID AND id <> @id AND endedAt IS NOT NULL
     AND startedAt < @endedAt AND endedAt > @startedAt
   LIMIT 1`);

const stmtCoveringAt = db.prepare(`
  SELECT id, startedAt, endedAt FROM TaskEntries
   WHERE userID = @userID AND endedAt IS NOT NULL
     AND startedAt <= @moment AND endedAt > @moment
   LIMIT 1`);

const hhmm = (ts) => String(ts ?? "").slice(11, 16);

const assertNoOverlap = ({ userID, startedAt, endedAt, id = 0 }) => {
  const clash = stmtOverlap.get({ userID: Number(userID), id: Number(id), startedAt, endedAt });
  if (clash) {
    fail("overlap", `Ten czas nachodzi na wpis ${hhmm(clash.startedAt)}–${hhmm(clash.endedAt)}.`);
  }
};

/**
 * Okno edycji pracownika: dziś i wczoraj, liczone dobą roboczą.
 * Kierownik poprawiający cudzy wpis przechodzi z enforceWindow = false —
 * inaczej starszy błąd zostałby w bazie na zawsze, bo pracownik już go nie sięgnie.
 */
const assertInWindow = (data, now) => {
  if (String(data).slice(0, 10) < minEditableDay(now)) {
    fail("edit_window_closed", "Edytować można tylko wpisy z dziś i wczoraj.");
  }
};

// --- zapis ------------------------------------------------------------------

const stmtInsert = db.prepare(`
  INSERT INTO TaskEntries (userID, projectID, description, data, startedAt, endedAt, minutes, section, createdAt)
  VALUES (@userID, @projectID, @description, @data, @startedAt, @endedAt, @minutes, @section, @createdAt)`);

const descSchema = Joi.string().trim().max(200).allow("").default("");

/**
 * Start timera. Jeden biegnący wpis na osobę pilnuje UNIQUE INDEX
 * idx_entries_running — łapiemy SQLITE_CONSTRAINT i tłumaczymy na 409,
 * zamiast sprawdzać wcześniej SELECT-em (ten przegrałby z wyścigiem dwóch zakładek).
 */
export const startEntry = ({ userID, projectID, description, section }, now = dayjs()) => {
  const desc = Joi.attempt(description ?? "", descSchema);
  const startedAt = toStamp(now);

  const covering = stmtCoveringAt.get({ userID: Number(userID), moment: startedAt });
  if (covering) {
    fail("overlap", `Masz już wpis obejmujący tę godzinę (${hhmm(covering.startedAt)}–${hhmm(covering.endedAt)}).`);
  }

  try {
    const info = stmtInsert.run({
      userID: Number(userID),
      projectID: Number(projectID),
      description: desc,
      data: workDay(now),
      startedAt,
      endedAt: null,
      minutes: null,
      section: String(section),
      createdAt: startedAt,
    });
    return getEntry(info.lastInsertRowid);
  } catch (error) {
    if (String(error.code).startsWith("SQLITE_CONSTRAINT")) {
      fail("already_running", "Masz już uruchomiony timer.");
    }
    throw error;
  }
};

const stmtStop = db.prepare(`
  UPDATE TaskEntries SET endedAt = @endedAt, minutes = @minutes
   WHERE id = @id AND userID = @userID AND endedAt IS NULL`);

/**
 * Zatrzymanie timera świadomie NIE sprawdza kolizji: odrzucenie stopu
 * zostawiłoby wpis biegnący w nieskończoność i pracownik straciłby pracę,
 * której już nie odtworzy. Kolizja z ręcznym wpisem dodanym w międzyczasie
 * jest widoczna w UI i do poprawienia edycją.
 */
export const stopEntry = ({ id, userID }, now = dayjs()) => {
  const entry = getEntry(id);
  if (!entry || Number(entry.userID) !== Number(userID)) return undefined;

  const endedAt = toStamp(now);
  const info = stmtStop.run({
    id: Number(id),
    userID: Number(userID),
    endedAt,
    minutes: minutesBetween(entry.startedAt, endedAt),
  });

  return info.changes > 0 ? getEntry(id) : undefined;
};

const manualSchema = Joi.object({
  projectID: Joi.number().integer().positive().required(),
  description: descSchema,
  data: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
  from: Joi.string().pattern(/^\d{2}:\d{2}$/).required(),
  to: Joi.string().pattern(/^\d{2}:\d{2}$/).required(),
});

/**
 * Zamiana "dzień + od + do" na parę znaczników.
 *
 * Gdy godzina końca jest WCZEŚNIEJSZA od początku, wpis przechodzi przez północ
 * (zmiana nocna) — koniec ląduje następnego dnia kalendarzowego, ale doba
 * ROBOCZA pozostaje ta, w której wpis się zaczął.
 *
 * Godziny równe to celowo błąd, a nie "pełna doba": 10:00–10:00 jest w praktyce
 * zawsze pomyłką przy wpisywaniu, a cicha zamiana na 24 godziny zepsułaby
 * sumę miesiąca w sposób trudny do zauważenia.
 */
const spanFromParts = ({ data, from, to }) => {
  const startedAt = `${data} ${from}:00`;
  let end = dayjs(`${data} ${to}:00`);
  if (end.isBefore(dayjs(startedAt))) end = end.add(1, "day");

  const endedAt = end.format(TS_FORMAT);
  const minutes = minutesBetween(startedAt, endedAt);

  if (minutes <= 0) fail("bad_range", "Godzina zakończenia musi się różnić od godziny rozpoczęcia.");
  if (minutes > 24 * 60) fail("too_long", "Pojedynczy wpis nie może przekraczać doby.");

  return { startedAt, endedAt, minutes };
};

export const createManualEntry = (payload, { userID, section, enforceWindow = true, now = dayjs() }) => {
  const { projectID, description, data, from, to } = Joi.attempt(payload, manualSchema);
  if (enforceWindow) assertInWindow(data, now);

  const { startedAt, endedAt, minutes } = spanFromParts({ data, from, to });

  return db.transaction(() => {
    assertNoOverlap({ userID, startedAt, endedAt });
    const info = stmtInsert.run({
      userID: Number(userID),
      projectID,
      description,
      data,
      startedAt,
      endedAt,
      minutes,
      section: String(section),
      createdAt: toStamp(now),
    });
    return getEntry(info.lastInsertRowid);
  })();
};

const stmtUpdate = db.prepare(`
  UPDATE TaskEntries
     SET projectID = @projectID, description = @description, data = @data,
         startedAt = @startedAt, endedAt = @endedAt, minutes = @minutes,
         autoClosed = 0,
         editedAt = @editedAt, editedBy = @editedBy, editedByName = @editedByName
   WHERE id = @id`);

/**
 * Edycja wpisu. `actor` wypełniany TYLKO gdy poprawia ktoś inny niż właściciel —
 * podpis kierownika ma być widoczny w wierszu i przeżyć zmianę jego danych,
 * stąd editedByName tekstem (ten sam zabieg co Overtime.decidedByName).
 *
 * Zdejmuje flagę autoClosed: edycja jest właśnie tym potwierdzeniem, o które
 * prosi żółty pasek przy wpisie domkniętym automatycznie.
 */
export const updateEntry = (id, payload, { userID, enforceWindow = true, actor = null, now = dayjs() }) => {
  const entry = getEntry(id);
  if (!entry) return undefined;
  if (Number(entry.userID) !== Number(userID)) return undefined;

  const { projectID, description, data, from, to } = Joi.attempt(payload, manualSchema);

  // Okno sprawdzamy dla obu dat: nie wolno wyprowadzić wpisu poza okno ani
  // wciągnąć do niego wpisu spoza.
  if (enforceWindow) {
    assertInWindow(entry.data, now);
    assertInWindow(data, now);
  }

  const { startedAt, endedAt, minutes } = spanFromParts({ data, from, to });

  return db.transaction(() => {
    assertNoOverlap({ userID: entry.userID, startedAt, endedAt, id: entry.id });
    stmtUpdate.run({
      id: Number(id),
      projectID,
      description,
      data,
      startedAt,
      endedAt,
      minutes,
      editedAt: actor ? toStamp(now) : entry.editedAt,
      editedBy: actor ? Number(actor.userID) : entry.editedBy,
      editedByName: actor ? String(actor.name) : entry.editedByName,
    });
    return getEntry(id);
  })();
};

// Warunek własności i okna siedzi w SAMYM SQL, nie tylko w API — tak jak
// w services/cancelOvertimeRequest.js. Dzięki temu wynik rozstrzyga changes,
// co jest odporne na wyścig dwóch zakładek.
const stmtDelete = db.prepare(`DELETE FROM TaskEntries WHERE id = @id AND userID = @userID AND data >= @minDay`);
const stmtDeleteAny = db.prepare(`DELETE FROM TaskEntries WHERE id = @id AND userID = @userID`);

export const deleteEntry = ({ id, userID, enforceWindow = true, now = dayjs() }) => {
  const params = { id: Number(id), userID: Number(userID) };
  const info = enforceWindow
    ? stmtDelete.run({ ...params, minDay: minEditableDay(now) })
    : stmtDeleteAny.run(params);
  return info.changes > 0;
};
