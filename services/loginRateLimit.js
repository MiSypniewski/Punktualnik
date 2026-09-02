import crypto from "node:crypto";
import { logInfo, logWarn } from "./log";

/**
 * Limit nieudanych prób logowania.
 *
 * Po co: do tej pory endpoint logowania nie miał ŻADNEGO hamulca — ani licznika,
 * ani blokady, ani nawet wpisu w logu, więc zgadywanie haseł nie zostawiało śladu.
 * Przy 100 kontach to 100 celów. Drugi powód jest świeższy: hash kosztuje teraz
 * ~25x więcej procesora niż przed podniesieniem iteracji, co bez limitera robi
 * z formularza logowania tanie narzędzie DoS na proces, który jest JEDEN i ma
 * czterowątkowy threadpool. Limiter nie jest dodatkiem do tamtej zmiany — jest
 * jej warunkiem.
 *
 * Rachunek, dla którego to wystarcza: żeby zmusić serwer do policzenia PBKDF2,
 * trzeba podać ISTNIEJĄCY adres (authorizeUser nie liczy hasha dla nieznanego
 * konta). Każdy adres ma 5 prób na 15 minut, więc przy 100 kontach sufit wynosi
 * 500 hashy / 15 min = 0,55/s, czyli kilka procent rdzenia. Ten sufit NIE zależy
 * od IP, więc nie da się go obejść podrabianiem nagłówków.
 *
 * Stan siedzi w pamięci procesu, nie w SQLite. `better-sqlite3` jest synchroniczne
 * i liczy się na wątku głównym; zapis przy każdej nieudanej próbie to kolizje
 * o blokadę zapisu, czyli dokładnie mechanizm, który 21.08.2026 położył aplikację.
 * Przy pm2 `instances: 1` licznik w pamięci jest poprawny, a jego ulotność przy
 * restarcie w scenariuszu "ktoś złośliwie blokuje cudze konto" jest zaletą.
 */

// Progi. E-mail chroni konto, IP chroni serwer.
const EMAIL_MAX_FAILURES = 5;
// Wysoki świadomie: całe biuro siedzi za jednym NAT-em, więc niski próg per IP
// odciąłby wszystkich naraz. To warstwa na przeciwnika, który się nie stara —
// obroną właściwą jest kubełek e-mailowy.
const IP_MAX_FAILURES = 30;

const WINDOW_MS = 15 * 60 * 1000;
const BLOCK_MS = 15 * 60 * 1000;

// Górne granice map. Wpis to ~200 B, więc 2000 + 5000 kluczy ≈ 1,4 MB. Ta liczba
// musi być wyliczona, a nie "pewnie się zmieści": kontener ma 1 GB i ZERO swapu,
// a rotacja adresów IP byłaby inaczej wektorem na pamięć (zmierzone: 50 000
// wpisów = 16 MB sterty).
const MAX_EMAIL_KEYS = 2000;
const MAX_IP_KEYS = 5000;

const SWEEP_EVERY_MS = 60 * 1000;

// Stan na `globalThis`, nie w zmiennej modułu — z tego samego powodu, dla którego
// tam siedzi połączenie do bazy (patrz globalForDb w services/db.js): Next 12
// buduje dwa niezależne runtime'y webpacka, więc ten moduł wykonuje się w procesie
// więcej niż raz, a licznik ma być JEDEN.
const globalForLimiter = globalThis;

const state = globalForLimiter.__punktualnikLoginLimiter || {
  byEmail: new Map(),
  byIp: new Map(),
  lastSweep: 0,
  lastOverflowWarn: 0,
};
globalForLimiter.__punktualnikLoginLimiter = state;

/**
 * Adres klienta z nagłówków.
 *
 * WAŻNE OGRANICZENIE: `authorize` w next-auth dostaje wyłącznie { query, body,
 * headers, method } (node_modules/next-auth/core/routes/callback.js) — nie ma tam
 * gniazda, więc `socket.remoteAddress` jest niedostępne. IP pochodzi zatem TYLKO
 * z nagłówków, czyli jest podrabialne. Cały ciężar obrony spoczywa na kubełku
 * e-mailowym; kubełek IP to warstwa dodatkowa.
 *
 * Kolejność nie jest przypadkowa: rekordami domeny zarządza Cloudflare (README,
 * "DNS"), a `cf-connecting-ip` wstawia Cloudflare NADPISUJĄC to, co podał klient.
 *
 * @returns {string|null} null = nie da się ustalić, wtedy kubełek IP pomijamy
 */
export const clientIp = (headers) => {
  if (!headers) return null;
  const pick = (name) => {
    const value = headers[name];
    if (!value) return null;
    const first = String(Array.isArray(value) ? value[0] : value).split(",")[0].trim();
    return first || null;
  };
  return pick("cf-connecting-ip") || pick("x-real-ip") || pick("x-forwarded-for");
};

/**
 * Klucze kubełków dla jednej próby logowania.
 *
 * E-mail jest znormalizowany: bez tego `Jan@x.pl` i `jan@X.pl` to dwa osobne
 * kubełki, a budżet prób mnożyłby się przez liczbę wariantów pisowni. Dotyczy to
 * WYŁĄCZNIE klucza limitera — zapytania `WHERE email = ?` nie ruszamy.
 */
export const loginKeys = (email, headers) => ({
  email: String(email || "").trim().toLowerCase() || null,
  ip: clientIp(headers),
});

/** Skrót adresu do logu — pozwala skorelować próby bez zapisywania e-maila. */
const emailTag = (email) => (email ? crypto.createHash("sha256").update(email).digest("hex").slice(0, 8) : null);

/** Usuwa wpisy, których okno i blokada już wygasły. Doczepione do zapisu. */
const sweep = (now) => {
  if (now - state.lastSweep < SWEEP_EVERY_MS) return;
  state.lastSweep = now;

  // Bez setInterval: w nocy nikt się nie loguje i nic nie ma prawa chodzić.
  // Timer musiałby mieć unref(), a przy dwóch runtime'ach webpacka zdublowałby się.
  for (const map of [state.byEmail, state.byIp]) {
    for (const [key, entry] of map) {
      if (now - entry.lastAt > WINDOW_MS && now >= entry.blockedUntil) {
        map.delete(key);
      }
    }
  }
};

const bucketFor = (map, key, limit, now) => {
  const existing = map.get(key);
  if (existing) return existing;

  if (map.size >= limit) {
    sweep(now);
    state.lastSweep = 0; // przemiatanie awaryjne nie może zablokować następnego
  }
  if (map.size >= limit) {
    // Fail-open dla tego klucza. Przepełniona mapa nie może zamienić się w awarię
    // logowania dla wszystkich — wolimy stracić limit niż wpuścić DoS na dostępność.
    if (now - state.lastOverflowWarn > SWEEP_EVERY_MS) {
      state.lastOverflowWarn = now;
      logWarn("login", "limiter: mapa pełna, przepuszczam bez limitu", { keys: map.size });
    }
    return null;
  }

  const fresh = { failures: 0, firstAt: now, lastAt: now, blockedUntil: 0 };
  map.set(key, fresh);
  return fresh;
};

/**
 * Czy tę próbę wolno w ogóle podjąć. Wołane PRZED odczytem konta i przed hashem.
 * @returns {{ok: true} | {ok: false, scope: "email"|"ip", retryAfterMs: number}}
 */
export const checkLogin = (keys) => {
  const now = Date.now();
  sweep(now);

  for (const [scope, map, key] of [
    ["email", state.byEmail, keys.email],
    ["ip", state.byIp, keys.ip],
  ]) {
    if (!key) continue;
    const entry = map.get(key);
    if (entry && now < entry.blockedUntil) {
      return { ok: false, scope, retryAfterMs: entry.blockedUntil - now };
    }
  }

  return { ok: true };
};

/**
 * Nieudana próba.
 *
 * Liczymy ją także wtedy, gdy adres w ogóle nie istnieje w bazie — i to nie jest
 * szczegół implementacyjny, tylko warunek, pod którym osobny komunikat
 * "za dużo prób" NIE jest wyrocznią enumeracyjną. Gdyby porażki dla nieznanych
 * adresów przestały tu wpadać, komunikat natychmiast zacząłby zdradzać, które
 * konta istnieją. Nie zmieniać bez przeczytania komentarza przy ERROR_MESSAGES
 * w pages/users/signin.js.
 */
export const noteFailure = (keys) => {
  const now = Date.now();
  sweep(now);

  for (const [scope, map, key, limit, max] of [
    ["email", state.byEmail, keys.email, MAX_EMAIL_KEYS, EMAIL_MAX_FAILURES],
    ["ip", state.byIp, keys.ip, MAX_IP_KEYS, IP_MAX_FAILURES],
  ]) {
    if (!key) continue;
    const entry = bucketFor(map, key, limit, now);
    if (!entry) continue;

    // Okno przesuwa się skokowo: pierwsza próba po przerwie dłuższej niż okno
    // zaczyna liczenie od zera.
    if (now - entry.firstAt > WINDOW_MS) {
      entry.failures = 0;
      entry.firstAt = now;
    }

    entry.failures += 1;
    entry.lastAt = now;

    if (entry.failures >= max && now >= entry.blockedUntil) {
      entry.blockedUntil = now + BLOCK_MS;
      logWarn("login", "limiter: blokada", {
        scope,
        emailTag: scope === "email" ? emailTag(keys.email) : undefined,
        ip: scope === "ip" ? key : keys.ip,
        failures: entry.failures,
        blockS: Math.round(BLOCK_MS / 1000),
      });
    }
  }
};

/** Udane logowanie kasuje liczniki — pomyłka sprzed chwili nie ma ciągnąć się dalej. */
export const noteSuccess = (keys) => {
  if (keys.email) state.byEmail.delete(keys.email);
  if (keys.ip) state.byIp.delete(keys.ip);
};

/** Wpis do logu przy odbiciu — osobno, bo checkLogin bywa wołane bez skutków ubocznych. */
export const noteBlocked = (keys, blocked) => {
  logInfo("login", "próba odbita przez limiter", {
    scope: blocked.scope,
    emailTag: emailTag(keys.email),
    ip: keys.ip,
    retryS: Math.round(blocked.retryAfterMs / 1000),
  });
};

/** Podgląd dla /api/health — bez tego kontrola wielkości map sprowadza się do wiary. */
export const loginLimiterStats = () => {
  const now = Date.now();
  const blocked = (map) => {
    let n = 0;
    for (const entry of map.values()) if (now < entry.blockedUntil) n += 1;
    return n;
  };
  return {
    emails: state.byEmail.size,
    ips: state.byIp.size,
    blockedEmails: blocked(state.byEmail),
    blockedIps: blocked(state.byIp),
  };
};
