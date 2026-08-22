import Joi from "joi";
import dayjs from "dayjs";
import db from "./db";
import {
  TS_FORMAT,
  toStamp,
  workDay,
  workDayStart,
  minEditableDay,
  WORKDAY_START_HOUR,
  now as appNow,
} from "./workday";

// Wpisy czasu: "ile czasu i na czym zeszło".
//
// To JEDYNE miejsce, w którym przeliczana jest kolumna seconds. Jest ona
// redundantna wobec pary startedAt/endedAt i trzymamy ją tylko dlatego, że
// raporty ją sumują — więc każde rozejście się tych trzech wartości byłoby
// błędem cichym i nie do wykrycia z zewnątrz.

const COLS = `
  e.id, e.userID, e.projectID, e.description, e.data, e.startedAt, e.endedAt,
  e.seconds, e.section, e.autoClosed, e.createdAt, e.editedAt, e.editedBy, e.editedByName`;

const SELECT_ONE = `SELECT ${COLS} FROM TaskEntries e WHERE e.id = ?`;

const stmtById = db.prepare(SELECT_ONE);
const stmtRunning = db.prepare(`SELECT ${COLS} FROM TaskEntries e WHERE e.userID = ? AND e.endedAt IS NULL`);

const toRow = (r) => (r ? { ...r, autoClosed: Boolean(r.autoClosed) } : undefined);

const secondsBetween = (start, end) => Math.max(0, dayjs(end).diff(dayjs(start), "second"));

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
         seconds    = CAST(ROUND((julianday(datetime(data || ' ${String(WORKDAY_START_HOUR).padStart(2, "0")}:00:00', '+1 day'))
                                  - julianday(startedAt)) * 86400) AS INTEGER),
         autoClosed = 1
   WHERE endedAt IS NULL
     AND startedAt < @boundary`);

/** @returns {number} ile timerów domknięto (zwykle 0) */
export const closeStaleEntries = (now = appNow()) =>
  stmtCloseStale.run({ boundary: workDayStart(now).format(TS_FORMAT) }).changes;

// Domykanie to UPDATE, a endpointy odpytywane cyklicznie (/api/entries/running
// z panelu kierownika, /api/entries/timer z KAŻDEJ strony) wołałyby je po kilka
// razy na minutę na każdą otwartą kartę. Granica domykania to 3:00, więc realnie
// jest co robić raz na dobę — bez dławika brałyby blokadę zapisu bez powodu,
// konkurując z kioskiem odbijającym karty.
//
// Dławik siedzi TUTAJ, a nie w endpointach, żeby wszyscy wołający dzielili jeden
// licznik: dwa niezależne dławiki po 60 s to nadal dwa zapisy na minutę.
const SWEEP_EVERY_MS = 60_000;
let lastSweep = 0;

export const sweepStaleEntries = () => {
  const nowMs = Date.now();
  if (nowMs - lastSweep < SWEEP_EVERY_MS) return;
  lastSweep = nowMs;
  closeStaleEntries();
};

// --- odczyt -----------------------------------------------------------------

export const getEntry = (id) => toRow(stmtById.get(Number(id)));

export const getRunningEntry = (userID) => toRow(stmtRunning.get(Number(userID)));

const stmtRunningDetail = db.prepare(`
  SELECT ${COLS}, p.name AS projectName, p.color AS projectColor
    FROM TaskEntries e
    LEFT JOIN Projects p ON p.id = e.projectID
   WHERE e.userID = ? AND e.endedAt IS NULL`);

/** Własny biegnący wpis razem z nazwą projektu — dla timera w tytule karty. */
export const getRunningEntryDetail = (userID) => toRow(stmtRunningDetail.get(Number(userID)));

/**
 * Ile sekund biegnie ten timer. Liczone NA SERWERZE z tego samego powodu co
 * w services/liveBoard.js:94-101 — znaczniki są zapisane bez offsetu strefy,
 * więc przeglądarka z przestawionym zegarem albo w innej strefie policzyłaby
 * czas przesunięty o godziny. Odejmowanie idzie przez secondsBetween, żeby
 * miało w tym module jedno źródło.
 */
export const runningSeconds = (entry, now = appNow()) => secondsBetween(entry.startedAt, toStamp(now));

const stmtForUser = db.prepare(`
  SELECT ${COLS}, p.name AS projectName, p.color AS projectColor, p.client AS projectClient
    FROM TaskEntries e
    LEFT JOIN Projects p ON p.id = e.projectID
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

/**
 * Wpis wolno ZAMKNĄĆ dopiero opisany i przypisany do projektu.
 *
 * Timer startuje jednym kliknięciem — o to chodzi, bo licznik ma nie uciekać,
 * kiedy praca już trwa. Ale to, co z niego zostaje, jest sumowane w raportach
 * i czytane po miesiącach, więc "(bez opisu)" na nieznanym projekcie jest
 * wpisem bezużytecznym.
 *
 * To odwrotna decyzja niż przy kolizji w stopEntry (komentarz niżej) i jest
 * świadoma: kolizji z ręcznym wpisem pracownik nie naprawi w tej sekundzie,
 * a brakującego opisu — tak, pole stoi tuż obok przycisku Stop. Licznik przy
 * odrzuconym zatrzymaniu leci dalej, więc nic się nie gubi.
 */
const assertComplete = (entry) => {
  if (!entry.projectID) fail("incomplete", "Wybierz projekt, zanim zamkniesz zadanie.");
  if (!String(entry.description ?? "").trim()) fail("incomplete", "Opisz zadanie, zanim je zamkniesz.");
};

// --- zapis ------------------------------------------------------------------

const stmtInsert = db.prepare(`
  INSERT INTO TaskEntries (userID, projectID, description, data, startedAt, endedAt, seconds, section, createdAt)
  VALUES (@userID, @projectID, @description, @data, @startedAt, @endedAt, @seconds, @section, @createdAt)`);

const descSchema = Joi.string().trim().max(200).allow("").default("");

/**
 * Start timera. Jeden biegnący wpis na osobę pilnuje UNIQUE INDEX
 * idx_entries_running — łapiemy SQLITE_CONSTRAINT i tłumaczymy na 409,
 * zamiast sprawdzać wcześniej SELECT-em (ten przegrałby z wyścigiem dwóch zakładek).
 */
export const startEntry = ({ userID, projectID, description, section }, now = appNow()) => {
  const desc = Joi.attempt(description ?? "", descSchema);
  const startedAt = toStamp(now);

  const covering = stmtCoveringAt.get({ userID: Number(userID), moment: startedAt });
  if (covering) {
    fail("overlap", `Masz już wpis obejmujący tę godzinę (${hhmm(covering.startedAt)}–${hhmm(covering.endedAt)}).`);
  }

  try {
    const info = stmtInsert.run({
      userID: Number(userID),
      // Pusty projekt jest dozwolony WYŁĄCZNIE tutaj i w retagRunningEntry —
      // czyli dopóki wpis biegnie. Zamknięcie wymaga kompletu (assertComplete).
      projectID: projectID ? Number(projectID) : null,
      description: desc,
      data: workDay(now),
      startedAt,
      endedAt: null,
      seconds: null,
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
  UPDATE TaskEntries SET endedAt = @endedAt, seconds = @seconds
   WHERE id = @id AND userID = @userID AND endedAt IS NULL`);

/**
 * Zatrzymanie timera świadomie NIE sprawdza kolizji: odrzucenie stopu
 * zostawiłoby wpis biegnący w nieskończoność i pracownik straciłby pracę,
 * której już nie odtworzy. Kolizja z ręcznym wpisem dodanym w międzyczasie
 * jest widoczna w UI i do poprawienia edycją.
 */
export const stopEntry = ({ id, userID }, now = appNow()) => {
  const entry = getEntry(id);
  if (!entry || Number(entry.userID) !== Number(userID)) return undefined;

  assertComplete(entry);

  const endedAt = toStamp(now);
  const info = stmtStop.run({
    id: Number(id),
    userID: Number(userID),
    endedAt,
    seconds: secondsBetween(entry.startedAt, endedAt),
  });

  return info.changes > 0 ? getEntry(id) : undefined;
};

const stmtRetag = db.prepare(`
  UPDATE TaskEntries SET projectID = @projectID, description = @description
   WHERE id = @id AND userID = @userID AND endedAt IS NULL`);

/**
 * Opis i projekt BIEGNĄCEGO timera — bez dotykania czasów.
 *
 * Ludzie klikają Start, żeby licznik nie uciekał, a co robią, dopisują chwilę
 * później. Wcześniej trzeba było zatrzymać timer i wejść w edycję wpisu, czyli
 * zapłacić za porządek w opisach rozcięciem pracy na dwa kawałki.
 *
 * Warunki "mój wpis" i "wciąż biegnie" siedzą w SAMYM SQL, jak w deleteEntry:
 * wynik rozstrzyga `changes`, więc równoczesny Stop z drugiej zakładki nie
 * przepisze opisu wpisu już zamkniętego (tam czasy są ostateczne i zmiana
 * projektu wymaga zwykłej edycji, z podpisem poprawiającego).
 *
 * `editedBy` zostaje puste — to właściciel poprawia sam siebie, dokładnie jak
 * przy zatrzymywaniu timera. Podpis jest zastrzeżony dla korekt kierownika.
 */
export const retagRunningEntry = ({ id, userID, projectID, description }) => {
  const info = stmtRetag.run({
    id: Number(id),
    userID: Number(userID),
    // Wolno też ZDJĄĆ projekt: skoro da się wystartować bez niego, to da się
    // również cofnąć omyłkowy wybór, dopóki wpis biegnie.
    projectID: projectID ? Number(projectID) : null,
    description: Joi.attempt(description ?? "", descSchema),
  });

  return info.changes > 0 ? getEntry(id) : undefined;
};

const stmtSetStart = db.prepare(`
  UPDATE TaskEntries SET startedAt = @startedAt
   WHERE id = @id AND userID = @userID AND endedAt IS NULL`);

const TIME_RE = /^\d{2}:\d{2}(:\d{2})?$/;

/**
 * Przesunięcie godziny startu BIEGNĄCEGO timera.
 *
 * Sytuacja jest codzienna: spotkanie zaczyna się o 9:00, a timer wchodzi o 9:10,
 * kiedy ktoś sobie o nim przypomni. Dotąd jedynym wyjściem było zatrzymanie
 * licznika, poprawienie zamkniętego wpisu i start od nowa — czyli rozcięcie
 * jednej pracy na dwa kawałki tylko po to, żeby poprawić kwadrans.
 *
 * Osobna funkcja obok retagRunningEntry, a nie jej rozszerzenie: tamta jedzie
 * autozapisem co 800 ms z pola tekstowego, a godzina jest zatwierdzana jawnie.
 * Wpuszczenie czasu do tamtej ścieżki znaczyłoby, że spóźniony debounce opisu
 * potrafi cofnąć świeżo poprawiony start.
 *
 * Warunki "mój wpis" i "wciąż biegnie" siedzą w SAMYM SQL, jak w retagu:
 * równoczesny Stop z drugiej zakładki nie da się nadpisać.
 */
export const setRunningStart = ({ id, userID, from }, now = appNow()) => {
  const entry = getEntry(id);
  if (!entry || Number(entry.userID) !== Number(userID)) return undefined;

  if (!TIME_RE.test(String(from ?? ""))) fail("bad_time", "Podaj godzinę w formacie GG:MM.");

  // Data KALENDARZOWA obecnego startu, a nie kolumna `data`: doba robocza sięga
  // do 3:00, więc wpis z data = 2026-08-19 potrafi mieć startedAt 2026-08-20 00:30.
  const candidate = dayjs(`${String(entry.startedAt).slice(0, 10)} ${withSeconds(from)}`);
  const nowStamp = toStamp(now);

  // Poza dobę roboczą wpisu wyjść nie wolno: kolumna `data` zostaje bez zmian,
  // więc start przesunięty przed jej granicę rozjechałby wpis z własnym dniem,
  // a za nim raporty i auto-domykanie.
  const dayStart = `${entry.data} ${String(WORKDAY_START_HOUR).padStart(2, "0")}:00:00`;

  let startedAt = candidate.format(TS_FORMAT);

  // Godzina wypadająca w przyszłość może znaczyć "wczoraj wieczorem" — tak jest
  // między północą a 3:00, kiedy doba robocza wpisu obejmuje dwie daty
  // kalendarzowe. Cofamy o dobę TYLKO wtedy, gdy wynik nadal do niej należy;
  // inaczej godzina po prostu jest z przyszłości i tak trzeba to nazwać.
  if (startedAt > nowStamp) {
    const earlier = candidate.subtract(1, "day").format(TS_FORMAT);
    if (earlier >= dayStart) startedAt = earlier;
  }

  if (startedAt > nowStamp) fail("bad_range", "Początek nie może być w przyszłości.");
  if (startedAt < dayStart) {
    fail("bad_range", "Początek musi zostać w dobie roboczej, w której zadanie wystartowało.");
  }

  return db.transaction(() => {
    // Wpis biegnący nie ma końca, więc na potrzeby kolizji traktujemy jako koniec
    // chwilę bieżącą — czyli dokładnie ten odcinek, który zadanie już zajmuje.
    assertNoOverlap({ userID: entry.userID, startedAt, endedAt: nowStamp, id: entry.id });
    const info = stmtSetStart.run({ id: Number(id), userID: Number(userID), startedAt });
    return info.changes > 0 ? getEntry(id) : undefined;
  })();
};

// Przełączenie zadania tuż po starcie to korekta pomyłki ("nie ten projekt"),
// a nie praca. Taki wpis znika, żeby lista dnia nie zbierała kilkusekundowych
// śmieci, których nikt potem nie sprząta.
const MIN_KEEP_SECONDS = 10;

/**
 * "Wznów zadanie" przy biegnącym timerze: zamknij bieżące i od razu zacznij nowe.
 *
 * Jedna transakcja i jeden znacznik czasu dla obu wpisów, więc nowe zadanie
 * zaczyna się dokładnie tam, gdzie skończyło się poprzednie — bez dziury w dniu
 * i bez zakładki. Kolejność jest wymuszona przez idx_entries_running: dopóki
 * poprzedni wpis nie ma końca, INSERT nowego odbiłby się o ten indeks.
 *
 * Dotąd wznowienie przy biegnącym liczniku kończyło się komunikatem "masz już
 * uruchomiony timer" — czyli zrzucało na pracownika robotę, którą aplikacja umie
 * wykonać sama: zatrzymać jedno, wystartować drugie.
 *
 * O odrzuceniu wpisu-pomyłki decydujemy PRZED jego zamknięciem, a nie po —
 * inaczej assertComplete odbiłby nieopisany wpis sprzed dziesięciu sekund
 * i zablokował jedyne wyjście z sytuacji "kliknąłem nie ten kafelek". Pracy
 * trwającej dłużej ta furtka już nie obejmuje: żeby przejść na inne zadanie,
 * trzeba najpierw opisać bieżące.
 *
 * @returns {{entry: object, stopped: object|null, discarded: boolean}}
 *   `stopped` to zamknięty wpis (null, gdy nic nie biegło albo wpis odrzucono),
 *   `discarded` mówi, że poprzedni wpis był krótszy niż MIN_KEEP_SECONDS.
 */
export const switchEntry = ({ userID, projectID, description, section }, now = appNow()) =>
  db.transaction(() => {
    const current = getRunningEntry(userID);
    const tooShort = current && secondsBetween(current.startedAt, toStamp(now)) < MIN_KEEP_SECONDS;

    let stopped = null;
    let discarded = false;

    if (tooShort) {
      deleteEntry({ id: current.id, userID, enforceWindow: false });
      discarded = true;
    } else if (current) {
      stopped = stopEntry({ id: current.id, userID }, now);
    }

    return {
      entry: startEntry({ userID, projectID, description, section }, now),
      stopped,
      discarded,
    };
  })();

// Opis WYMAGANY, w odróżnieniu od descSchema wyżej. Podział przebiega dokładnie
// tam, gdzie przebiega reguła: descSchema obsługuje wpis BIEGNĄCY (start, retag),
// gdzie pusty opis jest normalnym stanem przejściowym, a descRequiredSchema —
// wpis ZAMKNIĘTY, czyli formularz ręczny i edycję istniejącego wpisu. Ta sama
// zasada, której po stronie timera pilnuje assertComplete.
const descRequiredSchema = Joi.string().trim().min(1).max(200).required().messages({
  "string.empty": "Opisz zadanie — puste wpisy są nie do odczytania w raportach.",
  "any.required": "Opisz zadanie — puste wpisy są nie do odczytania w raportach.",
});

const manualSchema = Joi.object({
  // Tu projekt zostaje WYMAGANY: ta ścieżka tworzy wpis od razu zamknięty,
  // więc obowiązuje ją to samo, co zatrzymanie timera.
  projectID: Joi.number().integer().positive().required(),
  description: descRequiredSchema,
  data: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
  // Sekundy OPCJONALNE: formularz ręczny wysyła "HH:mm" (nikt nie wpisuje sekund
  // z pamięci), a edycja istniejącego wpisu "HH:mm:ss" — inaczej poprawienie
  // samego opisu ścinałoby wpis 30-sekundowy do zera.
  from: Joi.string().pattern(/^\d{2}:\d{2}(:\d{2})?$/).required(),
  to: Joi.string().pattern(/^\d{2}:\d{2}(:\d{2})?$/).required(),
});

/** "09:12" → "09:12:00"; "09:12:11" zostaje bez zmian. */
const withSeconds = (time) => (String(time).length === 5 ? `${time}:00` : String(time));

/**
 * Zamiana "dzień + od + do" na parę znaczników.
 *
 * Gdy godzina końca jest WCZEŚNIEJSZA od początku, wpis przechodzi przez północ
 * (zmiana nocna) — koniec ląduje następnego dnia kalendarzowego, ale doba
 * ROBOCZA pozostaje ta, w której wpis się zaczął.
 *
 * Momenty równe to celowo błąd, a nie "pełna doba": 10:00–10:00 jest w praktyce
 * zawsze pomyłką przy wpisywaniu, a cicha zamiana na 24 godziny zepsułaby
 * sumę miesiąca w sposób trudny do zauważenia. Uwaga: "równe" znaczy tu równe
 * CO DO SEKUNDY — wpis 10:00:11–10:00:19 jest poprawny i przechodzi.
 */
const spanFromParts = ({ data, from, to }) => {
  const startedAt = `${data} ${withSeconds(from)}`;
  let end = dayjs(`${data} ${withSeconds(to)}`);
  if (end.isBefore(dayjs(startedAt))) end = end.add(1, "day");

  const endedAt = end.format(TS_FORMAT);
  const seconds = secondsBetween(startedAt, endedAt);

  if (seconds <= 0) fail("bad_range", "Godzina zakończenia musi się różnić od godziny rozpoczęcia.");
  if (seconds > 24 * 3600) fail("too_long", "Pojedynczy wpis nie może przekraczać doby.");

  return { startedAt, endedAt, seconds };
};

export const createManualEntry = (payload, { userID, section, enforceWindow = true, now = appNow() }) => {
  const { projectID, description, data, from, to } = Joi.attempt(payload, manualSchema);
  if (enforceWindow) assertInWindow(data, now);

  const { startedAt, endedAt, seconds } = spanFromParts({ data, from, to });

  return db.transaction(() => {
    assertNoOverlap({ userID, startedAt, endedAt });
    const info = stmtInsert.run({
      userID: Number(userID),
      projectID,
      description,
      data,
      startedAt,
      endedAt,
      seconds,
      section: String(section),
      createdAt: toStamp(now),
    });
    return getEntry(info.lastInsertRowid);
  })();
};

const stmtUpdate = db.prepare(`
  UPDATE TaskEntries
     SET projectID = @projectID, description = @description, data = @data,
         startedAt = @startedAt, endedAt = @endedAt, seconds = @seconds,
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
export const updateEntry = (id, payload, { userID, enforceWindow = true, actor = null, now = appNow() }) => {
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

  const { startedAt, endedAt, seconds } = spanFromParts({ data, from, to });

  return db.transaction(() => {
    assertNoOverlap({ userID: entry.userID, startedAt, endedAt, id: entry.id });
    stmtUpdate.run({
      id: Number(id),
      projectID,
      description,
      data,
      startedAt,
      endedAt,
      seconds,
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

export const deleteEntry = ({ id, userID, enforceWindow = true, now = appNow() }) => {
  const params = { id: Number(id), userID: Number(userID) };
  const info = enforceWindow
    ? stmtDelete.run({ ...params, minDay: minEditableDay(now) })
    : stmtDeleteAny.run(params);
  return info.changes > 0;
};
