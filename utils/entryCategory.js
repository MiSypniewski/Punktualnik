// Kategorie wpisu z punktu widzenia kierownika — czy wpis powstał "jak trzeba".
//
// Liczy je SQL w services/entryStats.js (CATEGORY_SQL); tu są wyłącznie nazwy,
// wspólne dla panelu /zadania/zarzadzaj i eksportu. Rozjazd podpisów między
// ekranem a plikiem znaczyłby, że kierownik szuka w arkuszu kategorii, której
// nie widział na ekranie.
//
// Ten plik NIE importuje niczego z services/ — wchodzi do bundla przeglądarki
// (ta sama zasada co w utils/emptyTimer.js). Pracownik go nie dostaje w praktyce,
// bo używa go tylko strona kierownika.

/** Podpis w eksporcie i w legendzie paska. */
export const CATEGORY_LABEL = {
  clean: "timer",
  manual: "ręczny",
  edited: "czas edytowany",
  auto: "auto",
};

/** Krótki znacznik przy wierszu listy; "auto" ma już własny, istniejący. */
export const CATEGORY_TAG = {
  manual: "ręczny",
  edited: "edyt.",
};
