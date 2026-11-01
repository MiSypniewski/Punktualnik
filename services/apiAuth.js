import { resolveApiKey, touchApiKey } from "./apiKeys";
import { consumeRate, noteAuthFailure } from "./apiRateLimit";
import { clientIp } from "./loginRateLimit";
import { withCurrentUser } from "./session";
import { canTrackTasks } from "./roles";
import { logApiError, logInfo, logWarn } from "./log";

// Wspólne wejście tras /api/v1.
//
// Klucz API działa WYŁĄCZNIE tutaj. getActiveToken (services/session.js) nie zna
// kluczy i ma ich nie poznać: to jedyna rzecz, która trzyma klucz z dala od kart
// czasu, urlopów, nadgodzin i kont. Trasy v1 nie czytają też ciasteczek, więc sesja
// przeglądarki nic tu nie daje i nie ma czego atakować przez CSRF.
//
// Nagłówków CORS nie ustawiamy celowo. Klucz nie powinien trafiać do JS na stronach.

const send401 = (res) => {
  res.setHeader("WWW-Authenticate", "Bearer");
  return res.status(401).json({ error: "invalid_api_key" });
};

const bearerToken = (req) => {
  const [type, value, extra] = String(req.headers.authorization ?? "").trim().split(/\s+/);
  return type === "Bearer" && value && !extra ? value : null;
};

const authenticate = (req, res) => {
  const result = resolveApiKey(bearerToken(req));
  if (result.ok && canTrackTasks(result.key.role)) return result.key;

  const ip = clientIp(req.headers);
  const reason = result.ok ? "role" : result.reason;
  const keyID = result.ok ? result.key.id : result.keyID;
  const failure = noteAuthFailure(ip);

  if (failure.blocked) {
    if (failure.firstBlock) logWarn("api", "limiter: za dużo nieudanych prób", { ip });
    res.setHeader("Retry-After", String(failure.retryAfterS));
    res.status(429).json({ error: "too_many_failures" });
    return null;
  }

  // Znany klucz, który przestał działać: tylko to warto czytać w logu. Tekst z nagłówka
  // nigdy tu nie trafia, bo nietrudno o klucz wklejony z literówką.
  if (keyID) logInfo("api", "odrzucony klucz", { keyID, reason, ip });
  send401(res);
  return null;
};

// Błąd z serwisu → status. `fail()` z services/taskEntries.js ustawia `code`, a Joi `isJoi`.
const CONFLICT_CODES = ["overlap", "already_running", "edit_window_closed"];

const sendServiceError = (res, error, context) => {
  const busy = String(error?.code ?? "") === "SQLITE_BUSY";
  // Przewidziane odmowy mają kod małymi literami ("overlap"). Reszta to awaria,
  // której treść nie może wyjść na zewnątrz: SQLITE_*, ERR_*, TypeError bez kodu.
  const internal = !error?.isJoi && !/^[a-z_]+$/.test(String(error?.code ?? ""));

  if (busy) {
    logApiError(context.scope, error, 503, context.extra);
    res.setHeader("Retry-After", "2");
    return res.status(503).json({ error: "busy" });
  }
  if (internal) {
    logApiError(context.scope, error, 500, context.extra);
    return res.status(500).json({ error: "server_error" });
  }

  const status = CONFLICT_CODES.includes(error.code) ? 409 : 422;
  logApiError(context.scope, error, status, context.extra);
  return res.status(status).json({ error: error.code || "invalid", message: error.message });
};

/**
 * @param {string} scope nazwa trasy do logu
 * @param {Object<string, {scope: string|null, handle: Function}>} methods
 *   `scope: null` oznacza trasę dostępną dla każdego ważnego klucza. Handler dostaje
 *   (req, res, { token, key }), gdzie `token` ma kształt tokenu sesji, więc
 *   projectScope i canUseProject działają bez zmian.
 */
export const apiRoute = (scope, methods) => async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  const key = authenticate(req, res);
  if (!key) return undefined;

  const route = methods[req.method];
  if (!route) {
    res.setHeader("Allow", Object.keys(methods).join(", "));
    return res.status(405).json({ error: "method_not_allowed" });
  }

  if (route.scope && !key.scopes.includes(route.scope)) {
    return res.status(403).json({ error: "insufficient_scope", required: route.scope });
  }

  const rate = consumeRate(key.userID, req.method === "GET" ? "read" : "write");
  if (!rate.ok) {
    res.setHeader("Retry-After", String(rate.retryAfterS));
    return res.status(429).json({ error: "rate_limited" });
  }

  // Next parsuje body według Content-Type. Bez application/json dostajemy tekst,
  // a destrukturyzacja napisu po cichu dałaby same undefined.
  if (typeof req.body === "string" && req.body.trim() !== "") {
    return res.status(415).json({ error: "json_required" });
  }
  if (Array.isArray(req.body)) {
    return res.status(400).json({ error: "bad_body" });
  }
  const body = req.body && typeof req.body === "object" ? req.body : {};

  touchApiKey(key);

  const token = withCurrentUser({ id: key.userID, userID: key.userID }, {
    name: key.userName,
    role: key.role,
    section: key.section,
    location: key.location,
  });

  try {
    return await route.handle(req, res, { token, key, body });
  } catch (error) {
    return sendServiceError(res, error, {
      scope,
      extra: { method: req.method, userID: key.userID, keyID: key.id },
    });
  }
};

/** Ślad po zmianie wpisu przez API. Bez opisu zadania: id wystarczą do odtworzenia. */
export const logApiWrite = (op, key, extra) => {
  logInfo("api", `[audit] ${op}`, { keyID: key.id, userID: key.userID, ...extra });
};
