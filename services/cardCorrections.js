import Joi from "joi";
import dayjs from "dayjs";
import db from "./db";
import { appTime, now as appNow } from "./workday";
import { correctCard, createCardForUser, getCard, resolveCard, todayStamp, STATUS_FOR } from "./manageTime";
import { logInfo } from "./log";
import { CORRECTION_REASON_MAX as REASON_MAX } from "../utils";

// Zgłoszenia korekty karty czasu składane przez PRACOWNIKA.
//
// Pomyłki są dwie i obie zdarzają się przy kiosku: przypadkowe dotknięcie
// kafelka zamyka kartę w środku dnia, a ktoś, kto zaczął pracę bez odbicia,
// ma kartę od późniejszej godziny albo nie ma jej wcale. Do tej pory naprawiał
// to wyłącznie kierownik w panelu korekty — o ile w ogóle się o tym dowiedział.
//
// Zakres jest świadomie wąski: TYLKO dzisiejsza karta. Pomyłkę widać od razu
// na tablicy, a starsze dni zostają w rękach kierownika (/time/zarzadzaj).
//
// Zatwierdzenie NIE ma własnej logiki zapisu: woła correctCard albo
// createCardForUser z services/manageTime.js, czyli dokładnie to, co robi
// kierownik w panelu. Karta dostaje jego podpis (editedBy), bo to on wziął
// odpowiedzialność za zmianę.

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const REASON_MIN = 5;

/** Kody błędów → status HTTP; uzupełnia STATUS_FOR z panelu korekty. */
export const CORRECTION_STATUS_FOR = {
  ...STATUS_FOR,
  pending_exists: 409,
  no_change: 422,
  already_decided: 409,
};

const fail = (code, message) => {
  const error = new Error(message);
  error.code = code;
  throw error;
};

const schema = Joi.object({
  start: Joi.string().pattern(TIME_RE).required(),
  open: Joi.boolean().default(false),
  end: Joi.when("open", {
    is: true,
    then: Joi.any().strip(),
    otherwise: Joi.string().pattern(TIME_RE).required(),
  }),
  reason: Joi.string().trim().min(REASON_MIN).max(REASON_MAX).required(),
}).messages({
  "any.required": "Uzupełnij godzinę wejścia, wyjścia i powód.",
  "string.empty": "Uzupełnij godzinę wejścia, wyjścia i powód.",
  "string.pattern.base": "Godziny podaj w formacie HH:MM.",
  "string.min": "Powód jest za krótki — napisz, co się stało.",
  "string.max": `Powód jest za długi (najwyżej ${REASON_MAX} znaków).`,
});

// --- zapytania -------------------------------------------------------------

const stmtCardFor = db.prepare(`SELECT id FROM Times WHERE userID = ? AND data = ?`);
const stmtOwner = db.prepare(`SELECT id, name, surname, section, location FROM Users WHERE id = ?`);
const stmtById = db.prepare(`SELECT * FROM CardCorrections WHERE id = ?`);
const stmtPending = db.prepare(
  `SELECT id FROM CardCorrections WHERE userID = ? AND data = ? AND status = 'pending'`
);
const stmtInsert = db.prepare(`
  INSERT INTO CardCorrections (userID, data, startHm, endHm, open, reason,
                               beforeStart, beforeEnd, beforeStatus, status, createdAt)
  VALUES (@userID, @data, @startHm, @endHm, @open, @reason,
          @beforeStart, @beforeEnd, @beforeStatus, 'pending', @createdAt)`);
const stmtCancel = db.prepare(`
  UPDATE CardCorrections
     SET status = 'cancelled', decidedAt = @decidedAt
   WHERE id = @id AND userID = @userID AND status = 'pending'`);
const stmtDecide = db.prepare(`
  UPDATE CardCorrections
     SET status = @status, decidedAt = @decidedAt, decidedBy = @decidedBy,
         decidedByName = @decidedByName, decisionNote = @decisionNote
   WHERE id = @id AND status = 'pending'`);
const stmtDecider = db.prepare(`SELECT name, surname FROM Users WHERE id = ?`);
const stmtForUser = db.prepare(`
  SELECT * FROM CardCorrections WHERE userID = ? ORDER BY id DESC LIMIT 50`);

// Lista kierownika — oczekujące na górze, potem historia. Sekcje jak
// w services/getOvertimeRequests.js: zmienna długość listy, zapytania
// cache'owane per liczba sekcji.
const LIST_LIMIT = 200;
const listCache = new Map();
const listStatement = (count) => {
  if (!listCache.has(count)) {
    const sections = Array.from({ length: count }, (_, i) => `@sec${i}`).join(", ");
    listCache.set(
      count,
      db.prepare(`
        SELECT c.*, u.name, u.surname, u.section
          FROM CardCorrections c
          JOIN Users u ON u.id = c.userID
         WHERE u.section IN (${sections})
         ORDER BY (c.status = 'pending') DESC, c.id DESC
         LIMIT ${LIST_LIMIT}`)
    );
  }
  return listCache.get(count);
};

// --- prezentacja -----------------------------------------------------------

/**
 * Karta w kształcie do pokazania: godziny ścienne liczone NA SERWERZE,
 * w strefie aplikacji — przeglądarka dostaje gotowe "HH:MM" i nie musi
 * wiedzieć, w jakiej strefie zapisano znacznik.
 */
export const presentCard = (card) =>
  card
    ? {
        id: card.id,
        startHm: appTime(card.startTime),
        // Karta w toku ma w endTime PLAN (wejście + 8 h), nie wyjście.
        endHm: card.status === "finishWork" ? appTime(card.endTime) : null,
        open: card.status !== "finishWork",
        autoClosed: Boolean(card.autoClosed),
        totalWorkTime: card.totalWorkTime,
      }
    : null;

const present = (row) =>
  row && {
    ...row,
    open: Boolean(row.open),
    day: String(row.data).slice(0, 10),
    beforeStartHm: row.beforeStart ? appTime(row.beforeStart) : null,
    beforeEndHm: row.beforeStatus === "finishWork" && row.beforeEnd ? appTime(row.beforeEnd) : null,
    beforeOpen: Boolean(row.beforeStatus) && row.beforeStatus !== "finishWork",
  };

export const getCorrection = (id) => present(stmtById.get(Number(id)));

/** Dzisiejsza karta pracownika — do podpowiedzi w formularzu. */
export const getTodayCard = (userID) => {
  const found = stmtCardFor.get(Number(userID), todayStamp());
  return presentCard(found ? getCard(found.id) : null);
};

export const listForUser = (userID) => stmtForUser.all(Number(userID)).map(present);

/** @param {string[]} sections zasięg kierownika; pusta lista = nic */
export const listForManager = (sections) => {
  if (!Array.isArray(sections) || sections.length === 0) return [];
  const params = Object.fromEntries(sections.map((s, i) => [`sec${i}`, String(s)]));
  return listStatement(sections.length).all(params).map(present);
};

// --- złożenie --------------------------------------------------------------

export const createCorrection = ({ userID, start, end, open, reason }) => {
  const { value, error } = schema.validate(
    { start, end: end || undefined, open: open === true, reason },
    { abortEarly: true, convert: true }
  );
  if (error) fail("invalid", error.message);

  const data = todayStamp();
  const day = data.slice(0, 10);

  // Ta sama reguła, którą przejdzie zapis przy zatwierdzeniu. Wyjście z przyszłości
  // sprawdzamy dodatkowo: panel kierownika go nie blokuje (kierownik wpisuje
  // dzień, który już minął), a tutaj byłoby zgłoszeniem na zapas.
  const span = resolveCard(day, data, { start: value.start, end: value.end, open: value.open });
  if (!value.open && dayjs(span.endTime).isAfter(appNow())) {
    fail("bad_span", "Godzina wyjścia nie może być późniejsza niż teraz — jeśli wciąż pracujesz, zaznacz „praca jeszcze trwa”.");
  }

  if (stmtPending.get(Number(userID), data)) {
    fail("pending_exists", "Masz już zgłoszenie czekające na decyzję. Anuluj je, jeśli chcesz zgłosić inne godziny.");
  }

  const found = stmtCardFor.get(Number(userID), data);
  const card = found ? getCard(found.id) : null;
  const current = presentCard(card);

  if (
    current &&
    current.startHm === value.start &&
    current.open === value.open &&
    (value.open || current.endHm === value.end)
  ) {
    fail("no_change", "Karta ma już dokładnie te godziny — nie ma czego poprawiać.");
  }

  const info = stmtInsert.run({
    userID: Number(userID),
    data,
    startHm: value.start,
    endHm: value.open ? null : value.end,
    open: value.open ? 1 : 0,
    reason: value.reason,
    beforeStart: card?.startTime ?? null,
    beforeEnd: card?.endTime ?? null,
    beforeStatus: card?.status ?? null,
    createdAt: dayjs().format(),
  });

  return getCorrection(info.lastInsertRowid);
};

// --- anulowanie ------------------------------------------------------------

/** Tylko własne i tylko oczekujące — oba warunki w WHERE, nie w kodzie wołającym. */
export const cancelCorrection = ({ id, userID }) => {
  const info = stmtCancel.run({ id: Number(id), userID: Number(userID), decidedAt: dayjs().format() });
  return { changed: info.changes > 0, request: getCorrection(id) };
};

// --- decyzja ---------------------------------------------------------------

/**
 * Zmiana statusu i zapis karty w JEDNEJ transakcji. Jeżeli zapis karty się nie
 * uda (np. zgłoszenie "praca trwa" zatwierdzane po końcu doby), wyjątek cofa też
 * zmianę statusu — zgłoszenie zostaje oczekujące i kierownik może je odrzucić.
 *
 * Warunek status = 'pending' siedzi w UPDATE (jak w decideOvertimeRequest.js):
 * dwa równoległe kliknięcia nie zapiszą karty dwa razy.
 */
const decideTx = db.transaction(({ id, status, actor, decisionNote }) => {
  const decider = stmtDecider.get(Number(actor.userID));
  const info = stmtDecide.run({
    id: Number(id),
    status,
    decidedAt: dayjs().format(),
    decidedBy: Number(actor.userID),
    decidedByName: decider ? `${decider.name} ${decider.surname}` : actor.name ?? null,
    decisionNote: decisionNote || null,
  });
  if (info.changes === 0) return { changed: false };

  const row = stmtById.get(Number(id));
  if (status !== "approved") return { changed: true, request: present(row) };

  const found = stmtCardFor.get(row.userID, row.data);
  const before = found ? getCard(found.id) : null;
  const args = { start: row.startHm, end: row.endHm, open: Boolean(row.open) };

  let card;
  try {
    if (before) {
      card = correctCard({ id: before.id, ...args, actor });
    } else {
      const owner = stmtOwner.get(row.userID);
      if (!owner) fail("not_found", "Konto pracownika nie istnieje.");
      card = createCardForUser({ userID: row.userID, day: String(row.data).slice(0, 10), ...args, owner, actor });
    }
  } catch (error) {
    if (error.code === "not_today") {
      fail(
        "not_today",
        "Doba tego zgłoszenia już się skończyła, a karty w toku nie da się ustawić wstecz. Odrzuć zgłoszenie albo popraw kartę w Kartach czasu."
      );
    }
    throw error;
  }

  logInfo("cardCorrections", "zgłoszenie zatwierdzone", {
    correctionID: row.id,
    cardID: card.id,
    ownerID: row.userID,
    by: actor.userID,
  });

  return { changed: true, request: present(row), card, before };
});

/**
 * @param {{id: number, status: "approved"|"rejected", actor: {userID, name},
 *          decisionNote?: string}} payload
 * @returns {{changed: boolean, request?: object, card?: object, before?: object|null}}
 */
export const decideCorrection = (payload) => {
  if (payload.status !== "approved" && payload.status !== "rejected") throw new Error("bad_status");
  return decideTx(payload);
};
