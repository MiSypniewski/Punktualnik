import dayjs from "dayjs";
import "dayjs/locale/pl";
import db from "./db";
import { sendMail, appUrl, mailEnabled } from "./mailer";
import { absenceKindLabel } from "./absenceKinds";
import { kindLabel, signedMinutes } from "./overtimeKinds";
import getOvertimeBalance from "./getOvertimeBalance";
import { formatMinutes, formatDuration } from "../utils";

dayjs.locale("pl");

// Treści powiadomień mailowych i lista adresatów.
//
// Reguła adresowania jest jedna dla wszystkich czterech powiadomień:
// wiadomość dostaje PRACOWNIK, którego sprawa dotyczy (To), oraz KOMPLET
// kierowników jego sekcji (Cc). Nie jeden kierownik, nie ten, który akurat
// kliknął — cała grupa przypisana do sekcji w tabeli ManagerSections, bo
// zastępstwo w czasie urlopu jest normalną sytuacją, a wiadomość wysłana do
// jednej osoby przepada razem z jej nieobecnością.
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

const dzien = (stamp) => dayjs(stamp).format("dddd, D MMMM YYYY");
const godzina = (stamp) => dayjs(stamp).format("HH:mm");

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
    subject: `Punktualnik: brak odbicia wyjścia — ${dayjs(card.data).format("DD.MM.YYYY")}`,
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
    subject: `Punktualnik: niezakończone zadanie — ${dayjs(entry.data).format("DD.MM.YYYY")}`,
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

  const from = dayjs(absence.dateFrom).format("DD.MM.YYYY");
  const till = dayjs(absence.dateTo).format("DD.MM.YYYY");
  const zakres = from === till ? from : `${from} – ${till}`;

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
    `UWAGA: urlop trzeba dodatkowo wypisać w systemie Comarch. Zgoda w Punktualniku nie przenosi się tam sama — bez wpisu w Comarchu urlop nie jest rozliczony.`,
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
    ["Data", dayjs(request.data).format("DD.MM.YYYY")],
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

export { mailEnabled };
