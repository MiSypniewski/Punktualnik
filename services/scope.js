import { getManagerSections } from "./managerSections";
import { canApproveOvertime, isStaff } from "./roles";

// Jedno miejsce odpowiadające na pytanie "czyje dane wolno oglądać temu
// zalogowanemu". Każda trasa, która pokazuje cudze dane, pyta właśnie tutaj —
// dzięki temu zmiana zasad nie wymaga obchodzenia kilkunastu endpointów.
//
//  manager — wyłącznie sekcje jawnie mu przypisane (tabela ManagerSections).
//            Brak przypisań = nie widzi nikogo. To celowo bezpieczna wartość
//            domyślna: nowy kierownik bez konfiguracji nie zobaczy cudzej firmy.
//  editor  — własna sekcja, bo tylko jej karty czasu obsługuje.
//  user    — nikogo; widzi wyłącznie siebie (kontrola po userID, nie po sekcji).

/** @returns {string[]} sekcje, których dane wolno oglądać */
export const visibleSections = (token) => {
  if (!token) return [];
  if (canApproveOvertime(token.role)) return getManagerSections(token.userID);
  if (isStaff(token.role)) return token.section ? [token.section] : [];
  return [];
};

/** Czy ten zalogowany widzi dane pracownika z podanej sekcji. */
export const canSeeSection = (token, section) => visibleSections(token).includes(section);

/**
 * Czy wolno oglądać dane konkretnego pracownika: własne zawsze, cudze tylko
 * gdy jego sekcja mieści się w zasięgu.
 * @param {object} token
 * @param {{id: number, section: string}} user
 */
export const canSeeUser = (token, user) => {
  if (!user) return false;
  if (Number(token.userID) === Number(user.id)) return true;
  return canSeeSection(token, user.section);
};
