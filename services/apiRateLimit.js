import { logWarn } from "./log";

// Limity API w pamięci procesu, według wzoru z services/loginRateLimit.js: bez
// zapisów do SQLite, stan na globalThis (dwa runtime'y webpacka) i mapy z górną
// granicą, bo kontener ma 1 GB bez swapu.
//
// Liczymy na UŻYTKOWNIKA, nie na klucz. Inaczej pięć kluczy dawałoby pięć limitów.

const WINDOW_MS = 60 * 1000;
const LIMITS = { read: 120, write: 30 };

// Odgadnięcie klucza 256-bitowego jest niewykonalne, więc ten próg nie broni kont.
// Ucisza wyłącznie zalew logu nieudanymi próbami. Poprawny klucz przechodzi nawet
// z zablokowanego adresu: biuro siedzi za jednym NAT-em, a jeden skrypt z wygasłym
// kluczem nie może odciąć API wszystkim.
const FAILURE_WINDOW_MS = 15 * 60 * 1000;
const FAILURE_MAX = 60;

const MAX_USER_KEYS = 1000;
const MAX_IP_KEYS = 5000;
const SWEEP_EVERY_MS = 60 * 1000;

const globalForLimiter = globalThis;
const state = globalForLimiter.__punktualnikApiLimiter || {
  byUser: new Map(),
  failures: new Map(),
  lastSweep: 0,
  lastOverflowWarn: 0,
};
globalForLimiter.__punktualnikApiLimiter = state;

const sweep = (now) => {
  if (now - state.lastSweep < SWEEP_EVERY_MS) return;
  state.lastSweep = now;
  for (const [key, entry] of state.byUser) {
    if (now - entry.startedAt >= WINDOW_MS) state.byUser.delete(key);
  }
  for (const [key, entry] of state.failures) {
    if (now - entry.startedAt >= FAILURE_WINDOW_MS) state.failures.delete(key);
  }
};

const warnOverflow = (now, map) => {
  if (now - state.lastOverflowWarn < SWEEP_EVERY_MS) return;
  state.lastOverflowWarn = now;
  logWarn("api", "limiter: mapa pełna, przepuszczam bez limitu", { keys: map.size });
};

/**
 * Jedno żądanie z poprawnym kluczem.
 * @param {"read"|"write"} kind
 * @returns {{ok: true} | {ok: false, retryAfterS: number}}
 */
export const consumeRate = (userID, kind) => {
  const now = Date.now();
  sweep(now);

  const key = `${userID}:${kind}`;
  let entry = state.byUser.get(key);
  if (!entry || now - entry.startedAt >= WINDOW_MS) {
    if (!entry && state.byUser.size >= MAX_USER_KEYS) {
      warnOverflow(now, state.byUser);
      return { ok: true };
    }
    entry = { startedAt: now, count: 0 };
    state.byUser.set(key, entry);
  }

  entry.count += 1;
  if (entry.count > LIMITS[kind]) {
    return { ok: false, retryAfterS: Math.max(1, Math.ceil((entry.startedAt + WINDOW_MS - now) / 1000)) };
  }
  return { ok: true };
};

/**
 * Nieudane uwierzytelnienie.
 * @returns {{blocked: boolean, firstBlock: boolean, retryAfterS: number}}
 */
export const noteAuthFailure = (ip) => {
  if (!ip) return { blocked: false, firstBlock: false, retryAfterS: 0 };

  const now = Date.now();
  sweep(now);

  let entry = state.failures.get(ip);
  if (!entry || now - entry.startedAt >= FAILURE_WINDOW_MS) {
    if (!entry && state.failures.size >= MAX_IP_KEYS) {
      warnOverflow(now, state.failures);
      return { blocked: false, firstBlock: false, retryAfterS: 0 };
    }
    entry = { startedAt: now, count: 0 };
    state.failures.set(ip, entry);
  }

  entry.count += 1;
  return {
    blocked: entry.count > FAILURE_MAX,
    firstBlock: entry.count === FAILURE_MAX + 1,
    retryAfterS: Math.max(1, Math.ceil((entry.startedAt + FAILURE_WINDOW_MS - now) / 1000)),
  };
};

/** Podgląd dla /api/health. */
export const apiLimiterStats = () => ({
  users: state.byUser.size,
  failingIps: state.failures.size,
});
