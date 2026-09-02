import db from "./db";
import Joi from "joi";
import { verifyPassword, isStalePassword, makePasswordRecord } from "./password";
import { loginKeys, checkLogin, noteFailure, noteSuccess, noteBlocked } from "./loginRateLimit";
import { logError, logInfo } from "./log";

const schema = Joi.object({
  email: Joi.string().email().required(),
  // .max() odcina absurdalne ciała żądań. NIGDY .min(): część kont ma hasła
  // krótsze niż dzisiejsze minimum, a reguła długości przy LOGOWANIU zamknęłaby
  // im drogę do aplikacji — w tym drogę do zmiany hasła na dłuższe. Minimum
  // obowiązuje wyłącznie przy zapisie (createUser, updateUserPassword).
  password: Joi.string().max(200).required(),
});

// Kolumny jawnie: `SELECT *` ciągnęło tu komplet danych konta przy każdej próbie
// logowania. Hash, sól i parametry są potrzebne — reszta wraca do next-auth jako
// treść tokenu.
const findByEmail = db.prepare(
  `SELECT id, email, name, role, section, location, isActive,
          passwordHash, passwordSalt, passwordParams
     FROM Users WHERE email = ?`
);

// Warunek `passwordHash = @previousHash` nie jest ozdobą: między odczytem wiersza
// a przeliczeniem hasło mogło zmienić się przez /api/users PUT albo przez
// `admin.js passwd`. Bez tego warunku przeliczenie nadpisałoby świeże hasło
// starym. `changes === 0` znaczy "ktoś nas wyprzedził" i jest poprawnym,
// spodziewanym wynikiem — nie błędem.
const rehashPassword = db.prepare(
  `UPDATE Users
      SET passwordHash = @passwordHash, passwordSalt = @passwordSalt, passwordParams = @passwordParams
    WHERE id = @id AND passwordHash = @previousHash`
);

// Podłoga czasowa dla WSZYSTKICH ścieżek porażki.
//
// Bez niej nieistniejący adres wracał natychmiast, a istniejący dopiero po pełnym
// hashu — czyli dało się zmierzyć czasem, które konta istnieją. Oczywistym
// lekarstwem byłoby liczenie hasha "na niby" także dla nieznanego adresu, ale po
// podniesieniu iteracji zamieniłoby to listę losowych adresów w DARMOWY generator
// obciążenia procesora i wyłączyło kubełek e-mailowy limitera (za każdym razem
// inny adres = świeży kubełek). Timer nie kosztuje ani procesora, ani wątku
// threadpoola — kosztuje otwarte gniazdo, a tę cenę limituje już limiter.
//
// Wartość ma być WIĘKSZA niż najdłuższa ścieżka porażki, czyli niż jeden hash.
// Zmierzone na Mikrusie 02.09.2026: przy 120 000 iteracji ok. 110 ms, więc 400 ms
// daje ~3,5x zapasu — potrzebny, bo współdzielony vCPU jest dławiony tym mocniej,
// im dłużej liczy (patrz komentarz przy PBKDF2_ITERATIONS).
//
// Gdyby hash kiedyś przekroczył tę wartość, podłoga przestaje maskować różnicę
// i wyrocznia czasowa wraca. Przy podnoszeniu iteracji podnieść i to.
const FAILURE_FLOOR_MS = 400;

const settleFailure = async (startedAt, result = null) => {
  const left = FAILURE_FLOOR_MS - (Date.now() - startedAt);
  if (left > 0) await new Promise((resolve) => setTimeout(resolve, left));
  return result;
};

// Co wyjątek z tej funkcji robi u użytkownika — powód, dla którego niżej jest
// tyle ostrożności:
//
// next-auth v4 (core/routes/callback.js) przy wyjątku z authorize() przekierowuje
// na stronę błędu z TREŚCIĄ komunikatu w adresie:
//     `${url}/error?error=${encodeURIComponent(error.message)}`
// Wcześniej trafiał tam komunikat Joi ("email" must be a valid email), a przy
// zajętej bazie trafiłby "SQLITE_BUSY: database is locked" — czyli wewnętrzny
// błąd wyświetlany człowiekowi, który chciał się tylko zalogować.
const authorizeUser = async (payload) => {
  const startedAt = Date.now();

  // Niepoprawny e-mail to nie awaria, tylko nieudane logowanie. Zwracamy null,
  // czyli dokładnie to samo co przy złym haśle — także dlatego, że rozróżnianie
  // tych przypadków zdradzałoby, które adresy istnieją w bazie.
  const parsed = schema.validate({ email: payload?.email, password: payload?.password });
  if (parsed.error) {
    return settleFailure(startedAt);
  }
  const { email, password } = parsed.value;

  // Limiter PRZED odczytem konta i przed hashem — to jedyne miejsce, w którym
  // odcięcie jest jeszcze darmowe.
  const keys = loginKeys(email, payload?.headers);
  const gate = checkLogin(keys);
  if (!gate.ok) {
    noteBlocked(keys, gate);
    await settleFailure(startedAt);
    // Osobny kod, nie ciche "złe hasło" — uzasadnienie przy ERROR_MESSAGES
    // w pages/users/signin.js.
    throw new Error("too_many_attempts");
  }

  let user;
  try {
    user = findByEmail.get(email);
  } catch (error) {
    // Błąd bazy (np. SQLITE_BUSY przy kolizji zapisu) NIE jest nieudanym
    // logowaniem — zwrócenie null kazałoby użytkownikowi sprawdzać hasło, które
    // jest poprawne. Rzucamy kod, nie treść: strona logowania tłumaczy go na
    // zdanie po polsku (pages/users/signin.js), a szczegóły idą do logu, gdzie
    // jest ich miejsce.
    logError("authorizeUser", error, { stage: "odczyt konta" });
    throw new Error("server_error");
  }

  // Nieznany adres: BEZ liczenia hasha (patrz FAILURE_FLOOR_MS wyżej). Porażkę
  // zapisujemy mimo to — inaczej rotacja nieistniejących adresów omijałaby limiter.
  if (!user) {
    noteFailure(keys);
    return settleFailure(startedAt);
  }

  let passwordOk;
  try {
    // Parametrami Z WIERSZA, nie bieżącymi: konto, które nie logowało się od
    // podniesienia iteracji, ma hash policzony po staremu i tylko po staremu da
    // się go zweryfikować.
    passwordOk = await verifyPassword(password, user);
  } catch (error) {
    // Nierozpoznawalne passwordParams to uszkodzony wiersz, czyli nasza awaria.
    // Podanie tu "złego hasła" wysłałoby użytkownika w ślepy zaułek sprawdzania
    // hasła, które jest poprawne.
    logError("authorizeUser", error, { stage: "weryfikacja hasła", userID: user.id });
    throw new Error("server_error");
  }

  if (!passwordOk) {
    noteFailure(keys);
    return settleFailure(startedAt);
  }

  noteSuccess(keys);

  // Sprawdzenie ZOSTAJE po weryfikacji hasła, wbrew pozorom świadomie. Przesunięcie
  // go wyżej oszczędziłoby procesor na kontach czekających na aktywację, ale
  // zdradzałoby, KTÓRE adresy istnieją i są nieaktywne — a konta powstają
  // z isActive = 0, więc to stan normalny i częsty. W tej kolejności odpowiedź
  // różni się wyłącznie dla kogoś, kto już zna poprawne hasło.
  if (!user.isActive) {
    return null;
  }

  // Leniwe przeliczenie: jedyny moment w całym cyklu życia konta, w którym mamy
  // hasło jawne, więc jedyny, w którym da się przejść na mocniejsze parametry.
  // Konta, które nigdy się nie zalogują, zostaną na starych — pokazuje je
  // `npm run admin -- passwd-audit`.
  if (isStalePassword(user.passwordParams)) {
    try {
      const record = await makePasswordRecord(password);
      const info = rehashPassword.run({
        id: user.id,
        previousHash: user.passwordHash,
        ...record,
      });
      if (info.changes === 1) {
        logInfo("login", "hasło przeliczone na nowe parametry", {
          userID: user.id,
          params: record.passwordParams,
        });
      }
    } catch (error) {
      // Nieudane przeliczenie NIE MOŻE zepsuć poprawnego logowania. Konto zostaje
      // na starych parametrach i spróbujemy ponownie przy następnym logowaniu.
      logError("authorizeUser", error, { stage: "przeliczenie hasła", userID: user.id });
    }
  }

  return {
    id: user.id,
    userID: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    section: user.section,
    location: user.location,
  };
};

export default authorizeUser;
