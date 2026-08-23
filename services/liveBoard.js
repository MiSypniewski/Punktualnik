import dayjs from "dayjs";
import db from "./db";
import { now as appNow, toStamp, workDay } from "./workday";

// Migawka "kto z zespołu nad czym teraz pracuje" — sekcja bieżąca na górze
// raportu kierownika (/zadania/zarzadzaj).
//
// Osobny moduł, a nie kolejna funkcja w services/entryStats.js, i to celowo:
// tamten plik jest zbudowany wokół ZAKRESU DAT i sześciu filtrów, a jego
// buildWhere twardo dokłada `AND e.endedAt IS NOT NULL` (biegnący wpis nie ma
// jeszcze wymiaru i psułby sumy). Tutaj jest dokładnie odwrotnie: interesują
// nas wyłącznie wpisy otwarte, bez żadnego filtra. Wspólny cache statementów
// tamtego pliku nie miałby czego trzymać.
//
// Zasięg sekcyjny działa jak wszędzie (services/scope.js): pusta tablica =
// zero wyników, nigdy "wszystko".

// --- sekcja: konta, nie wpisy -----------------------------------------------
//
// Reszta modułu zadań zawęża po `TaskEntries.section`, czyli po sekcji z chwili
// zapisu — bo raport opisuje przeszłość i sekcja ma tam zostać historyczna.
// Ten widok pyta o coś innego: KTO Z MOICH LUDZI pracuje teraz. Stąd zawężenie
// po `Users.section`, i to nie jest kosmetyka:
//
// `token.section` jest zapiekany w JWT przy logowaniu (callback `jwt`
// w pages/api/auth/[...nextauth].js wypełnia token tylko gdy `user` istnieje),
// a wpis dostaje sekcję właśnie z tokenu. Pracownik przeniesiony do innego
// działu startuje więc NOWE wpisy ze STARĄ sekcją aż do przelogowania. Przy
// zawężeniu po `e.section` ta sama osoba wisiałaby jako "w toku" u poprzedniego
// kierownika i jednocześnie jako "bez timera" u obecnego. Po `u.section` obie
// listy zawsze mówią o tym samym zbiorze ludzi.

const placeholders = (count) => Array.from({ length: count }, (_, i) => `@sec${i}`).join(", ");

const runningCache = new Map();
const idleCache = new Map();

const stmtRunning = (count) => {
  if (!runningCache.has(count)) {
    runningCache.set(
      count,
      db.prepare(`
        SELECT e.id, e.userID, e.projectID, e.startedAt, e.description,
               u.name, u.surname, u.section,
               p.name AS projectName, p.client AS projectClient, p.color AS projectColor
          FROM TaskEntries e
          JOIN Users u    ON u.id = e.userID
          LEFT JOIN Projects p ON p.id = e.projectID
         WHERE e.endedAt IS NULL
           AND u.section IN (${placeholders(count)})
         ORDER BY e.startedAt, u.surname COLLATE NOCASE`)
    );
  }
  return runningCache.get(count);
};

// Kto NIE ma teraz timera. Rola i aktywność konta wg tego samego kryterium co
// kafelki sekcji (services/getUsers.js): `editor` to wspólne konto kiosku, nie
// człowiek, a zwolniony pracownik nie ma czego robić na liście dzisiejszej
// pracy. Świadomie NIE używamy tu getAllUsers() — tamta lista zasila dropdowny
// filtrów i celowo pokazuje też konta wyłączone, żeby dało się filtrować stare
// dane po ludziach, których już nie ma.
//
// Wykluczenie osób z biegnącym timerem idzie przez NOT EXISTS, bo trafia
// w częściowy indeks idx_entries_running (services/db.js:205) i nie wymaga
// zestawiania obu list w JS.
const stmtIdle = (count) => {
  if (!idleCache.has(count)) {
    idleCache.set(
      count,
      db.prepare(`
        SELECT u.id, u.name, u.surname, u.section,
               t.lastEndedAt,
               COALESCE(t.seconds, 0) AS seconds,
               -- Rodzaj zatwierdzonej nieobecności obejmującej dzisiaj, albo NULL.
               -- Podzapytanie, a nie kolejny LEFT JOIN: przy dwóch złączeniach do
               -- tabel "wiele" wiersze mnożyłyby się wzajemnie i dzisiejszy czas
               -- policzyłby się tylekroć, ile ktoś ma nieobecności.
               (SELECT a.kind FROM Absences a
                 WHERE a.userID = u.id AND a.status = 'approved'
                   AND a.dateFrom <= @today AND a.dateTo >= @today
                 LIMIT 1) AS absenceKind
          FROM Users u
          LEFT JOIN (
            SELECT userID, MAX(endedAt) AS lastEndedAt, SUM(seconds) AS seconds
              FROM TaskEntries
             WHERE data = @today AND endedAt IS NOT NULL
             GROUP BY userID
          ) t ON t.userID = u.id
         WHERE u.isActive = 1
           AND u.role IN ('user', 'manager')
           AND u.section IN (${placeholders(count)})
           AND NOT EXISTS (
             SELECT 1 FROM TaskEntries r WHERE r.userID = u.id AND r.endedAt IS NULL
           )
         ORDER BY u.surname COLLATE NOCASE, u.name COLLATE NOCASE`)
    );
  }
  return idleCache.get(count);
};

// Ile sekund biegnie timer — liczone NA SERWERZE i wysyłane gotowe.
//
// Przeglądarka nie może tego policzyć sama ze `startedAt`, bo znacznik jest
// zapisany bez offsetu strefy (services/workday.js): komputer kierownika
// ustawiony na inną strefę albo z przestawionym zegarem pokazywałby czas
// przesunięty o godziny. Odejmowanie robimy tak samo jak secondsBetween
// w services/taskEntries.js — obie strony w tym samym "naiwnym" kształcie,
// więc różnica jest poprawna niezależnie od strefy, w której stoi proces.
const elapsedSeconds = (startedAt, nowStamp) =>
  Math.max(0, dayjs(nowStamp).diff(dayjs(startedAt), "second"));

/**
 * @param {string[]} sections zasięg z services/scope.js
 * @returns {{running: object[], idle: object[], generatedAt: string}}
 */
export const getLiveBoard = (sections) => {
  const list = Array.isArray(sections) ? sections : [];
  const nowStamp = toStamp(appNow());

  if (list.length === 0) {
    return { running: [], idle: [], generatedAt: nowStamp };
  }

  const params = {};
  list.forEach((s, i) => {
    params[`sec${i}`] = String(s);
  });

  // Oba zapytania w JEDNEJ transakcji: między nimi ktoś mógłby kliknąć Stop
  // i ta sama osoba zniknęłaby z obu list albo pojawiła się na obu naraz.
  // W better-sqlite3 transakcja jest synchroniczna i praktycznie darmowa.
  const read = db.transaction(() => ({
    running: stmtRunning(list.length).all(params),
    idle: stmtIdle(list.length).all({ ...params, today: workDay() }),
  }));

  const { running, idle } = read();

  return {
    running: running.map((r) => ({ ...r, elapsedSec: elapsedSeconds(r.startedAt, nowStamp) })),
    idle,
    generatedAt: nowStamp,
  };
};

export default getLiveBoard;
