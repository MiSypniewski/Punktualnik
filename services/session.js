import { getToken } from "next-auth/jwt";
import db from "./db";

// Sesja sprawdzana w bazie przy KAŻDYM żądaniu.
//
// Do tej pory trasy wołały samo getToken(), czyli wierzyły ciasteczku JWT.
// To ciasteczko żyje 30 dni i next-auth odnawia je przy każdym
// /api/auth/session, więc w praktyce nie wygasało nigdy. Wynikały z tego trzy luki:
//
// - `admin.js deactivate` nie odcinał zwolnionego pracownika, bo jego token był
//   dalej ważny, a nikt nie pytał bazy o isActive.
// - Rola i sekcja pochodziły z tokenu. Kierownik, któremu odebrano rolę, dalej
//   zatwierdzał wnioski, dopóki sam się nie wylogował.
// - Zmiana hasła po wycieku nie wylogowywała osoby, która je przejęła.
//
// Koszt: jedno zapytanie po kluczu głównym, rzędu mikrosekund na wątku głównym,
// czyli tyle co reszta odczytów w trasach. To nie jest zapis, więc nie bierze
// blokady (README, "Kiedy aplikacja muli").

const findSessionUser = db.prepare(
  `SELECT id, name, role, section, location, isActive, sessionVersion FROM Users WHERE id = ?`
);

/**
 * Wiersz konta, jeśli token jest wciąż ważny, w przeciwnym razie null.
 *
 * Brak `sv` w tokenie czytamy jako 0. Tak wyglądają tokeny wydane przed
 * wprowadzeniem wersji, a kolumna ma DEFAULT 0, więc wdrożenie nikogo nie wyrzuca.
 */
export const loadSessionUser = (token) => {
  const id = Number(token?.userID ?? token?.id);
  if (!Number.isInteger(id) || id <= 0) return null;

  const user = findSessionUser.get(id);
  if (!user || !user.isActive) return null;
  if (Number(token.sv ?? 0) !== Number(user.sessionVersion)) return null;

  return user;
};

/** Token z polami uprawnień nadpisanymi bieżącym stanem bazy. */
export const withCurrentUser = (token, user) => ({
  ...token,
  name: user.name,
  role: user.role,
  section: user.section,
  location: user.location,
});

/**
 * Zamiennik `getToken({ req })` dla tras API i getServerSideProps. Zwraca null
 * dokładnie wtedy, gdy wcześniej brak tokenu, więc wołający nie zmienia się
 * poza samym importem.
 */
export const getActiveToken = async (req) => {
  const token = await getToken({ req });
  if (!token) return null;

  const user = loadSessionUser(token);
  return user ? withCurrentUser(token, user) : null;
};
