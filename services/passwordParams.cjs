/**
 * Parametry hashowania haseł — JEDYNE miejsce, w którym te liczby występują.
 *
 * Po co osobny plik i po co CommonJS: `services/password.js` używa składni ESM,
 * ale w package.json nie ma "type": "module", więc dla samego Node te pliki są
 * niewykonalne poza webpackiem. Dlatego `scripts/admin.js` (zwykły skrypt CJS,
 * odpalany ręcznie na serwerze, często na bazie, której aplikacja jeszcze nie
 * otwierała) do dziś miał te same cztery liczby PRZEPISANE u siebie. Rozjazd
 * w którymkolwiek z tych miejsc to konto, do którego nie da się zalogować,
 * wykrywane dopiero przez użytkownika.
 *
 * Ten plik czytają OBIE strony bez żadnego interop:
 *   scripts/admin.js:      const PW = require("../services/passwordParams.cjs");
 *   services/password.js:  import PW from "./passwordParams.cjs";
 *
 * ROZSZERZENIE .cjs W IMPORCIE JEST OBOWIĄZKOWE. Next 12 przepuszcza .cjs przez
 * loader (webpack-config.js: test /\.(tsx|ts|js|cjs|mjs|jsx)$/), ale nie ma go
 * w resolve.extensions dla serwera (tam są tylko .js, .json, .node) — bez
 * rozszerzenia build padnie z "Module not found". Głośno, czyli dobrze.
 */

// ILE ITERACJI. OWASP zaleca dla PBKDF2-HMAC-SHA512 ~210 000. Poprzednia wartość
// (2137) była ~25x za niska: przy keylen 256 B to cztery bloki SHA-512, czyli
// ~8500 rund HMAC na sprawdzenie.
//
// LICZBA DO SKALIBROWANIA NA DOCELOWEJ MASZYNIE. Pomiar na Mikrusie:
//
//   node -e 'const c=require("crypto");
//     for (const n of [100000,150000,210000]) {
//       const t=process.hrtime.bigint();
//       c.pbkdf2Sync("test","0123456789abcdef",n,64,"sha512");
//       console.log(n, Number(process.hrtime.bigint()-t)/1e6|0, "ms");
//     }'
//
// Kryterium: jeden hash <= 200 ms. Powyżej — zejść do 120 000, co i tak jest
// ~14x więcej pracy niż stan sprzed tej zmiany. Wynik pomiaru wraz z datą wpisać
// niżej, żeby następna osoba nie zgadywała, skąd ta liczba.
//
// Zmierzone: (jeszcze nie zmierzono na produkcji — patrz README, "Hasła")
const PBKDF2_ITERATIONS = 210000;

// BAJTY, nie bity. 64 B to dokładnie jeden blok SHA-512, czyli jedno przejście
// pętli PBKDF2. Poprzednie 256 B kazało liczyć cztery bloki — czterokrotny koszt
// bez żadnego zysku, bo o sile decydują iteracje, a nie długość wyniku.
const PBKDF2_KEYLEN = 64;

const PBKDF2_DIGEST = "sha512";

// 128 bitów. Sól ma być UNIKALNA, nie tajna — jej jedyne zadanie to sprawić, żeby
// dwa takie same hasła dały różne hashe i żeby nie dało się użyć tęczowych tablic.
// Poprzednie 256 B nie dawało nic ponad to, a zajmowało 512 znaków na wiersz.
const SALT_BYTES = 16;

/** Napis do kolumny Users.passwordParams. */
const formatParams = ({ digest, iterations, keylen }) => `pbkdf2-${digest}:${iterations}:${keylen}`;

// SKŁADANY z powyższych, nigdy wpisywany ręcznie — inaczej wracamy dokładnie do
// rozjazdu, dla którego ten plik powstał.
const CURRENT_PARAMS = formatParams({
  digest: PBKDF2_DIGEST,
  iterations: PBKDF2_ITERATIONS,
  keylen: PBKDF2_KEYLEN,
});

// ZAMROŻONE NA ZAWSZE. To nie jest parametr do strojenia, tylko zapis faktu
// historycznego: tak policzono hasła leżące w bazie przed tą zmianą. Wolno to
// usunąć dopiero, gdy `npm run admin -- passwd-audit` nie pokazuje ANI JEDNEGO
// konta — czyli gdy wszyscy się przelogowali.
const LEGACY_PARAMS = "pbkdf2-sha512:2137:256";

// Dwukropek zamiast '$' z konwencji PHC ($pbkdf2-sha512$210000$64) świadomie:
// tę bazę obsługuje się jednolinijkowcami sqlite3 przez SSH, a bash w podwójnych
// cudzysłowach rozwinie $210000 do pustego parametru pozycyjnego. Komenda
// diagnostyczna po cichu zwróciłaby zły wynik — i to akurat w chwili, w której
// sprawdzamy, czy migracja nie zepsuła logowania. Dwukropek nie jest specjalny
// ani w shellu, ani w literale szablonowym JS-a.

const KNOWN_DIGESTS = new Set(["sha512", "sha256"]);

/**
 * Parametry, którymi policzono hash W DANYM WIERSZU. Pusto/NULL = wiersz sprzed
 * migracji (kolumny wtedy nie było).
 *
 * Rzuca, a nie zwraca null: nierozpoznawalna wartość to USZKODZONY WIERSZ, czyli
 * nasza awaria. Cicha zamiana na "złe hasło" wysłałaby użytkownika w ślepy zaułek
 * sprawdzania hasła, które jest poprawne — ten sam powód, dla którego
 * authorizeUser rzuca przy błędzie bazy zamiast zwracać null.
 *
 * @returns {{digest: string, iterations: number, keylen: number}}
 */
const parseParams = (value) => {
  const raw = value == null || value === "" ? LEGACY_PARAMS : String(value);
  const match = /^pbkdf2-([a-z0-9]+):(\d+):(\d+)$/.exec(raw);

  if (!match) {
    throw new Error("bad_password_params");
  }

  const [, digest, iterations, keylen] = match;

  // Zakresy, nie dla ozdoby: `crypto.pbkdf2` z liczbą iteracji wziętą wprost
  // z bazy to miejsce, w którym uszkodzony wiersz mógłby zamrozić wątek
  // threadpoola na minuty.
  if (!KNOWN_DIGESTS.has(digest)) throw new Error("bad_password_params");
  if (Number(iterations) < 1000 || Number(iterations) > 10_000_000) throw new Error("bad_password_params");
  if (Number(keylen) < 16 || Number(keylen) > 256) throw new Error("bad_password_params");

  return { digest, iterations: Number(iterations), keylen: Number(keylen) };
};

module.exports = {
  PBKDF2_ITERATIONS,
  PBKDF2_KEYLEN,
  PBKDF2_DIGEST,
  SALT_BYTES,
  CURRENT_PARAMS,
  LEGACY_PARAMS,
  formatParams,
  parseParams,
};
