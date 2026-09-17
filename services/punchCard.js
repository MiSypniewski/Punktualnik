import Joi from "joi";
import dayjs from "dayjs";
import db from "./db";
import saveTime from "./saveTime";
import getUserData from "./getUserData";
import { canSeeUser } from "./scope";
import { getCard, dayStamp } from "./manageTime";
import { now as appNow } from "./workday";
import { DifferenceTime, WORKDAY_HOURS } from "../utils";
import { logWarn } from "./log";

// Odbicie karty na kiosku — reguły zapisu do tabeli Times ze wspólnego ekranu
// dotykowego (rola `editor`).
//
// Dlaczego ten plik w ogóle powstał: do tej pory trasa pages/api/time/[id].js
// robiła `const payload = req.body` i podawała go wprost do saveTime/updateTime,
// czyli zapisywała CAŁY wiersz tak, jak przyszedł z przeglądarki — razem
// z userID, sekcją, statusem, godzinami i policzonym czasem pracy. Sprawdzana
// była wyłącznie rola. Wynikały z tego trzy rzeczy:
//
//  1. kiosk jednej sekcji mógł zapisać kartę KOMUKOLWIEK w firmie, bo userID
//     brał się z ciała żądania i nikt go nie zestawiał z zasięgiem konta;
//  2. wymiar dniówki liczyła przeglądarka (components/card.js: DifferenceTime),
//     więc źle ustawiony zegar tabletu w hali wpisywał się wprost do ewidencji;
//  3. nic nie pilnowało jednej karty na dobę — dwa szybkie dotknięcia potrafiły
//     założyć dwa wiersze (komentarz przy `airtableID` w components/card.js
//     opisuje dokładnie ten wyścig).
//
// Zasada, na której stoi ten moduł: z żądania bierzemy WYŁĄCZNIE intencję
// ("wejście" albo "wyjście"). Kogo dotyczy — rozstrzyga adres zestawiony
// z zasięgiem konta; która to doba, o której godzinie i ile z tego wyszło —
// liczy serwer. Reszta pól, które kiosk nadal wysyła (imię, sekcja, godziny,
// totalWorkTime), jest odrzucana przy walidacji i nigdzie nie trafia.
//
// Lustrzane wobec services/manageTime.js, czyli korekty kierownika: tamten
// moduł pilnuje tych samych danych, tylko wpisywanych ręcznie i z podpisem.
// Wspólne części (kotwica doby, odczyt karty, pomiar dniówki) są stamtąd
// importowane, żeby nie powstała druga, rozjeżdżająca się kopia reguł.

/** Kod błędu → status HTTP. Ta sama konwencja co STATUS_FOR w manageTime.js. */
export const STATUS_FOR = {
  bad_request: 400,
  out_of_scope: 403,
  not_found: 404,
  card_exists: 409,
  bad_card: 422,
};

const fail = (code, message) => {
  const error = new Error(message);
  error.code = code;
  throw error;
};

// Statusy, które kiosk umie ustawić. `wait` nie jest jednym z nich: to stan
// kafelka, któremu nie odpowiada żaden wiersz w bazie (services/sectionBoard.js
// buduje go w locie), a `overTime` jest wyłącznie stanem widoku — karta
// przekroczonej ósemki siedzi w bazie jako `workInProgress` z flagą overTime.
const KIOSK_STATUSES = ["workInProgress", "finishWork"];

// `stripUnknown` jest tu sednem, a nie wygodą: kiosk wysyła komplet pól wiersza
// (imię, nazwisko, sekcja, lokalizacja, data, godziny, totalWorkTime, overTime),
// a my chcemy z tego ciała dokładnie dwie rzeczy. Wszystko poza schematem jest
// ODCINANE, więc dopisanie pola po stronie przeglądarki nie ma jak wpłynąć na
// zapis. Odrzucanie żądania za nadmiarowe pola byłoby tu gorsze — zepsułoby
// istniejącego klienta bez żadnego zysku.
const bodySchema = Joi.object({
  status: Joi.string()
    .valid(...KIOSK_STATUSES)
    .required(),
  // Opcjonalne i służy WYŁĄCZNIE do zestawienia z adresem: gdyby kiedyś
  // rozjechały się jedno z drugim, lepiej odmówić niż zgadywać, kogo dotyczy
  // odbicie.
  userID: Joi.number().integer().positive(),
});

/** @returns {{status: string, userID?: number}} sama intencja żądania */
const readBody = (body) => {
  const { value, error } = bodySchema.validate(body ?? {}, {
    abortEarly: true,
    stripUnknown: true,
  });
  if (error) fail("bad_request", "Nieznana operacja na karcie czasu.");
  return value;
};

/**
 * userID z adresu `/api/time/<id>`.
 *
 * Pusty kafelek ma `ID` w postaci `empty_<userID>` (services/sectionBoard.js),
 * bo przed pierwszym dotknięciem nie ma jeszcze wiersza, którego id można by
 * podać. POST leci właśnie pod ten adres i to z niego — a nie z ciała żądania
 * — bierzemy właściciela karty.
 *
 * @returns {number|null}
 */
export const ownerIDFromParam = (param) => {
  const raw = String(param ?? "").replace(/^empty_/, "");
  return /^\d+$/.test(raw) ? Number(raw) : null;
};

/** Numeryczne id wiersza Times z adresu — dla PUT-a na istniejącej karcie. */
const cardIDFromParam = (param) => {
  const raw = String(param ?? "");
  return /^\d+$/.test(raw) ? Number(raw) : null;
};

/**
 * Czy to konto wolno odbić z tego kiosku.
 *
 * Zasięg liczy services/scope.js, więc `editor` widzi wyłącznie własną sekcję,
 * a reguła jest ta sama, którą sprawdza GET tej trasy i tablica kiosku.
 * Dodatkowo zawężamy do osób, które w ogóle mają kafelek: services/getUsers.js
 * pokazuje aktywnych pracowników i kierowników, ale nie konta `editor` — kiosk
 * nie odbija karty drugiemu kioskowi.
 */
const assertPunchable = async (token, userID) => {
  const [owner] = await getUserData(userID);
  if (!owner) fail("not_found", "Nie ma takiego pracownika.");

  if (!canSeeUser(token, owner) || !owner.isActive || owner.role === "editor") {
    logWarn("punchCard", "odrzucone odbicie spoza zasięgu kiosku", {
      by: token.userID,
      bySection: token.section,
      targetID: owner.id,
      targetSection: owner.section,
    });
    fail("out_of_scope", "Ta karta nie należy do tego stanowiska.");
  }

  return owner;
};

/**
 * Kotwica dzisiejszej doby — wartość kolumny Times.data.
 *
 * Wyrażenie MUSI zostać identyczne z tym, którego używają services/getTime.js,
 * services/sectionBoard.js i services/manageTime.js, bo karty dopasowuje się po
 * tej kolumnie porównaniem DOSŁOWNYM, całym ciągiem ISO razem z offsetem strefy
 * procesu. Stąd import dayStamp zamiast czwartej kopii `dayjs().hour(3)`.
 *
 * Świadomie NIE jest to workDay() z services/workday.js: tamto liczy dobę
 * roboczą (o 1:00 w nocy wskazuje dzień poprzedni), a tutaj chodzi o kotwicę
 * w kształcie, w jakim leży w bazie od czasów Airtable. Ujednolicenie tych
 * dwóch pojęć to osobna zmiana, która rusza dopasowanie wszystkich kart.
 */
const todayStamp = () => dayStamp(dayjs());

/**
 * Wymiar dniówki liczony TĄ SAMĄ funkcją co kafelek i korekta kierownika
 * (utils/index.js → services/manageTime.js). Druga implementacja rozjechałaby
 * się z nimi przy pierwszej poprawce i zauważyłyby to dopiero kadry.
 */
const measure = (startTime, endTime) => {
  const res = DifferenceTime(startTime, endTime);
  return { totalWorkTime: res.time, overTime: res.overtime };
};

const stmtCardForDay = db.prepare(`SELECT id FROM Times WHERE userID = ? AND data = ?`);

// Kolumny, których wolno dotknąć z kiosku — i ani jednej więcej. Wcześniej
// services/updateTime.js przepisywał cały wiersz wartościami z żądania, więc
// PUT potrafił przenieść kartę na innego pracownika albo do innej sekcji.
const stmtCloseCard = db.prepare(`
  UPDATE Times
     SET endTime       = @endTime,
         totalWorkTime = @totalWorkTime,
         overTime      = @overTime,
         status        = 'finishWork'
   WHERE id = @id`);

const stmtReopenWaiting = db.prepare(`
  UPDATE Times
     SET startTime     = @startTime,
         endTime       = @endTime,
         totalWorkTime = @totalWorkTime,
         overTime      = 0,
         status        = 'workInProgress'
   WHERE id = @id`);

/**
 * Godziny odbicia liczone na SERWERZE, w strefie aplikacji.
 *
 * Do tej pory znaczniki generowała przeglądarka kiosku i wpadały do bazy takie,
 * jakie były — z zegarem tabletu włącznie. Strefa musi być jawna (APP_TZ przez
 * services/workday.js), bo proces na Mikrusie chodzi w UTC: gołe dayjs() dałoby
 * "+00:00" i pracownik zobaczyłby na tablicy godzinę sprzed dwóch godzin.
 * Dokładnie ten sam zabieg robi korekta kierownika (services/manageTime.js).
 *
 * Planowane wyjście to wejście plus dniówka — ta sama ósemka (WORKDAY_HOURS),
 * na której stoi kafelek i nocne domykanie kart.
 */
const openSpan = () => {
  // Jedno "teraz" na oba znaczniki — dwa wywołania appNow() dzieli milisekunda
  // i planowana dniówka wychodziła o tyle dłuższa niż równe osiem godzin.
  const start = appNow();
  const startTime = start.format();
  const endTime = start.add(WORKDAY_HOURS, "hour").format();

  return {
    startTime,
    endTime,
    // Karta w toku jeszcze niczego nie przekroczyła: `endTime` jest tu
    // planem, a nie zmierzonym wyjściem. totalWorkTime trzyma wymiar
    // planowanej dniówki ("08:00:00"), dokładnie jak przed tą zmianą.
    totalWorkTime: measure(startTime, endTime).totalWorkTime,
    overTime: false,
  };
};

/**
 * Pierwsze dotknięcie kafelka — odbicie wejścia.
 *
 * @param {{param: string, body: object, token: object}} args
 * @returns {Promise<object>} zapisany wiersz razem z nadanym id
 */
export const openCardFromKiosk = async ({ param, body, token }) => {
  const { status, userID: claimed } = readBody(body);
  if (status !== "workInProgress") {
    fail("bad_request", "Nową kartę zakłada wyłącznie odbicie wejścia.");
  }

  const userID = ownerIDFromParam(param);
  if (!userID) fail("bad_request", "Adres karty nie wskazuje pracownika.");
  if (claimed !== undefined && claimed !== userID) {
    fail("bad_request", "Adres karty nie zgadza się z jej właścicielem.");
  }

  const owner = await assertPunchable(token, userID);
  const data = todayStamp();

  // Jedna karta na osobę i dobę. Do tej pory pilnował tego wyłącznie stan
  // komponentu (`airtableID`), więc dwa dotknięcia z rzędu albo dwie otwarte
  // tablice zakładały dwa wiersze, a tablica dopasowywała potem losowy z nich.
  if (stmtCardForDay.get(userID, data)) {
    fail("card_exists", "Ten pracownik ma już dziś odbitą kartę.");
  }

  // Imię, nazwisko, sekcja i lokalizacja są w Times ZDENORMALIZOWANE (spadek po
  // Airtable) i kopiujemy je z konta — tak samo jak services/manageTime.js przy
  // dopisywaniu karty. Wcześniej przychodziły z przeglądarki, więc wiersz mógł
  // trafić do eksportu cudzej sekcji (raporty filtrują po Times.section).
  return saveTime({
    userID,
    name: owner.name,
    surname: owner.surname,
    section: owner.section,
    location: owner.location,
    data,
    ...openSpan(),
    status: "workInProgress",
  });
};

/**
 * Kolejne dotknięcia istniejącej karty.
 *
 * `finishWork` domyka dniówkę bieżącą godziną serwera. `workInProgress` nie
 * niesie żadnej nowej informacji (kafelek odsyła stan, który serwer już ma)
 * i jest świadomie ZAPISEM PUSTYM — jedynym wyjątkiem jest zaległy wiersz ze
 * statusem `wait`, który zostawiło nieużywane już services/newDay.js.
 *
 * Zapis pusty nie jest tu drobiazgiem: better-sqlite3 jest synchroniczne, więc
 * każdy niepotrzebny UPDATE to kolizja o blokadę zapisu z każdym innym kioskiem
 * — ta sama przyczyna, która 21.08.2026 zamroziła serwer (services/db.js).
 *
 * @param {{param: string, body: object, token: object}} args
 * @returns {Promise<object>} karta po zapisie
 */
export const updateCardFromKiosk = async ({ param, body, token }) => {
  const { status } = readBody(body);

  const id = cardIDFromParam(param);
  if (!id) fail("bad_request", "Adres nie wskazuje karty.");

  const card = getCard(id);
  if (!card) fail("not_found", "Nie ma takiej karty.");

  await assertPunchable(token, card.userID);

  if (status === "workInProgress") {
    // Zaległy wiersz "wait" — karta, której nikt nigdy nie odbił. Traktujemy
    // dotknięcie jak wejście, ale na istniejącym wierszu, żeby nie złamać
    // reguły jednej karty na dobę.
    if (card.status === "wait") {
      const span = openSpan();
      stmtReopenWaiting.run({ id, ...span });
      return getCard(id);
    }
    return card;
  }

  // Karta już zamknięta: zwracamy ją bez zapisu. Kafelek potrafi wysłać
  // domknięcie dwa razy (efekt w components/card.js zależy też od `overTime`),
  // a drugie przeliczenie przesunęłoby godzinę wyjścia na "teraz" i po cichu
  // wydłużyło dniówkę. Domknięcie jest więc IDEMPOTENTNE.
  if (card.status === "finishWork") return card;

  const endTime = appNow().format();

  // Odrzucamy wyłącznie wyjście WCZEŚNIEJSZE niż wejście — czyli kartę, której
  // nie da się zmierzyć (zepsuty wiersz albo godzina wejścia z przyszłości).
  // Wyjście w tej samej sekundzie co wejście jest dozwolone i daje dniówkę
  // "00:00:00": tyle znaczy podwójne dotknięcie kafelka. Odmowa byłaby tu
  // gorsza niż zerowa karta, bo components/card.js nie czyta odpowiedzi na PUT
  // — ekran pokazałby "Zakończono", a w bazie zostałaby karta otwarta.
  if (dayjs(endTime).isBefore(dayjs(card.startTime))) {
    fail("bad_card", "Karta ma godzinę wejścia późniejszą niż bieżąca.");
  }

  const span = measure(card.startTime, endTime);
  stmtCloseCard.run({
    id,
    endTime,
    totalWorkTime: span.totalWorkTime,
    overTime: span.overTime ? 1 : 0,
  });

  return getCard(id);
};
