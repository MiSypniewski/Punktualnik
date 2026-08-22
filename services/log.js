// Minimalny logger serwerowy — zero zależności.
//
// Powstał po awarii z 21.08.2026, kiedy okazało się, że aplikacja nie zostawia po
// sobie ŻADNEGO śladu: w całym repo były trzy console.error, a każdy blok catch
// w API odsyłał JSON do klienta i połykał wyjątek. Po godzinie diagnozy nie było
// czego przeczytać.
//
// Siedzi w services/, a nie w utils/, bo utils/index.js wchodzi do bundla klienta —
// logi serwera nie mają czego szukać w przeglądarce.
//
// Wyjście idzie na stderr/stdout procesu, czyli tam, gdzie zbiera je pm2
// (~/.pm2/logs/). Format jest jednolinijkowy i zaczyna się od czasu ISO, żeby dało
// się go filtrować grepem: `pm2 logs Punktualnik | grep '\[error\]'`.

const stamp = () => new Date().toISOString();

/** Skrót opisu błędu — komunikat plus pierwsze ramki stosu, bez zalewania logu. */
const describe = (err) => {
  if (!(err instanceof Error)) return String(err);
  const frames = (err.stack || "").split("\n").slice(1, 4).map((l) => l.trim()).join(" | ");
  return `${err.name}: ${err.message}${frames ? ` @ ${frames}` : ""}`;
};

/** Dodatki w formie `klucz=wartość`, pomijając puste. */
const meta = (extra) =>
  Object.entries(extra || {})
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");

/**
 * Błąd, który dotąd ginął w bloku catch.
 * @param {string} scope skąd — zwykle ścieżka endpointu, np. "api/entries/[id]"
 * @param {unknown} err  złapany wyjątek
 * @param {object} [extra] kontekst BEZ danych wrażliwych (id tak, hasła i e-maile nie)
 */
export const logError = (scope, err, extra) => {
  const tail = meta(extra);
  console.error(`${stamp()} [error] [${scope}] ${describe(err)}${tail ? ` ${tail}` : ""}`);
};

/** Ostrzeżenie — coś działa, ale nie tak, jak powinno. */
export const logWarn = (scope, message, extra) => {
  const tail = meta(extra);
  console.warn(`${stamp()} [warn] [${scope}] ${message}${tail ? ` ${tail}` : ""}`);
};

/**
 * Wyjątek złapany w endpoincie API, z rozróżnieniem powagi po statusie odpowiedzi.
 *
 * Bloki catch w API łapią dwie zupełnie różne rzeczy: przewidziane odmowy
 * ("email_taken", "wrong_old_password", kolizja biegnącego timera) i awarie,
 * o których nikt nie pomyślał. Te pierwsze idą jako [warn] — są normalną częścią
 * działania i nie powinny wyglądać w logu jak pożar. Wszystko poza 4xx to [error],
 * czyli coś do przeczytania jeszcze tego samego dnia.
 *
 * @param {string} scope ścieżka endpointu, np. "api/entries/[id]"
 * @param {unknown} err złapany wyjątek
 * @param {number} status kod, który poleci do klienta
 * @param {object} [extra] kontekst BEZ danych wrażliwych
 */
export const logApiError = (scope, err, status, extra) => {
  const expected = status >= 400 && status < 500;
  const payload = { status, ...(extra || {}) };
  if (expected) {
    logWarn(scope, describe(err), payload);
  } else {
    logError(scope, err, payload);
  }
};

/** Zdarzenie informacyjne — używać oszczędnie, dysk Mikrusa ma 10 GB. */
export const logInfo = (scope, message, extra) => {
  const tail = meta(extra);
  console.log(`${stamp()} [info] [${scope}] ${message}${tail ? ` ${tail}` : ""}`);
};
