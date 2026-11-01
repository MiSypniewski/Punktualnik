// Uprawnienia kluczy API. Plik w utils/, bo korzystają z niego i serwer,
// i strona /users/klucze-api, a services/ ciągnie za sobą bazę.

export const API_SCOPES = ["read", "timer", "entries:write", "entries:delete"];

export const API_SCOPE_LABEL = {
  read: "Odczyt wpisów, timera i projektów",
  timer: "Sterowanie timerem: start, stop i zmiana opisu",
  "entries:write": "Dopisywanie i poprawianie wpisów z dziś i wczoraj",
  "entries:delete": "Kasowanie wpisów z dziś i wczoraj",
};

export const API_KEY_DAYS = [30, 90, 180, 365];
export const API_KEY_DEFAULT_DAYS = 90;
export const API_KEY_MAX_ACTIVE = 5;
