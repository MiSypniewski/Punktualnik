This is a [Next.js](https://nextjs.org/) project bootstrapped with [`create-next-app`](https://github.com/vercel/next.js/tree/canary/packages/create-next-app).

## Baza danych

Aplikacja korzysta z **lokalnej bazy SQLite** (`better-sqlite3`) — jeden plik na dysku,
bez osobnego procesu serwera bazy. Schemat (tabele `Users`, `Times`, `Overtime`)
tworzony jest automatycznie przy pierwszym uruchomieniu.

- Domyślna ścieżka: `./data/punktualnik.sqlite` (katalog `data/` jest w `.gitignore`).
- Ścieżkę można nadpisać zmienną `SQLITE_PATH` (zob. `.env.local`).

### Wdrożenie na Mikrus 1.0

1. Ustaw `SQLITE_PATH` na trwałą ścieżkę poza katalogiem aplikacji,
   np. `/home/UŻYTKOWNIK/punktualnik-data/punktualnik.sqlite`,
   żeby baza przeżyła redeploy/rebuild.
2. `npm ci && npm run build && npm run start`.
3. `better-sqlite3` to moduł natywny. Jeśli na serwerze nie ma gotowego prebuildu
   dla danej wersji Node, potrzebne będą `build-essential` i `python3`
   (`npm rebuild better-sqlite3`).
4. Backup = skopiowanie pliku `.sqlite` (najlepiej przy zatrzymanej aplikacji
   lub `sqlite3 baza.sqlite ".backup kopia.sqlite"`).

## Zarządzanie użytkownikami (panel admina z CLI)

Aktywacja kont i nadawanie roli `editor` (wcześniej robione w UI Airtable)
odbywa się teraz skryptem CLI. Działa też bez logowania do aplikacji,
więc nadaje się do utworzenia pierwszego konta (bootstrap).

```bash
node scripts/admin.js pending                     # nieaktywni (do aktywacji)
node scripts/admin.js list                        # wszyscy
node scripts/admin.js activate   jan@example.pl   # aktywuj (po e-mailu lub id)
node scripts/admin.js deactivate 5                # zablokuj
node scripts/admin.js role       5 editor         # rola: user | editor | manager
node scripts/admin.js section    5 biedronka_ch22 # zmień sekcję
node scripts/admin.js passwd     jan@example.pl noweHaslo

# alternatywnie przez npm (uwaga na `--`):
npm run admin -- pending
```

Na Mikrusie: zaloguj się po SSH, wejdź do katalogu aplikacji i uruchom jak wyżej.
Skrypt używa tej samej bazy co aplikacja (`SQLITE_PATH` / domyślnie `./data/punktualnik.sqlite`).
Typowy flow nowego pracownika: rejestracja w aplikacji → `pending` → `activate` →
(jeśli ma obsługiwać karty) `role <id> editor`.

## Nadgodziny

Osobny moduł rozliczania nadgodzin, niezależny od kart czasu pracy (tabela `Times`).

- `/nadgodziny` — każdy zalogowany: aktualne saldo, formularz zgłoszenia i pełna
  historia własnych wniosków. Rodzaje: *zostaję dłużej* i *praca poza godzinami*
  (dodają do salda) oraz *wcześniejsze wyjście* (odejmuje).
- `/nadgodziny/zarzadzaj` — wyłącznie rola `manager`: wnioski do rozpatrzenia
  (zatwierdź / odrzuć wraz z notatką), salda wszystkich aktywnych pracowników
  i historia z filtrami (pracownik, status, zakres dat).

Zasady:

- **Saldo liczy się wyłącznie z wniosków zatwierdzonych.** Oczekujące i odrzucone
  go nie zmieniają, a `Times.overTime` (flaga „tego dnia ≥ 8h") nie jest tu w ogóle
  używana — to dwie różne rzeczy.
- Datę wniosku można podać wstecz (zgłoszenie faktu) i w przód (planowane wyjście).
- Pracownik może anulować własny wniosek, dopóki ma status *Oczekuje*.
- Rodzaje wniosków definiuje `services/overtimeKinds.js` — dodanie nowego rodzaju
  (wraz ze znakiem) wymaga zmiany tylko w tym pliku.

### Eksport do CSV

`/api/report/nadgodziny` — plik CSV z BOM-em i średnikiem, otwiera się wprost
w polskim Excelu. Przyciski są na stronach: kierownik pobiera z panelu,
pracownik własną historię z `/nadgodziny`.

| Parametr | Znaczenie |
|---|---|
| `tryb=wnioski` (domyślnie) | lista wniosków |
| `tryb=salda` | zestawienie sald wszystkich aktywnych pracowników (tylko `manager`) |
| `userID`, `status`, `from`, `to` | filtry listy wniosków |

Bez roli `manager` parametr `userID` jest ignorowany — eksport zawsze zawęża się
do własnych wniosków. Wymiar jest w dwóch kolumnach: godziny dziesiętnie
z przecinkiem (`1,75` — do liczenia w arkuszu) oraz tekst `+1h 45min`.

### Powiadomienia na Google Chat

Każdy nowy wniosek jest wysyłany jako wiadomość na webhook przestrzeni Google Chat
(kto złożył, rodzaj, wymiar, data, powód i link do panelu kierownika).

```bash
# .env.local — plik jest w .gitignore i NIE trafia do repozytorium
GCHAT_WEBHOOK_URL=https://chat.googleapis.com/v1/spaces/XXXX/messages?key=...&token=...
```

- **URL webhooka jest sekretem** — kto go ma, może pisać na czacie. Nigdy nie
  commituj go ani nie wklejaj do kodu; na serwerze ustaw go w `.env.local`.
- Brak zmiennej = powiadomienia wyłączone, reszta aplikacji działa bez zmian.
- Wysyłka nie blokuje odpowiedzi dla pracownika i ma 5-sekundowy limit czasu:
  awaria albo niedostępność Google Chat **nie może** zablokować złożenia wniosku.
  Błędy lądują w logu serwera z prefiksem `[gchat]`.
- Link w powiadomieniu budowany jest z `NEXTAUTH_URL`, więc na produkcji ta
  zmienna musi wskazywać publiczny adres aplikacji.

Nadanie uprawnień kierownika:

```bash
npm run admin -- role michal@example.pl manager
```

Rola jest zapisana w tokenie JWT, więc **po jej zmianie trzeba się wylogować
i zalogować ponownie**, żeby zaczęła obowiązywać.

## Migracja kont z Airtable (jednorazowo)

Skrypt przenosi **tylko tabelę `Users`** z bazy `AIRTABLE_BASE` do SQLite.
Historia `Times` nie jest migrowana. Czyta przez REST API Airtable
(nie wymaga pakietu `airtable`), z pełną paginacją.

```bash
node scripts/migrateFromAirtable.js --dry-run   # podgląd, bez zapisu
node scripts/migrateFromAirtable.js             # właściwa migracja
# albo: npm run migrate:airtable -- --dry-run
```

Wymaga w `.env.local`: `AIRTABLE_API_KEY`, `AIRTABLE_BASE`. Skrypt **przerwie
się, jeśli tabela `Users` nie jest pusta** (ochrona przed dublowaniem).
Rekordy bez hasła lub ze zdublowanym e-mailem są pomijane i raportowane.
Zachowuje numerację kont (`fields.ID` → `Users.id`).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `pages/index.js`. The page auto-updates as you edit the file.

[API routes](https://nextjs.org/docs/api-routes/introduction) can be accessed on [http://localhost:3000/api/hello](http://localhost:3000/api/hello). This endpoint can be edited in `pages/api/hello.js`.

The `pages/api` directory is mapped to `/api/*`. Files in this directory are treated as [API routes](https://nextjs.org/docs/api-routes/introduction) instead of React pages.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js/) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/deployment) for more details.
