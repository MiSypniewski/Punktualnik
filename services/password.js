import crypto from "crypto";
import { promisify } from "util";

// Jedno miejsce na parametry hasła. Wcześniej te same cztery liczby były
// przepisane w trzech serwisach i w scripts/admin.js — rozjazd w którymkolwiek
// z nich oznacza konto, do którego nie da się zalogować.
//
// PARAMETRÓW NIE WOLNO ZMIENIAĆ bez migracji: hash jest funkcją (hasło, sól,
// iteracje, długość, algorytm), więc każda zmiana unieważnia WSZYSTKIE istniejące
// hasła w bazie. `keylen` to 256 BAJTÓW (nie bitów) — przy SHA-512, które daje
// 64 B na blok, to cztery bloki, czyli ~8500 rund HMAC na jedno sprawdzenie.
export const PBKDF2_ITERATIONS = 2137;
export const PBKDF2_KEYLEN = 256;
export const PBKDF2_DIGEST = "sha512";
const SALT_BYTES = 256;

// Wariant ASYNCHRONICZNY, nie `pbkdf2Sync`. To nie jest kosmetyka: aplikacja chodzi
// jako jeden proces Node, a `pbkdf2Sync` liczy się na wątku głównym — przez ~8500
// rund HMAC-SHA512 nikt inny nie dostaje odpowiedzi. Wariant asynchroniczny idzie
// na threadpool libuv, więc logowanie kilku osób naraz nie zatrzymuje serwera.
const pbkdf2 = promisify(crypto.pbkdf2);

/** Hash hasła dla podanej soli. Zwraca hex, tak jak zapisy już leżące w bazie. */
export const hashPassword = async (password, salt) => {
  const key = await pbkdf2(password, salt, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST);
  return key.toString("hex");
};

/** Nowa sól dla nowego hasła. */
export const makeSalt = () => crypto.randomBytes(SALT_BYTES).toString("hex");

/**
 * Porównanie w czasie stałym. Zwykłe `===` na stringach kończy się na pierwszym
 * różnym znaku, co teoretycznie zdradza, ile początkowych bajtów się zgadza.
 * Przy 512 znakach hex i zdalnym pomiarze to atak akademicki, ale koszt obrony
 * jest zerowy.
 */
export const hashesEqual = (a, b) => {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
};
