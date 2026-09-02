import crypto from "node:crypto";
import { promisify } from "util";
import PW from "./passwordParams.cjs";

// Parametry siedzą w passwordParams.cjs — TAM są liczby i tam jest wyjaśnienie,
// skąd się wzięły. Ten plik odpowiada wyłącznie za liczenie i porównywanie.
// Rozszerzenie .cjs w imporcie wyżej jest obowiązkowe (patrz komentarz w tamtym
// pliku); dzięki temu te same parametry czyta ESM-owa aplikacja i CommonJS-owy
// scripts/admin.js, zamiast mieć je przepisane w dwóch miejscach.
export const { CURRENT_PARAMS, LEGACY_PARAMS } = PW;

// Wariant ASYNCHRONICZNY, nie `pbkdf2Sync`. To nie jest kosmetyka: aplikacja chodzi
// jako jeden proces Node, a `pbkdf2Sync` liczy się na wątku głównym — przez cały
// czas liczenia nikt inny nie dostaje odpowiedzi. Wariant asynchroniczny idzie na
// threadpool libuv, więc logowanie kilku osób naraz nie zatrzymuje serwera.
// Po podniesieniu iteracji do 210 000 to już nie jest teoria: hash kosztuje setki
// milisekund, nie jedną.
const pbkdf2 = promisify(crypto.pbkdf2);

/**
 * Hash hasła dla podanej soli i PODANYCH parametrów. Zwraca hex, tak jak zapisy
 * już leżące w bazie.
 *
 * Trzeci argument to cała istota wersjonowania: wiersz zapisany starymi
 * parametrami MUSI być weryfikowany starymi parametrami, bo hash jest funkcją
 * (hasło, sól, iteracje, długość, algorytm). Domyślnie liczymy bieżącymi.
 *
 * UWAGA NA SÓL: idzie do `crypto.pbkdf2` jako NAPIS heksadecymalny, nie jako
 * Buffer. Node bierze wtedy jego bajty UTF-8 — i tak policzono wszystkie hashe
 * w bazie. "Poprawienie" tego na Buffer.from(salt, "hex") unieważniłoby komplet
 * haseł wszystkich użytkowników.
 */
export const hashPassword = async (password, salt, params = PW.CURRENT_PARAMS) => {
  const { iterations, keylen, digest } = PW.parseParams(params);
  const key = await pbkdf2(password, salt, iterations, keylen, digest);
  return key.toString("hex");
};

/** Nowa sól dla nowego hasła. */
export const makeSalt = () => crypto.randomBytes(PW.SALT_BYTES).toString("hex");

/**
 * Komplet do zapisu: hash, sól i parametry, którymi go policzono.
 *
 * JEDYNA droga zapisu hasła do bazy. Gdyby serwisy dalej składały to same
 * z hashPassword + makeSalt, dałoby się zapisać hash BEZ parametrów — czyli
 * wiersz, którego przy następnej zmianie parametrów nie da się już zweryfikować.
 * Ta funkcja sprawia, że taki błąd jest niemożliwy do popełnienia.
 */
export const makePasswordRecord = async (password) => {
  const passwordSalt = makeSalt();
  const passwordHash = await hashPassword(password, passwordSalt, PW.CURRENT_PARAMS);
  return { passwordHash, passwordSalt, passwordParams: PW.CURRENT_PARAMS };
};

/**
 * Porównanie w czasie stałym. Zwykłe `===` na stringach kończy się na pierwszym
 * różnym znaku, co teoretycznie zdradza, ile początkowych bajtów się zgadza.
 * Przy zdalnym pomiarze to atak akademicki, ale koszt obrony jest zerowy.
 */
export const hashesEqual = (a, b) => {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
};

/**
 * Weryfikacja hasła wobec wiersza z bazy — w JEGO WŁASNYCH parametrach.
 * Wiersz musi mieć passwordHash, passwordSalt i passwordParams.
 */
export const verifyPassword = async (password, row) => {
  const hash = await hashPassword(password, row.passwordSalt, row.passwordParams);
  return hashesEqual(hash, row.passwordHash);
};

/**
 * Czy hasło w tym wierszu jest policzone nieaktualnymi parametrami i wymaga
 * przeliczenia przy najbliższym udanym logowaniu.
 *
 * Porównanie napisów, bez parsowania — to jest w gorącej ścieżce logowania,
 * a format `pbkdf2-sha512:210000:64` jest kanoniczny, bo składa go zawsze
 * formatParams, nigdy człowiek.
 */
export const isStalePassword = (paramsValue) => {
  const current = paramsValue == null || paramsValue === "" ? PW.LEGACY_PARAMS : String(paramsValue);
  return current !== PW.CURRENT_PARAMS;
};
