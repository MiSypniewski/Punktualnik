import crypto from "node:crypto";
import Joi from "joi";
import db, { DEFAULT_BUSY_MS } from "./db";
import { now as appNow, toStamp, TS_FORMAT } from "./workday";
import { logWarn } from "./log";
import { API_SCOPES, API_KEY_DAYS, API_KEY_DEFAULT_DAYS, API_KEY_MAX_ACTIVE } from "../utils/apiScopes";

// Klucze API: tworzenie, lista, odwołanie i odczyt przy uwierzytelnianiu.
//
// Sam klucz istnieje wyłącznie w odpowiedzi na żądanie, które go utworzyło. W bazie
// zostaje skrót i krótki prefiks, po którym człowiek rozpozna klucz na liście.
// Decyzję o tym, co klucz może, podejmuje services/apiAuth.js.

const TOKEN_PREFIX = "pnk_";
// 32 bajty w base64url to dokładnie 43 znaki.
const TOKEN_RE = /^pnk_[A-Za-z0-9_-]{43}$/;
const PREFIX_LENGTH = TOKEN_PREFIX.length + 8;

export const isTokenFormat = (value) => TOKEN_RE.test(String(value ?? ""));

const hashToken = (token) => crypto.createHash("sha256").update(token).digest("hex");

const fail = (code, message) => {
  const err = new Error(message);
  err.code = code;
  throw err;
};

const createSchema = Joi.object({
  name: Joi.string().trim().min(1).max(60).required().messages({
    "string.empty": "Podaj nazwę klucza.",
    "any.required": "Podaj nazwę klucza.",
    "string.max": "Nazwa klucza może mieć najwyżej 60 znaków.",
  }),
  scopes: Joi.array()
    .items(Joi.string().valid(...API_SCOPES))
    .min(1)
    .unique()
    .required()
    .messages({
      "array.min": "Wybierz co najmniej jedno uprawnienie.",
      "any.required": "Wybierz co najmniej jedno uprawnienie.",
    }),
  days: Joi.number()
    .integer()
    .valid(...API_KEY_DAYS)
    .default(API_KEY_DEFAULT_DAYS),
});

const stmtCountActive = db.prepare(`
  SELECT COUNT(*) AS n FROM ApiKeys
   WHERE userID = @userID AND revokedAt IS NULL
     AND expiresAt > @now AND sessionVersion = @sessionVersion`);

const stmtInsert = db.prepare(`
  INSERT INTO ApiKeys (userID, name, tokenHash, prefix, scopes, sessionVersion, createdAt, expiresAt)
  VALUES (@userID, @name, @tokenHash, @prefix, @scopes, @sessionVersion, @createdAt, @expiresAt)`);

const stmtListForUser = db.prepare(`
  SELECT id, name, prefix, scopes, sessionVersion, createdAt, expiresAt, lastUsedAt, revokedAt
    FROM ApiKeys WHERE userID = ? ORDER BY id DESC LIMIT 50`);

const stmtRevoke = db.prepare(`
  UPDATE ApiKeys SET revokedAt = @now WHERE id = @id AND userID = @userID AND revokedAt IS NULL`);

const stmtFindByHash = db.prepare(`
  SELECT k.id, k.userID, k.name, k.scopes, k.sessionVersion, k.expiresAt, k.lastUsedAt, k.revokedAt,
         u.name AS userName, u.role, u.section, u.location, u.isActive,
         u.sessionVersion AS userSessionVersion
    FROM ApiKeys k
    JOIN Users u ON u.id = k.userID
   WHERE k.tokenHash = ?`);

const stmtTouch = db.prepare(`UPDATE ApiKeys SET lastUsedAt = @now WHERE id = @id`);

const statusOf = (row, sessionVersion, nowStamp) => {
  if (row.revokedAt) return "revoked";
  if (Number(row.sessionVersion) !== Number(sessionVersion)) return "invalidated";
  if (row.expiresAt <= nowStamp) return "expired";
  return "active";
};

const toPublic = (row, sessionVersion, nowStamp) => ({
  id: row.id,
  name: row.name,
  prefix: row.prefix,
  scopes: row.scopes.split(","),
  createdAt: row.createdAt,
  expiresAt: row.expiresAt,
  lastUsedAt: row.lastUsedAt,
  revokedAt: row.revokedAt,
  status: statusOf(row, sessionVersion, nowStamp),
});

/** Klucze konta bez sekretów, także nieaktywne: to ślad, co i kiedy wydano. */
export const listApiKeys = (user, now = appNow()) => {
  const nowStamp = toStamp(now);
  return stmtListForUser.all(Number(user.id)).map((r) => toPublic(r, user.sessionVersion, nowStamp));
};

/**
 * @param {{name: string, scopes: string[], days?: number}} payload
 * @param {{id: number, sessionVersion: number}} user
 * @returns {{key: object, token: string}} `token` nigdy więcej nie będzie dostępny
 */
export const createApiKey = (payload, user, now = appNow()) => {
  const { name, scopes, days } = Joi.attempt(payload, createSchema);

  const token = `${TOKEN_PREFIX}${crypto.randomBytes(32).toString("base64url")}`;
  const nowStamp = toStamp(now);

  const row = {
    userID: Number(user.id),
    name,
    tokenHash: hashToken(token),
    prefix: token.slice(0, PREFIX_LENGTH),
    scopes: scopes.join(","),
    sessionVersion: Number(user.sessionVersion),
    createdAt: nowStamp,
    expiresAt: now.add(days, "day").format(TS_FORMAT),
  };

  // Licznik i zapis w jednej transakcji, żeby dwa równoległe żądania nie przeszły
  // przez limit razem.
  const id = db
    .transaction(() => {
      const { n } = stmtCountActive.get({
        userID: row.userID,
        now: nowStamp,
        sessionVersion: row.sessionVersion,
      });
      if (n >= API_KEY_MAX_ACTIVE) {
        fail("too_many_keys", `Możesz mieć najwyżej ${API_KEY_MAX_ACTIVE} aktywnych kluczy. Odwołaj nieużywany.`);
      }
      return stmtInsert.run(row).lastInsertRowid;
    })
    .immediate();

  return {
    token,
    key: toPublic({ ...row, id, lastUsedAt: null, revokedAt: null }, user.sessionVersion, nowStamp),
  };
};

/** Warunek właściciela siedzi w SQL, więc cudzego klucza nie da się odwołać. */
export const revokeApiKey = ({ id, userID }, now = appNow()) =>
  stmtRevoke.run({ id: Number(id), userID: Number(userID), now: toStamp(now) }).changes > 0;

/**
 * Klucz wraz z kontem, jeśli może działać.
 * @returns {{ok: true, key: object} | {ok: false, reason: string, keyID?: number}}
 */
export const resolveApiKey = (token, now = appNow()) => {
  if (!isTokenFormat(token)) return { ok: false, reason: "bad_format" };

  const row = stmtFindByHash.get(hashToken(token));
  if (!row) return { ok: false, reason: "unknown" };

  const status = statusOf(row, row.userSessionVersion, toStamp(now));
  if (status !== "active") return { ok: false, reason: status, keyID: row.id };
  if (!row.isActive) return { ok: false, reason: "user_inactive", keyID: row.id };

  return { ok: true, key: { ...row, scopes: row.scopes.split(",") } };
};

// Zapis lastUsedAt jest niepilny, a better-sqlite3 czeka na blokadę synchronicznie,
// więc zapis przy każdym żądaniu zamrażałby cały proces przy kolizji z kioskiem
// (README, "Kiedy aplikacja muli"). Stąd dławik, krótki busy_timeout i brak wyjątku.
//
// Dławik na globalThis z tego samego powodu co w services/taskEntries.js. Wpisów jest
// tyle, ile używanych kluczy, bo trafiają tu wyłącznie klucze po weryfikacji.
const TOUCH_EVERY_MS = 5 * 60 * 1000;
const TOUCH_BUSY_MS = 250;
const globalForKeys = globalThis;
const lastTouch = globalForKeys.__punktualnikApiKeyTouch || new Map();
globalForKeys.__punktualnikApiKeyTouch = lastTouch;

export const touchApiKey = (key, now = appNow()) => {
  const nowMs = Date.now();
  if (nowMs - (lastTouch.get(key.id) ?? 0) < TOUCH_EVERY_MS) return;
  lastTouch.set(key.id, nowMs);

  // Po restarcie procesu mapa jest pusta, a wiersz może być świeży.
  if (key.lastUsedAt && key.lastUsedAt > toStamp(now.subtract(TOUCH_EVERY_MS, "millisecond"))) return;

  db.pragma(`busy_timeout = ${TOUCH_BUSY_MS}`);
  try {
    stmtTouch.run({ id: key.id, now: toStamp(now) });
  } catch (error) {
    logWarn("apiKeys", "lastUsedAt pominięte (baza zajęta)", { code: error.code, keyID: key.id });
  } finally {
    db.pragma(`busy_timeout = ${DEFAULT_BUSY_MS}`);
  }
};
