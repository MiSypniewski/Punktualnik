// Przykłady z instrukcji API. Jeden plik dla strony /users/klucze-api/instrukcja
// i dla scripts/apidocs-check.js, który je uruchamia w tej kolejności. CommonJS,
// bo skrypt nie przechodzi przez webpacka (ten sam zabieg co services/passwordParams.cjs).

const AUTH = `-H "Authorization: Bearer $PUNKTUALNIK_KEY"`;
const JSON_TYPE = `-H "Content-Type: application/json"`;

const apiExamples = ({ baseUrl, today }) => {
  const api = `${baseUrl}/api/v1`;
  const send = (method, body, path) =>
    `curl -X ${method} ${AUTH} ${JSON_TYPE} \\\n  -d '${JSON.stringify(body)}' \\\n  ${api}${path}`;

  return {
    exportKey: {
      title: "macOS i Linux: zapisanie klucza na czas sesji terminala",
      command: `export PUNKTUALNIK_KEY="tu-wklej-klucz"`,
    },
    me: {
      title: "Sprawdzenie klucza",
      command: `curl ${AUTH} ${api}/me`,
      note: "Odpowiedź pokazuje Twoje konto, uprawnienia klucza i datę ważności.",
    },
    projects: {
      title: "Lista projektów, z której bierzesz projectID",
      command: `curl ${AUTH} ${api}/projects`,
    },
    start: {
      title: "Start",
      command: send("POST", { projectID: 3, description: "Przegląd umowy" }, "/timer/start"),
      note: "Projekt i opis można dodać później. Gdy timer już biegnie, dostaniesz błąd 409.",
    },
    patch: {
      title: "Zmiana opisu, projektu albo godziny startu",
      command: send("PATCH", { description: "Przegląd umowy, część 2" }, "/timer"),
      note: 'Zmieniają się tylko podane pola: projectID, description i from (godzina startu, np. "09:15").',
    },
    running: {
      title: "Co teraz biegnie",
      command: `curl ${AUTH} ${api}/timer`,
    },
    switchTask: {
      title: "Przełączenie na inne zadanie",
      command: send("POST", { projectID: 3, description: "Spotkanie", replaceRunning: true }, "/timer/start"),
      note: "Zamyka bieżące zadanie i od razu zaczyna nowe. Bieżące musi mieć opis i projekt, chyba że trwa krócej niż 10 sekund: wtedy zostaje usunięte.",
    },
    stop: {
      title: "Stop",
      command: `curl -X POST ${AUTH} ${api}/timer/stop`,
      note: "Zadanie bez opisu albo bez projektu nie zostanie zatrzymane: dostaniesz błąd 422, a licznik biegnie dalej.",
    },
    list: {
      title: "Wpisy z zakresu dat",
      command: `curl ${AUTH} "${api}/entries?from=${today}&to=${today}"`,
      note: "Najwyżej 31 dni naraz. Bez parametrów dostaniesz dzisiejszą dobę roboczą.",
    },
    create: {
      title: "Dopisanie wpisu",
      command: send("POST", { projectID: 3, description: "Telefon do klienta", data: today, from: "08:00", to: "08:30" }, "/entries"),
      note: "Komplet pól jest obowiązkowy. Odpowiedź zawiera numer wpisu (id) potrzebny do poprawy i skasowania.",
    },
    update: {
      title: "Poprawa wpisu",
      command: send("PUT", { projectID: 3, description: "Telefon do klienta i notatka", data: today, from: "08:00", to: "08:45" }, "/entries/123"),
      note: "Trzeba podać komplet pól, także te bez zmian. Biegnący wpis zmieniasz przez PATCH na timerze.",
    },
    remove: {
      title: "Skasowanie wpisu",
      command: `curl -X DELETE ${AUTH} ${api}/entries/123`,
      note: "Nieodwracalne, także dla kierownika.",
    },
  };
};

module.exports = { apiExamples };
