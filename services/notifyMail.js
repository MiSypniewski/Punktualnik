import dayjs from "dayjs";
import "dayjs/locale/pl";
import db from "./db";
import { sendMail, appUrl, mailEnabled } from "./mailer";
import { absenceKindLabel, requiresCertificate } from "./absenceKinds";
import { kindLabel, signedMinutes } from "./overtimeKinds";
import getOvertimeBalance from "./getOvertimeBalance";
import { formatMinutes, formatDuration, formatDate, formatDateRange } from "../utils";

dayjs.locale("pl");

// Treści powiadomień mailowych i lista adresatów.
//
// Reguła adresowania: wiadomość dostaje PRACOWNIK, którego sprawa dotyczy (To),
// oraz KOMPLET kierowników jego sekcji (Cc). Nie jeden kierownik, nie ten, który
// akurat kliknął — cała grupa przypisana do sekcji w tabeli ManagerSections, bo
// zastępstwo w czasie urlopu jest normalną sytuacją, a wiadomość wysłana do
// jednej osoby przepada razem z jej nieobecnością.
//
// JEDEN WYJĄTEK: powiadomienia "jest coś do rozpatrzenia" idą WYŁĄCZNIE do
// kierowników. Adresatem jest tam osoba, która ma coś ZROBIĆ, a pracownik przed
// sekundą sam kliknął "złóż wniosek" i potwierdzenia nie potrzebuje.
//
// Rozdział wobec services/notifyGChat.js jest celowy: tam idzie sygnał "jest
// nowy wniosek do rozpatrzenia" na wspólny czat, tutaj — imienna informacja
// o rozstrzygnięciu albo o brakującym odbiciu. Dwa różne kanały, dwie różne
// role, żaden nie zastępuje drugiego.

const stmtSectionManagers = db.prepare(`
  SELECT DISTINCT u.email
    FROM ManagerSections ms
    JOIN Users u ON u.id = ms.managerID
   WHERE ms.section = @section
     AND u.isActive = 1
     AND u.role = 'manager'
     AND u.email IS NOT NULL
     AND TRIM(u.email) <> ''`);

const stmtUserEmail = db.prepare(`SELECT email FROM Users WHERE id = ? AND isActive = 1`);

/** @returns {string[]} adresy wszystkich kierowników obsługujących sekcję */
const sectionManagers = (section) =>
  section ? stmtSectionManagers.all({ section }).map((r) => r.email) : [];

const userEmail = (userID) => stmtUserEmail.get(Number(userID))?.email || null;

/**
 * Adresaci jednego powiadomienia.
 *
 * Kierownik będący JEDNOCZEŚNIE bohaterem sprawy (a kierownik też odbija kartę
 * i też bierze urlop) wypada z kopii — inaczej dostałby tę samą wiadomość dwa
 * razy, raz w To i raz w Cc.
 */
const recipients = (ownerID, section) => {
  const to = userEmail(ownerID);
  const cc = sectionManagers(section).filter((email) => email !== to);
  return { to: to ? [to] : [], cc };
};

/**
 * Adresaci powiadomienia "do rozpatrzenia": sami kierownicy sekcji, w polu To.
 *
 * Kierownik, który jest autorem wniosku (bierze urlop jak każdy), zostaje na
 * liście świadomie — wniosek i tak musi rozpatrzyć ktoś, a przy jednoosobowej
 * sekcji usunięcie go z adresatów znaczyłoby, że nie dowie się nikt.
 */
const managersOf = (section) => ({ to: sectionManagers(section), cc: [] });

// --- składanie treści -------------------------------------------------------

const esc = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

/**
 * Wiersze tekstu → para {text, html}.
 *
 * Piszemy OBIE wersje, a nie sam HTML: klient pocztowy z wyłączonym HTML-em
 * i podgląd powiadomienia na telefonie pokazują wtedy zdanie do przeczytania,
 * a nie znaczniki. Format jest z założenia prymitywny — akapit na wiersz,
 * pogrubienie wyłącznie tam, gdzie wiersz zaczyna się od etykiety.
 *
 * Wiersz `null` to odstęp; wiersz w kształcie ["etykieta", "wartość"] rozdziela
 * się na pogrubioną etykietę i wartość.
 */
const compose = (lines) => {
  const text = lines
    .map((line) => {
      if (line === null) return "";
      if (Array.isArray(line)) return `${line[0]}: ${line[1]}`;
      return line;
    })
    .join("\n");

  const html = lines
    .map((line) => {
      if (line === null) return "";
      if (Array.isArray(line)) {
        return `<p style="margin:0 0 4px"><strong>${esc(line[0])}:</strong> ${esc(line[1])}</p>`;
      }
      return `<p style="margin:0 0 10px">${esc(line)}</p>`;
    })
    .filter(Boolean)
    .join("\n");

  return {
    text,
    html: `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:14px;line-height:1.5;color:#1a1a1a">${html}</div>`,
  };
};

/** Wiersz z odnośnikiem do aplikacji — pomijany, gdy NEXTAUTH_URL nie jest ustawione. */
const linkLine = (path, label) => {
  const url = appUrl(path);
  return url ? `${label}: ${url}` : null;
};

const dzien = formatDate;
const godzina = (stamp) => dayjs(stamp).format("HH:mm");

/**
 * Zdanie dla rodzajów nieobecności, przy których zgoda w Punktualniku to dopiero
 * połowa sprawy (services/absenceKinds.js, flaga requiresCertificate).
 *
 * Dziś dotyczy wyłącznie oddania krwi i dlatego mówi wprost o stacji
 * krwiodawstwa: komunikat "dostarcz odpowiedni dokument" jest tak ogólny, że
 * nikt się nim nie przejmie. Gdyby flagę dostał kiedyś drugi rodzaj, to zdanie
 * rozdzieli się na dwa — nie odwrotnie.
 */
const CERTIFICATE_NOTE =
  "WAŻNE: zaświadczenie ze stacji krwiodawstwa dostarcz do działu kadr jak najszybciej. " +
  "Bez niego nieobecność nie zostanie rozliczona.";

// --- 1. brak odbicia wyjścia ------------------------------------------------

/**
 * Karta domknięta automatycznie o 3:00 (services/closeOpenCards.js).
 *
 * Wiadomość mówi WPROST, że wpisana liczba jest domyślna, a nie zmierzona —
 * inaczej pracownik zobaczy w ewidencji równe osiem godzin, uzna sprawę za
 * załatwioną i błąd pojedzie do kadr.
 */
export const notifyMissingPunchOut = async (card) => {
  const { to, cc } = recipients(card.userID, card.section);

  const body = compose([
    `Nie odbito wyjścia z pracy — kartę domknął system.`,
    null,
    ["Pracownik", `${card.name} ${card.surname}`],
    ["Dzień", dzien(card.data)],
    ["Wejście", godzina(card.startTime)],
    ["Wpisane wyjście", `${godzina(card.endTime)} (domyślne, osiem godzin od wejścia)`],
    ["Zapisany czas", card.totalWorkTime],
    null,
    `Ta godzina wyjścia jest ZAŁOŻONA, nie zmierzona. Jeśli dniówka wyglądała inaczej, zgłoś to kierownikowi — poprawka zajmuje chwilę i zostaje podpisana.`,
    linkLine("/time/zarzadzaj", "Korekta kart (kierownik)"),
  ]);

  return sendMail({
    to,
    cc,
    subject: `Punktualnik: brak odbicia wyjścia — ${formatDate(card.data)}`,
    kind: "brak-odbicia",
    ...body,
  });
};

// --- 2. niezakończone zadanie ----------------------------------------------

export const notifyUnfinishedTask = async (entry) => {
  const { to, cc } = recipients(entry.userID, entry.section);

  const body = compose([
    `Zadanie zostało niezakończone — timer domknął system.`,
    null,
    ["Pracownik", `${entry.userName} ${entry.userSurname}`],
    ["Dzień", dzien(entry.data)],
    ["Projekt", entry.projectName || "(nie wskazano)"],
    ["Opis", entry.description || "(pusty)"],
    ["Start", godzina(entry.startedAt)],
    ["Domknięcie", `${godzina(entry.endedAt)} — granica doby roboczej`],
    ["Zapisany wymiar", formatDuration(entry.seconds)],
    null,
    `Wpis jest oznaczony jako domknięty automatycznie i czeka na sprawdzenie. Popraw wymiar u siebie w zadaniach — edycja zdejmuje ten znacznik.`,
    linkLine("/zadania", "Moje zadania"),
  ]);

  return sendMail({
    to,
    cc,
    subject: `Punktualnik: niezakończone zadanie — ${formatDate(entry.data)}`,
    kind: "niezakonczone-zadanie",
    ...body,
  });
};

// --- 3. zatwierdzony urlop --------------------------------------------------

/**
 * Wołane WYŁĄCZNIE po zatwierdzeniu. Odrzucenie, anulowanie i cofnięcie zostają
 * poza tym kanałem — użytkownik wymienił akceptacje i tylko one mają iść mailem.
 *
 * Przypomnienie o Comarchu jest tu SEDNEM wiadomości, nie dopiskiem: Punktualnik
 * nie rozmawia z systemem kadrowym, więc zatwierdzony tutaj urlop nadal nie
 * istnieje formalnie, dopóki pracownik nie wypisze go tam osobno.
 */
export const notifyAbsenceApproved = async (absence, user) => {
  const { to, cc } = recipients(absence.userID, user?.section);

  const zakres = formatDateRange(absence.dateFrom, absence.dateTo);

  const body = compose([
    `Wniosek urlopowy został zatwierdzony.`,
    null,
    ["Pracownik", user ? `${user.name} ${user.surname}` : `użytkownik #${absence.userID}`],
    ["Rodzaj", absenceKindLabel(absence.kind)],
    ["Termin", zakres],
    ["Dni roboczych", String(absence.workDays)],
    ...(absence.decidedByName ? [["Zatwierdził", absence.decidedByName]] : []),
    ...(absence.decisionNote ? [["Uwagi", absence.decisionNote]] : []),
    null,
    // Zdanie zamiast, nie obok: oddanie krwi NIE jest urlopem, więc odsyłanie
    // do Comarcha byłoby myleniem pracownika dwoma obowiązkami naraz. Rozliczy
    // to dział kadr — na podstawie zaświadczenia, o które prosimy tu wprost.
    requiresCertificate(absence.kind)
      ? CERTIFICATE_NOTE
      : `UWAGA: urlop trzeba dodatkowo wypisać w systemie Comarch. Zgoda w Punktualniku nie przenosi się tam sama — bez wpisu w Comarchu urlop nie jest rozliczony.`,
    linkLine("/urlopy", "Moje wnioski"),
  ]);

  return sendMail({
    to,
    cc,
    subject: `Punktualnik: urlop zatwierdzony — ${zakres}`,
    kind: "urlop-zatwierdzony",
    ...body,
  });
};

// --- 4. zatwierdzone nadgodziny / wcześniejsze wyjście ----------------------

/**
 * Jedna funkcja na oba rodzaje — bo to jeden obieg i jedna tabela. O tym, czy
 * wiadomość mówi "zostaję dłużej", czy "wcześniejsze wyjście", rozstrzyga
 * kindLabel; wymiar niesie znak, więc widać od razu, w którą stronę idzie saldo.
 */
export const notifyOvertimeApproved = async (request, user) => {
  const { to, cc } = recipients(request.userID, user?.section);

  const body = compose([
    `Wniosek został zatwierdzony.`,
    null,
    ["Pracownik", user ? `${user.name} ${user.surname}` : `użytkownik #${request.userID}`],
    ["Rodzaj", kindLabel(request.kind)],
    ["Wymiar", formatMinutes(signedMinutes(request), { withSign: true })],
    ["Data", formatDate(request.data)],
    ...(request.decidedByName ? [["Zatwierdził", request.decidedByName]] : []),
    ...(request.decisionNote ? [["Uwagi", request.decisionNote]] : []),
    null,
    // Saldo liczone PO decyzji, czyli już z tym wnioskiem — to pierwsza liczba,
    // o którą pracownik zapyta, a szukanie jej w panelu jest zbędnym krokiem.
    ["Saldo po tej decyzji", formatMinutes(getOvertimeBalance(request.userID), { withSign: true })],
    null,
    linkLine("/nadgodziny", "Moje nadgodziny"),
  ]);

  return sendMail({
    to,
    cc,
    subject: `Punktualnik: ${kindLabel(request.kind).toLowerCase()} — zatwierdzone`,
    kind: "nadgodziny-zatwierdzone",
    ...body,
  });
};

// --- 5. wnioski czekające na decyzję ---------------------------------------
//
// Dwa powiadomienia bliźniacze do tych na Google Chat (services/notifyGChat.js)
// i to jest świadome dublowanie, nie przeoczenie. Czat jest wspólną przestrzenią,
// którą trzeba mieć otwartą; mail dociera do kierownika, który akurat jej nie
// ogląda, i zostaje w skrzynce, dopóki ktoś się nim nie zajmie. Kanały wyłącza
// się niezależnie (GCHAT_WEBHOOK_URL kontra email_login), więc firma może
// zostawić jeden, drugi albo oba.

/**
 * Nowy wniosek urlopowy pracownika. Wyłącznie do kierowników.
 *
 * Wołane TYLKO dla wniosków pracownika — nieobecność wpisana przez kierownika
 * jest zatwierdzona w chwili powstania i nie ma czego rozpatrywać. Od tamtej
 * sytuacji jest notifyAbsenceRecorded niżej.
 */
export const notifyAbsencePending = async (absence, user) => {
  const { to, cc } = managersOf(user?.section);
  const zakres = formatDateRange(absence.dateFrom, absence.dateTo);

  const body = compose([
    `Nowy wniosek urlopowy czeka na decyzję.`,
    null,
    ["Pracownik", user ? `${user.name} ${user.surname}` : `użytkownik #${absence.userID}`],
    ["Rodzaj", absenceKindLabel(absence.kind)],
    ["Termin", zakres],
    // Dni ROBOCZE, nie kalendarzowe — to ta liczba schodzi z puli i to o nią
    // kierownik zapyta w pierwszej kolejności.
    ["Dni roboczych", String(absence.workDays)],
    ...(absence.reason ? [["Powód", absence.reason]] : []),
    null,
    linkLine("/urlopy/zarzadzaj", "Rozpatrz wniosek"),
  ]);

  return sendMail({
    to,
    cc,
    subject: `Punktualnik: wniosek urlopowy do rozpatrzenia — ${zakres}`,
    kind: "urlop-do-rozpatrzenia",
    ...body,
  });
};

/** Nowy wniosek o nadgodziny albo wcześniejsze wyjście. Wyłącznie do kierowników. */
export const notifyOvertimePending = async (request, user) => {
  const { to, cc } = managersOf(user?.section);

  const body = compose([
    `Nowy wniosek czeka na decyzję.`,
    null,
    ["Pracownik", user ? `${user.name} ${user.surname}` : `użytkownik #${request.userID}`],
    ["Rodzaj", kindLabel(request.kind)],
    ["Wymiar", formatMinutes(signedMinutes(request), { withSign: true })],
    ["Data", formatDate(request.data)],
    ...(request.reason ? [["Powód", request.reason]] : []),
    null,
    // Saldo PRZED decyzją: wniosek jeszcze nie jest zatwierdzony, więc go nie
    // zmienia, a kierownik decyduje w kontekście tego, co pracownik ma na koncie.
    ["Aktualne saldo pracownika", formatMinutes(getOvertimeBalance(request.userID), { withSign: true })],
    null,
    linkLine("/nadgodziny/zarzadzaj", "Rozpatrz wniosek"),
  ]);

  return sendMail({
    to,
    cc,
    subject: `Punktualnik: ${kindLabel(request.kind).toLowerCase()} — do rozpatrzenia`,
    kind: "nadgodziny-do-rozpatrzenia",
    ...body,
  });
};

// --- 6. wpisy zrobione przez kierownika ------------------------------------
//
// Wspólny mianownik tej grupy: ktoś ZMIENIŁ CUDZĄ EWIDENCJĘ. Pracownik nie
// klikał, nie składał wniosku i bez maila nie ma jak się o tym dowiedzieć —
// dotąd jedynym śladem był podpis w tabeli, do której musiałby sam zajrzeć,
// albo wpis w logu serwera, którego nie widzi w ogóle.
//
// Adresaci jak w reszcie: pracownik w To, komplet kierowników sekcji w Cc.
// Kierownik, który zmianę zrobił, dostaje własną kopię i tak ma zostać —
// przy dwóch osobach obsługujących sekcję to jedyny sposób, żeby druga
// wiedziała, co zrobiła pierwsza.

const stmtActorName = db.prepare(`SELECT name, surname FROM Users WHERE id = ?`);

/**
 * Podpis pod zmianą — PEŁNE imię i nazwisko, dociągane z bazy.
 *
 * Token JWT niesie samo imię (`token.name`), a pod zmianą w cudzej ewidencji
 * "Michał" jest bezużyteczne w firmie, w której są dwa. Ta sama sztuczka co
 * w services/decideAbsence.js, łącznie z zapasem: gdy konta już nie ma, zostaje
 * to, co przyszło z trasy.
 */
const kto = (actor) => {
  const row = actor?.userID ? stmtActorName.get(Number(actor.userID)) : null;
  return row ? `${row.name} ${row.surname}` : actor?.name || "kierownik";
};

/**
 * Nieobecność wpisana przez kierownika — L4, urlop na żądanie, urlop zgłoszony
 * telefonicznie. Taki wpis powstaje OD RAZU ZATWIERDZONY (autoApprove
 * w services/createAbsence.js), więc nigdy nie przechodzi przez trasę decyzji
 * i nie wywołałby notifyAbsenceApproved.
 */
export const notifyAbsenceRecorded = async (absence, owner, actor) => {
  const { to, cc } = recipients(absence.userID, owner?.section);
  const zakres = formatDateRange(absence.dateFrom, absence.dateTo);

  const body = compose([
    `Kierownik wpisał nieobecność na twoje konto.`,
    null,
    ["Pracownik", owner ? `${owner.name} ${owner.surname}` : `użytkownik #${absence.userID}`],
    ["Rodzaj", absenceKindLabel(absence.kind)],
    ["Termin", zakres],
    ["Dni roboczych", String(absence.workDays)],
    ["Wpisał", kto(actor)],
    ...(absence.reason ? [["Powód", absence.reason]] : []),
    null,
    // Zdanie o zatwierdzeniu jest prawdziwe i zostaje. Nieprawdziwe było
    // wrażenie, które zostawiało samo: że sprawa jest zamknięta. Przy oddaniu
    // krwi nie jest — dlatego prośba o zaświadczenie idzie PRZED nim, żeby nie
    // zginęła jako dopisek na końcu.
    ...(requiresCertificate(absence.kind) ? [CERTIFICATE_NOTE] : []),
    `Wpis jest już zatwierdzony — nie trzeba go składać jako wniosku. Jeśli termin albo rodzaj się nie zgadza, odezwij się do kierownika.`,
    linkLine("/urlopy", "Moje nieobecności"),
  ]);

  return sendMail({
    to,
    cc,
    subject: `Punktualnik: wpisano nieobecność — ${zakres}`,
    kind: "nieobecnosc-wpisana",
    ...body,
  });
};

/**
 * Przydział dni urlopu do puli. `days` bywa UJEMNE i to jest poprawne — tak
 * wygląda korekta po zmianie wymiaru etatu (services/addLeaveAllowance.js),
 * więc wiadomość musi umieć nazwać obie sytuacje.
 */
export const notifyAllowanceAdded = async (allowance, owner, actor) => {
  const { to, cc } = recipients(allowance.userID, owner?.section);
  const ujemny = Number(allowance.days) < 0;

  const body = compose([
    ujemny ? `Kierownik skorygował twoją pulę urlopową w dół.` : `Kierownik dopisał dni do twojej puli urlopowej.`,
    null,
    ["Pracownik", owner ? `${owner.name} ${owner.surname}` : `użytkownik #${allowance.userID}`],
    ["Rok", String(allowance.year)],
    ["Zmiana", `${allowance.days > 0 ? "+" : ""}${allowance.days} dni`],
    ["Wpisał", allowance.createdByName || kto(actor)],
    ...(allowance.note ? [["Uwagi", allowance.note]] : []),
    null,
    `Pula ma historię: to jest kolejny wpis, a nie nadpisanie poprzedniej liczby. Aktualne saldo dni zobaczysz w module urlopów.`,
    linkLine("/urlopy", "Moja pula"),
  ]);

  return sendMail({
    to,
    cc,
    subject: `Punktualnik: zmiana puli urlopowej ${allowance.year} (${allowance.days > 0 ? "+" : ""}${allowance.days} dni)`,
    kind: "pula-urlopowa",
    ...body,
  });
};

// Co dokładnie zrobiono z kartą czasu. Jedna tablica zamiast trzech niemal
// identycznych funkcji — różnią się czasownikiem i pierwszym zdaniem.
const CARD_ACTIONS = {
  created: {
    czasownik: "dopisał",
    zdanie: "Kierownik dopisał kartę czasu za dzień, w którym nie odbito wejścia.",
    temat: "dopisano kartę czasu",
  },
  corrected: {
    czasownik: "poprawił",
    zdanie: "Kierownik poprawił godziny na twojej karcie czasu.",
    temat: "poprawiono kartę czasu",
  },
  deleted: {
    czasownik: "usunął",
    zdanie: "Kierownik usunął twoją kartę czasu. Wpis nie istnieje już w ewidencji.",
    temat: "usunięto kartę czasu",
  },
};

/**
 * Zmiana karty czasu przez kierownika (services/manageTime.js).
 *
 * `before` podajemy tylko przy korekcie — bez porównania "było → jest"
 * wiadomość mówiłaby wyłącznie, że coś się zmieniło, i nie dałoby się
 * stwierdzić, czy zmiana jest tą, o którą pracownik prosił.
 *
 * Sekcję bierzemy z KARTY, nie z konta pracownika: karta trzyma sekcję z dnia
 * zapisu i tą samą regułą zawęża się panel korekty (services/getSectionTimes.js).
 * Inaczej po przejściu do innego zespołu mail o poprawce starego dnia poszedłby
 * do kierowników, którzy tej karty w ogóle nie widzą.
 */
export const notifyCardChanged = async (card, action, actor, before) => {
  const opis = CARD_ACTIONS[action];
  if (!opis) return false;

  const { to, cc } = recipients(card.userID, card.section);
  const dzienKarty = formatDate(card.data);

  const godziny = (row) =>
    row?.startTime && row?.endTime ? `${godzina(row.startTime)} – ${godzina(row.endTime)}` : "—";

  const body = compose([
    opis.zdanie,
    null,
    ["Pracownik", `${card.name} ${card.surname}`],
    ["Dzień", dzienKarty],
    ...(before ? [["Było", `${godziny(before)} (${before.totalWorkTime})`]] : []),
    [action === "deleted" ? "Usunięta karta" : before ? "Jest" : "Godziny",
      `${godziny(card)} (${card.totalWorkTime})`],
    ["Kto", `${kto(actor)} — ${opis.czasownik}`],
    null,
    `Jeśli to nie zgadza się z twoją dniówką, zgłoś to kierownikowi.`,
    linkLine("/time/zarzadzaj", "Karty czasu (kierownik)"),
  ]);

  return sendMail({
    to,
    cc,
    subject: `Punktualnik: ${opis.temat} — ${dzienKarty}`,
    kind: `karta-${action}`,
    ...body,
  });
};

const ENTRY_ACTIONS = {
  corrected: {
    zdanie: "Kierownik poprawił twój wpis w raporcie zadań.",
    temat: "poprawiono wpis zadania",
  },
  deleted: {
    zdanie: "Kierownik usunął twój wpis z raportu zadań. Wpisu nie da się przywrócić.",
    temat: "usunięto wpis zadania",
  },
};

/**
 * Korekta albo usunięcie CUDZEGO wpisu zadania (pages/api/entries/[id].js).
 *
 * Wołane wyłącznie wtedy, gdy wpis należy do kogoś innego niż zalogowany —
 * o własnej poprawce nie ma kogo zawiadamiać. Trasa rozstrzyga to obecnością
 * `actor`, tą samą flagą, która decyduje o podpisie "popr." i o wpisie w logu.
 */
export const notifyTaskEntryChanged = async (entry, action, actor, owner, reason) => {
  const opis = ENTRY_ACTIONS[action];
  if (!opis) return false;

  const { to, cc } = recipients(entry.userID, entry.section);

  const body = compose([
    opis.zdanie,
    null,
    ["Pracownik", owner ? `${owner.name} ${owner.surname}` : `użytkownik #${entry.userID}`],
    ["Dzień", formatDate(entry.data)],
    ["Projekt", entry.projectName || "(nie wskazano)"],
    ["Opis", entry.description || "(pusty)"],
    ["Godziny", entry.startedAt && entry.endedAt ? `${godzina(entry.startedAt)} – ${godzina(entry.endedAt)}` : "—"],
    ["Wymiar", formatDuration(entry.seconds ?? 0)],
    ["Kto", kto(actor)],
    ...(reason ? [["Powód", reason]] : []),
    null,
    linkLine("/zadania", "Moje zadania"),
  ]);

  return sendMail({
    to,
    cc,
    subject: `Punktualnik: ${opis.temat} — ${formatDate(entry.data)}`,
    kind: `zadanie-${action}`,
    ...body,
  });
};

// --- 7. cotygodniowe przypomnienie o niedogodzinach -------------------------

/**
 * Ujemne saldo nadgodzin poniżej progu (services/weeklyUndertimeJob.js).
 *
 * Jedyne powiadomienie w tym module, którego nie wywołuje żadne zdarzenie —
 * nikt niczego nie kliknął, po prostu minął wtorek. Dlatego wiadomość musi sama
 * powiedzieć, DLACZEGO przyszła i co zrobić, żeby nie przyszła znowu.
 *
 * To ostatnie zdanie nie jest uprzejmością: Punktualnik nie łączy modułu urlopów
 * z modułem nadgodzin, więc wypisanie urlopu NIE podniesie salda samo. Robi to
 * kierownik osobnym wpisem. Bez tej informacji pracownik, który zrobił wszystko
 * jak trzeba, dostanie za tydzień to samo i uzna, że system się zaciął.
 */
export const notifyUndertimeReminder = async (person) => {
  const { to, cc } = recipients(person.id, person.section);
  const saldo = formatMinutes(person.balance, { withSign: true });

  const body = compose([
    `Twoje saldo nadgodzin jest na minusie i wymaga pokrycia urlopem.`,
    null,
    ["Pracownik", `${person.name} ${person.surname}`],
    ["Saldo nadgodzin", saldo],
    null,
    `Wypisz urlop na pokrycie brakujących godzin i uzgodnij termin z kierownikiem.`,
    `Saldo w Punktualniku nie podniesie się samo — po wypisaniu urlopu robi to kierownik osobnym wpisem w module nadgodzin. Dopóki saldo zostaje poniżej progu, ta wiadomość wraca w każdy wtorek.`,
    linkLine("/nadgodziny", "Moje nadgodziny"),
    linkLine("/urlopy", "Moje urlopy"),
  ]);

  return sendMail({
    to,
    cc,
    subject: `Punktualnik: niedogodziny do pokrycia — ${saldo}`,
    kind: "niedogodziny-przypomnienie",
    ...body,
  });
};

export { mailEnabled };
