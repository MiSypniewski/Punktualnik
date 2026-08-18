# Punktualnik

Ewidencja czasu pracy, nadgodzin i zadań: kiosk dotykowy do odbijania kart
w dziale, timer zadań na koncie pracownika, wnioski o nadgodziny i raporty
kierownika. Next.js 12 (pages router), SQLite przez `better-sqlite3`, Tailwind.
Wygląd opisuje rozdział [System wizualny](#system-wizualny).

## Ściąga — wszystkie komendy

Wszystkim zarządza się z linii poleceń, z katalogu aplikacji (na serwerze: po SSH).
Skrypt admina używa tej samej bazy co aplikacja i **nie wymaga restartu ani builda** —
zmiany widać od razu po odświeżeniu strony.

> Przy `npm run admin` pamiętaj o `--` przed argumentami, inaczej npm zje je po drodze.
> Zamiennie działa `node scripts/admin.js <komenda>`.
> Samo `npm run admin` (bez argumentów) wypisuje tę samą listę komend.

### Konta pracowników

| Komenda | Co robi |
|---|---|
| `npm run admin -- list` | wszyscy użytkownicy: sekcja, rola, obsługiwane sekcje, status |
| `npm run admin -- pending` | tylko konta czekające na aktywację |
| `npm run admin -- activate <email\|id>` | aktywuje konto (dopiero wtedy można się zalogować) |
| `npm run admin -- deactivate <email\|id>` | blokuje konto, nie kasując danych |
| `npm run admin -- passwd <email\|id> <noweHaslo>` | ustawia nowe hasło |
| `npm run admin -- section <email\|id> <slug>` | przenosi pracownika do innej sekcji |

### Role i dostępy

| Komenda | Co robi |
|---|---|
| `npm run admin -- role <email\|id> user` | pracownik: własne karty, nadgodziny i zadania |
| `npm run admin -- role <email\|id> editor` | wspólny kiosk: obsługa kart czasu sekcji (zadań nie raportuje) |
| `npm run admin -- role <email\|id> manager` | kierownik: nadgodziny, projekty, raport zadań, eksporty |
| `npm run admin -- sections <email\|id>` | pokazuje, które sekcje obsługuje kierownik |
| `npm run admin -- sections <email\|id> <a,b,c>` | ustawia je (podmienia całą listę) |
| `npm run admin -- sections <email\|id> -` | czyści przypisania |

**Rola siedzi w tokenie JWT — po jej zmianie użytkownik musi się wylogować i zalogować
ponownie.** Kierownik bez przypisanych sekcji nie widzi nikogo (celowo).

### Działy

| Komenda | Co robi |
|---|---|
| `npm run admin -- section-list` | aktywne sekcje wraz z liczbą pracowników |
| `npm run admin -- section-list --all` | także wyłączone |
| `npm run admin -- section-add <slug> <Etykieta>` | tworzy nowy dział |
| `npm run admin -- section-label <slug> <Etykieta>` | zmienia nazwę widoczną w formularzu |
| `npm run admin -- section-off <slug>` | zdejmuje z rejestracji (dane i dostępy zostają) |
| `npm run admin -- section-on <slug>` | przywraca do wyboru |

`slug` (`magazyn`) to klucz techniczny i adres strony kart `/time/magazyn` — **niezmienny**.
`Etykieta` (`Magazyn Centralny`) to nazwa dla ludzi, do zmiany w każdej chwili.
Szczegóły: [Sekcje (działy)](#sekcje-działy).

### Uruchamianie i wdrożenie

| Komenda | Co robi |
|---|---|
| `npm run dev` | serwer deweloperski (localhost:3000), przeładowuje kod na bieżąco |
| `npm run build` | build produkcyjny — **wymagany po każdej zmianie kodu** |
| `npm run start` | uruchamia zbudowaną aplikację |
| `npm run lint` | ESLint |
| `npm run migrate:airtable -- --dry-run` | jednorazowa migracja kont z Airtable (podgląd) |

Aplikację prowadzi `pm2`. Pełna sekwencja: [Wdrożenie na Mikrus](#wdrożenie-na-mikrus).

### Typowe scenariusze

```bash
# Nowy pracownik (sam się zarejestrował)
npm run admin -- pending
npm run admin -- activate jan@example.pl

# Nowy dział — bez zmiany kodu, builda i deployu
npm run admin -- section-add magazyn Magazyn Centralny
npm run admin -- sections michal@example.pl spedycja,magazyn   # kierownik od razu, choć dział jest pusty

# Nowy kierownik
npm run admin -- role michal@example.pl manager
npm run admin -- sections michal@example.pl spedycja,cns
# ...i powiedz mu, żeby się przelogował

# Likwidacja działu
npm run admin -- section <email> <inny_slug>   # najpierw przenieś ludzi
npm run admin -- section-off stary_dzial       # historia i eksporty zostają nietknięte
```

## Baza danych

Aplikacja korzysta z **lokalnej bazy SQLite** (`better-sqlite3`) — jeden plik na dysku,
bez osobnego procesu serwera bazy. Schemat (tabele `Users`, `Times`, `Overtime`,
`Sections`, `ManagerSections`, `Projects`, `ProjectSections`, `TaskEntries`) tworzony
jest automatycznie przy pierwszym uruchomieniu.

- Domyślna ścieżka: `./data/punktualnik.sqlite` (katalog `data/` jest w `.gitignore`).
- Ścieżkę można nadpisać zmienną `SQLITE_PATH` (zob. `.env.local`).

### Wdrożenie na Mikrus

Produkcja stoi na **Mikrusie 2.1** (1 GB RAM, 10 GB dysku).

1. Ustaw `SQLITE_PATH` na trwałą ścieżkę poza katalogiem aplikacji,
   np. `/home/UŻYTKOWNIK/punktualnik-data/punktualnik.sqlite`,
   żeby baza przeżyła redeploy/rebuild.
2. `pm2 stop` → `npm run build` → `pm2 restart` → `pm2 save`.
   `npm ci` tylko wtedy, gdy zmienił się `package.json`/lock.
3. **Kontener nie ma swapu**, więc OOM ubija proces bez ostrzeżenia. Stąd `pm2 stop`
   przed buildem — żeby build nie konkurował o pamięć z działającą aplikacją.
   W 1 GB `next build` mieści się bez „amfetaminy” (ta była konieczna na Mikrusie 1.0
   z 384 MB). Awaryjnie: `NODE_OPTIONS=--max-old-space-size=768 npm run build`.
4. `better-sqlite3` to moduł natywny. Jeśli na serwerze nie ma gotowego prebuildu
   dla danej wersji Node, potrzebne będą `build-essential` i `python3`
   (`npm rebuild better-sqlite3`).
5. Backup = skopiowanie pliku `.sqlite` (najlepiej przy zatrzymanej aplikacji
   lub `sqlite3 baza.sqlite ".backup kopia.sqlite"`).

Nowe tabele powstają same przy pierwszym starcie — nie ma osobnego kroku
migracyjnego. Po zmianie ról pamiętaj, że **rola siedzi w JWT**: użytkownik musi
się wylogować i zalogować, żeby zobaczyć nowe pozycje w menu.

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
node scripts/admin.js section    5 biedronka_ch22 # zmień sekcję (tylko istniejąca)
node scripts/admin.js passwd     jan@example.pl noweHaslo

# alternatywnie przez npm (uwaga na `--`):
npm run admin -- pending
```

Na Mikrusie: zaloguj się po SSH, wejdź do katalogu aplikacji i uruchom jak wyżej.
Skrypt używa tej samej bazy co aplikacja (`SQLITE_PATH` / domyślnie `./data/punktualnik.sqlite`).
Typowy flow nowego pracownika: rejestracja w aplikacji → `pending` → `activate` →
(jeśli ma obsługiwać karty) `role <id> editor`.

## Sekcje (działy)

Sekcje są słownikiem w tabeli `Sections` i to ona rozstrzyga, jakie działy
istnieją. **Dodanie sekcji to jedna komenda — bez zmiany kodu, builda i deployu.**

```bash
npm run admin -- section-list                        # aktywne (--all: także wyłączone)
npm run admin -- section-add   magazyn Magazyn Centralny
npm run admin -- section-label magazyn Magazyn Główny
npm run admin -- section-off   magazyn               # zdejmij z rejestracji
npm run admin -- section-on    magazyn
```

Sekcja ma `slug` i `label`:

- **`slug`** (`magazyn`) to klucz techniczny — trafia do adresu strony kart
  `/time/magazyn` oraz do `Users.section`, `Times.section` i `ManagerSections.section`.
  Dozwolone są małe litery, cyfry, `-` i `_`. **Slug jest niezmienny**: jego zmiana
  oznaczałaby przepisanie historii w `Times` i unieważnienie linków.
- **`label`** (`Magazyn Główny`) to nazwa dla człowieka, widoczna w formularzu
  rejestracji. Ją można zmieniać dowolnie.

Sekcji się **nie kasuje**, tylko wyłącza (`section-off`): `Times` trzyma sekcję
historycznie, a przypisania kierowników mają dalej obowiązywać. Wyłączona sekcja
znika z formularza rejestracji i nie da się do niej przenieść pracownika,
ale dane i dostępy zostają nietknięte.

Kolejność jest teraz naturalna: najpierw `section-add`, potem można od razu
przypisać kierownika do jeszcze pustej sekcji, a pracownicy dochodzą później.

Nazwy są normalizowane do małych liter, więc `Spedycja` i `spedycja` to ta sama
sekcja. Sekcja spoza słownika jest odrzucana także przez `POST /api/users`
(publiczny endpoint rejestracji), nie tylko przez formularz.

Przy pierwszym uruchomieniu na istniejącej bazie sekcje są przenoszone
automatycznie z `Users.section` i `ManagerSections.section` — etykietą zostaje
sam slug, do poprawienia komendą `section-label`.

> Lokalizacje (`Users.location`) mają wciąż starą postać: lista jest zaszyta
> w `pages/users/register.js` i jej zmiana wymaga builda.

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

### Kto czyje dane widzi

Zasięg jest jawny i trzyma się w jednym miejscu — `services/scope.js`.
Każda trasa pokazująca cudze dane pyta właśnie tam.

| Rola | Widzi |
|---|---|
| `user` | wyłącznie siebie |
| `editor` | własną sekcję (karty czasu, eksport czasów) |
| `manager` | **tylko sekcje jawnie mu przypisane** w tabeli `ManagerSections` |

Przypisanie kierownika do sekcji jest niezależne od tego, w której sekcji sam
figuruje — kierownik z `dyrekcja` może obsługiwać `spedycja` i `cns`, a jedną
sekcję może obsługiwać kilka osób.

```bash
npm run admin -- sections michal@example.pl              # podgląd
npm run admin -- sections michal@example.pl spedycja,cns # ustaw
npm run admin -- sections michal@example.pl -            # wyczyść
```

**Kierownik bez przypisanych sekcji nie widzi nikogo** — to celowa wartość
domyślna, żeby nowe konto nie dostało wglądu w całą firmę przez przeoczenie.
Panel pokazuje wtedy komunikat z komendą do uruchomienia. Komenda odrzuca sekcje
spoza tabeli `Sections`, bo literówka po cichu odcięłaby kierownika od jego ludzi.
Sekcje wyłączone (`isActive = 0`) są dozwolone — kierownik musi widzieć historię
działu, który już nie przyjmuje nowych pracowników.

Zasięg obejmuje: panel nadgodzin, oba eksporty CSV, `GET /api/time/[id]`
i stronę kart `/time/[sekcja]`. Eksport czasów filtruje po `Times.section`,
czyli po sekcji z dnia zapisu — po zmianie zespołu stare dni zostają
u poprzedniego kierownika.

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

## Zadania i projekty

Druga, **niezależna** oś ewidencji obok kart czasu. Karty (`Times`) mówią, że ktoś
był w pracy; zadania (`TaskEntries`) mówią, czym się zajmował. Nic się między nimi
nie waliduje — zapomniana karta nie blokuje raportowania, a brak raportu nie
podważa obecności.

### Kto co może

| | pracownik (`user`) | kiosk (`editor`) | kierownik (`manager`) |
|---|---|---|---|
| raportuje własne zadania | tak | **nie** | tak |
| zakłada projekty | nie | nie | tak |
| widzi zadania zespołu | nie | nie | tak (swoje sekcje) |
| poprawia cudze wpisy | nie | nie | tak, bez limitu daty |
| eksportuje CSV | nie | nie | tak |

**Kiosk nie raportuje zadań i to jest celowe.** Konto `editor` jest współdzielone
przez całą sekcję, więc jego wpis nie miałby właściciela. W praktyce znaczy to,
że każdy pracownik, który ma raportować zadania, potrzebuje **własnego, aktywnego
konta** — inaczej niż przy odbijaniu kart.

### Projekty — bez CLI

Projektami zarządza kierownik na `/zadania/projekty`, w przeglądarce. Świadomie
**nie ma** komend `project-*` w `scripts/admin.js`: skrypt trzyma własną, lustrzaną
kopię schematu, więc każda dopisana tam tabela to kolejne miejsce, gdzie schemat
może się rozjechać.

- Projektu **nie da się skasować**, tylko zarchiwizować — wpisy trzymają `projectID`
  historycznie. Archiwalny znika z wyboru, dane zostają.
- Projekt bez zaznaczonej sekcji jest **ogólnofirmowy** (widzą go wszyscy). To
  odwrotna wartość domyślna niż przy kierownikach, gdzie brak przypisań = nie widzi
  nikogo — tam chodzi o cudze dane osobowe, tu tylko o nazwę projektu.
- Kierownik nie przypisze projektu do sekcji spoza swojego zasięgu.

### Raportowanie — `/zadania`

Timer start/stop z licznikiem na żywo albo wpis ręczny od–do. Opis zadania jest
dowolnym tekstem; aplikacja podpowiada wcześniejsze opisy z historii (natywny
`<datalist>`, filtrowany po wybranym projekcie) i pozwala wznowić poprzednie
zadanie jednym kliknięciem. Podpowiedzi są sortowane po **liczbie użyć**, więc
codzienna rutyna wypada wyżej niż coś zrobionego raz.

Czas liczy się **co do sekundy** (`TaskEntries.seconds`) i tak też jest pokazywany
(„2h 15min 07s”). Wpis potrafi trwać pół minuty — „odbiłem maila”, „podpis na
dokumencie” — a przy zaokrąglaniu do minut taki wpis miał wymiar 0 i nie dawał się
nawet poprawić: formularz edycji odsyłał godziny bez sekund, więc walidacja
„koniec musi się różnić od początku” odrzucała własny wpis. Pola godzin nadal
pokazują „HH:mm”; nietknięte odsyłają oryginalne sekundy (`keepSeconds`
w `utils/`), ręczna zmiana godziny zeruje je.

**Opis i projekt biegnącego timera poprawia się w miejscu**, bez zatrzymywania
licznika — ludzie klikają Start, żeby czas nie uciekał, a co robią, dopisują
chwilę później. Opis zapisuje się 800 ms po ostatnim znaku, projekt natychmiast;
Enter, wyjście z pola, Stop, przełączenie zakładki i zamknięcie karty wypychają
kolejkę od razu, więc nic nie ginie. Zapis idzie akcją `retag` i celowo **nie**
odświeża strony (inaczej kursor wypadałby ze środka zdania).

**Biegnący timer widać w pasku karty przeglądarki** — tytuł strony to
„1:21:35 · Opis — Punktualnik”, na każdej podstronie, nie tylko na `/zadania`
(tak działa Clockify). Licznik na stronie widzi tylko ten, kto na nią patrzy;
do paska kart sięga się wzrokiem z innej zakładki i właśnie wtedy trzeba wiedzieć,
że czas wciąż leci. Dane daje `/api/entries/timer` — własny biegnący wpis i nic
więcej, osobno od managerskiego `/api/entries/running`. Sekundy liczy serwer
(znaczniki są bez offsetu strefy), przeglądarka dorabia je między odpytaniami
i odświeża stan raz na minutę; Start i Stop widać w tytule natychmiast. Karta
schowana w tle nie odpytuje serwera — tytuł tyka lokalnie, a timer zatrzymany
w innej karcie poprawia się przy powrocie do tej.

**„Wznów zadanie” przy biegnącym timerze przełącza się na nowe zadanie**: zamyka
bieżący wpis i startuje kolejny jedną transakcją, tym samym znacznikiem czasu —
bez dziury w dniu i bez zakładki. Przełączenie w ciągu **10 sekund** od startu
kasuje poprzedni wpis: to korekta pomyłki („nie ten projekt”), a nie praca.
Dzieje się to tylko na jawne żądanie (`replaceRunning` w żądaniu); zwykły start
nadal odbija się o `409 already_running`, żeby druga zakładka nie zamykała po
cichu wpisu, o którym nic nie wie.

Reguły, których pilnuje sama baza albo SQL — nie da się ich obejść przez API:

| Reguła | Zachowanie |
|---|---|
| Jeden biegnący timer na osobę | drugi start → `409 already_running` (UNIQUE INDEX) |
| Wpisy nie mogą na siebie nachodzić | `409 overlap`; styk godzin (12:00–13:00 po 10:00–12:00) przechodzi |
| Pracownik edytuje tylko dziś i wczoraj | `409 edit_window_closed` (kierownika okno nie wiąże — `boundByEditWindow` w `services/roles.js`) |
| Momenty równe co do sekundy (10:00:00–10:00:00) | `422 bad_range` — to pomyłka, nie „pełna doba" |

Doba robocza zaczyna się o **3:00**, nie o północy (ta sama granica, której używają
karty czasu). Dzięki temu zmiana kończąca się o 1:00 należy do dnia, w którym się
zaczęła, a o 1:00 w nocy wciąż edytowalny jest dzień, który kalendarzowo minął.
Wpis 22:00–01:00 zapisze się jako 3 godziny w dobie rozpoczęcia.

**Zapomniany timer** domyka się sam na koniec doby roboczej, w której wystartował —
timer zostawiony w piątek zamknie się w sobotę o 3:00, a nie w poniedziałek.
Wpis dostaje flagę „domknięty automatycznie" i żółty pasek; edycja jest
potwierdzeniem i flagę zdejmuje. Nie ma tu crona — domykanie dzieje się przy okazji
wejścia na stronę, więc działa też na Mikrusie.

**Wiersz wpisu ma stałą prawą krawędź.** Godziny, wymiar i przyciski
▶ / ✎ / 🗑 stoją w jednej kolumnie niezależnie od długości opisu — długi opis
zawija się na kolejne linie, zamiast wypychać resztę wiersza niżej. Wcześniej
wiersz był jednym `flex flex-wrap` i to właśnie robił: `truncate` na opisie
ustawia `white-space: nowrap`, więc naturalna szerokość opisu była ogromna,
a flex zawijał pozostałe elementy, zamiast ścisnąć ten jeden. Na telefonie
prawa kolumna schodzi pod opis, dosunięta do prawej.

### Raport kierownika — `/zadania/zarzadzaj`

Na samej górze **„Teraz w toku”** — migawka bieżącej pracy zespołu: kto ma
uruchomiony timer (projekt, opis, od której godziny i ile już trwa), a pod spodem
kto timera nie ma, z godziną ostatniego wpisu i dzisiejszym dorobkiem. Licznik
tyka na żywo, a sama lista dociąga się z `/api/entries/running` co 45 sekund, bez
przeładowywania raportu. Karta schowana w tle nie odpytuje serwera; powrót do niej
odświeża dane od razu.

Ta sekcja **nie podlega filtrom** spod spodu — pokazuje stan na teraz, a nie
wycinek okresu, więc zakres dat czy wybrany projekt nie mają tu czego zawężać.
Timer biegnący ponad 8 godzin dostaje żółte tło: to prawie zawsze zapomniany
licznik, a auto-domknięcie złapie go dopiero o 3:00.

Zawężenie po **sekcji konta**, nie po sekcji wpisu — jedyne takie miejsce w module
i celowo. `token.section` jest zapiekany w JWT przy logowaniu, więc pracownik
przeniesiony do innego działu startuje nowe wpisy ze starą sekcją aż do
przelogowania; przy zawężeniu po sekcji wpisu ta sama osoba wisiałaby jako
„w toku” u poprzedniego kierownika i jako „bez timera” u obecnego.

Brak timera nie znaczy braku pracy: aplikacja nie prowadzi rejestru urlopów ani
zwolnień, a zadania wolno dopisać ręcznie po fakcie. Lista jest podpowiedzią,
z kim warto zamienić słowo — nie listą obecności.

Filtry (zakres dat, projekt, pracownik, nazwa zadania, próg długości wpisu) żyją
w adresie, więc widok da się zalinkować i odświeżyć. Dalsza zawartość: kafelki
podsumowania, rozbicie wg projektów z udziałem procentowym, zestawienie
**obecność vs zaraportowano** per pracownik oraz lista wpisów. Wszystkie te
zestawienia liczą wyłącznie wpisy **zamknięte** — biegnący timer nie ma jeszcze
wymiaru i wchodzi do statystyk dopiero po zatrzymaniu.

Szukanie po nazwie zadania ignoruje wielkość liter **i ogonki** — „sruby” znajdzie
„Śruby montażowe”. SQLite sam tego nie potrafi (jego `LIKE` i `lower()` kończą się
na ASCII), więc porównanie robi funkcja `plContains` zarejestrowana w
`services/entryStats.js`. Filtr zawęża też kafelki, rozbicia i eksport CSV; jedyne,
czego nie rusza, to obecność z kart czasu — ta nie zna pojęcia zadania, więc przy
takim filtrze „Pokrycie” czytamy jako udział szukanych zadań w czasie w pracy.

Kolumna „Różnica” jest **wskazówką, gdzie brakuje raportowania — nie podstawą
rozliczeń**. Obecność pochodzi z kart czasu, zaraportowany czas z wpisów zadań;
to dwie osobne ewidencje i aplikacja nigdy nie każe im się zgadzać.

Kierownik może poprawiać i dopisywać wpisy **bez ograniczenia daty** — cudze
i **własne** — inaczej starszy błąd zostałby w bazie na zawsze, bo pracownik go już
nie sięgnie. Korekta CUDZEGO wpisu zostawia podpis („popr. Anna”); własna poprawka
nie, bo nie ma komu o niej mówić. Regułę trzyma jeden predykat
(`boundByEditWindow` w `services/roles.js`), czytany zarówno przy edycji i usuwaniu
wpisu, jak i przy wpisie ręcznym — dlatego kierownik ma na `/zadania` aktywny ołówek
przy każdym dniu i pole daty zamiast wyboru „dziś/wczoraj”. Timera za nikogo nie
uruchamia ani nie zatrzymuje: nie wie, kiedy tamten faktycznie zaczął i skończył.

Poprawka idzie wprost z tabeli wpisów — ołówek w wierszu otwiera projekt, opis,
datę i godziny. Reguły są te same co przy pracowniku (kolizje, `10:00–10:00`), bez
okna „dziś i wczoraj”. Do wyboru są projekty **sekcji pracownika**, a nie kierownika
— to jego zasięgiem API sprawdza wybór, więc lista z sekcji kierownika podsuwałaby
pozycje kończące się odmową. Projekt, na którym wpis już wisi, zostaje na liście
nawet po archiwizacji: inaczej archiwizacja zamrażałaby stare wpisy i nie dałoby się
poprawić w nich literówki. Przenieść wpis **na** projekt archiwalny nadal nie można.

Tabela na ekranie pokazuje najwyżej **200 wpisów** (przy większej liczbie pojawia
się komunikat) — każdy wiersz jedzie do przeglądarki jako dane strony i przy 500
payload przekraczał próg Next.js. **Eksport CSV limitu nie ma.**

Na telefonie lista wpisów to **karty**, nie tabela: siedmiu kolumn nie da się czytać
wodząc palcem po każdym wierszu. Formularz poprawki jest ten sam w obu układach
(`EntryForm`), więc reguły i zachowanie nie rozjeżdżają się między ekranami.
Podsumowania „wg projektów” i „wg pracowników” zostają tabelami, ale w kontenerze
przewijanym w poziomie — inaczej rozpychały cały dokument szerzej niż ekran.

### Eksport do CSV

`/api/report/zadania` — jak eksport nadgodzin: BOM, średnik, przecinek dziesiętny,
więc plik otwiera się wprost w polskim Excelu. Tylko `manager`, zawsze zawężony do
jego sekcji, nawet gdy jawnie poda `userID` kogoś z zewnątrz.

| Parametr | Znaczenie |
|---|---|
| `tryb=wpisy` | pojedyncze wpisy ze wszystkimi szczegółami |
| `tryb=projekty` | zbiorczo wg projektów: osoby, wpisy, czas, udział % |
| `tryb=porownanie` | obecność vs zaraportowano per pracownik |
| `from`, `to` | zakres dat (wymagane, `YYYY-MM-DD`) |
| `projectID`, `userID`, `minMinutes` | filtry, opcjonalne |
| `q` | fragment nazwy zadania; bez wielkości liter i ogonków, do 100 znaków |

Czas jest w dwóch kolumnach: godziny dziesiętnie z przecinkiem (`2,50` — do
sumowania w arkuszu) i tekst `2h 30min` dla człowieka.

## System wizualny

Wygląd aplikacji jest jeden i nazywa się **„tablica odjazdów”**. Punkt odniesienia
to dworcowa tablica i zegar stacyjny: sygnalizacja czytelna z drugiego końca
pomieszczenia, włosowe linie zamiast ramek, wszystkie liczby monospace, jeden
kolor sygnałowy. Wynika to wprost z tego, jak aplikacja jest używana — kiosk
dotykowy w hali ogląda się z dystansu, a raport kierownika czyta się z bliska.

### Zasada, która trzyma to w ryzach

**Bursztyn znaczy „teraz”.** Biegnący timer, pracujący kafelek na kiosku, wiersz
w „Teraz w toku”, licznik przekraczający osiem godzin, wpis domknięty
automatycznie. Nigdzie indziej. Jedyny wyjątek to belka w znaku firmowym.
Wszystko poza tym jest ciche: promienie 3 px, cienie ledwie obecne, żadnych
gradientów, jedna animacja w całej aplikacji (pulsujący punkt), wyłączana przez
`prefers-reduced-motion`.

Do tego rozróżnienie kształtem: **okrągły punkt = stan na żywo**
(`components/liveDot.js`), **kwadrat = kolor projektu** (`ProjectMark`
w `components/projectColors.js`). Bez tego projekt o kolorze `amber` udawałby
biegnący timer.

### Motyw jasny i ciemny

Przełącznik stoi w pasku stacyjnym, na każdej stronie i dla każdej roli, łącznie
z kioskiem: to ustawienie wyglądu, nie konta — nie ma czego przestawić na cudzą
szkodę, a kiosk stoi w konkretnym pomieszczeniu i bywa, że trzeba mu po prostu
przygasić ekran. Na ekranach węższych niż 640 px przenosi się do rozwijanego
menu, bo w jednym rzędzie nie mieści się razem ze znakiem, zegarem i hamburgerem.
Trzy stany:

| Ikona | Znaczenie |
|---|---|
| ☀ | jasny na stałe, niezależnie od systemu |
| ☾ | ciemny na stałe, niezależnie od systemu |
| ◐ | auto — idzie za ustawieniem systemu i reaguje na jego zmianę bez odświeżania |

Wybór siedzi w `localStorage` pod kluczem `theme`, **nie w bazie**: kiosk to konto
współdzielone, więc ustawienie per konto zmieniałoby motyw wszystkim naraz. Brak
wpisu znaczy „auto”. Konsekwencja: na nowym urządzeniu albo po wyczyszczeniu
danych przeglądarki trzeba wybrać ponownie.

Klasę `dark` na `<html>` ustawia blokujący skrypt w `pages/_document.js`, przed
pierwszym malowaniem strony — gdyby robił to dopiero React, przy każdym wejściu
mignęłoby białe tło.

### Kolory — dla nowych ekranów

Kolory idą **wyłącznie przez nazwy semantyczne** zdefiniowane w
`tailwind.config.js` i podpięte pod zmienne CSS w `styles/globals.css`. W kodzie
stron nie ma ani jednej klasy z palety Tailwinda i ani jednego wariantu `dark:`
(wyjątkiem jest `components/projectColors.js`, gdzie pełne nazwy klas są wymuszone
przez skaner Tailwinda — patrz komentarz w pliku).

Neutrale:

| Token | Do czego |
|---|---|
| `bg-page` | tło strony (ustawione na `body`, rzadko potrzebne wprost) |
| `bg-surface` | płyty, pola, wiersze |
| `bg-raised` | tła wyróżnione — formularze, paski postępu, nagłówki płyt |
| `text-body` | tekst główny |
| `text-muted` | tekst drugoplanowy — nazwy projektów, godziny, podpisy |
| `text-faint` | tekst wygaszony — „(bez opisu)” |
| `border-line` | zwykłe ramki |
| `border-line-strong` | ramki pól formularza |
| `border-line-subtle` | separatory wierszy |

Kolory znaczeniowe występują w czterech odmianach każdy:

| Rodzina | Znaczenie |
|---|---|
| `accent` | działanie główne, linki, aktywna pozycja menu |
| `signal` | **wyłącznie stan „teraz”** i ostrzeżenia |
| `ok` | zatwierdzone, saldo dodatnie, pełna dniówka |
| `danger` | odrzucone, saldo ujemne, błąd |

| Odmiana | Do czego |
|---|---|
| `X` | sam kolor: wypełnienia przycisków, kropki, ramki, duże liczby |
| `X-ink` | tekst kładziony NA `X` |
| `X-soft` | przygaszone tło pod baner, chip, wyróżniony wiersz |
| `X-strong` | tekst drobny — na tle strony i na tle `X-soft` |

Rozdział `X` od `X-strong` jest liczbowy, nie estetyczny: bursztyn o kontraście
wystarczającym dla ramki i dwuipółcentymetrowego licznika nie dociąga do 4,5:1
przy dwunastopunktowym podpisie. Piszemy `text-signal-strong` dla tekstu,
`bg-signal` dla płyty.

### Typografia

| Rola | Krój |
|---|---|
| nagłówki, etykiety, statusy — wersaliki z `tracking-signage` | **Archivo** 600–700 |
| tekst | **Archivo** 400–500 |
| **każda liczba** — zegar, czasy trwania, godziny, salda, kolumny | **IBM Plex Mono** |

Oba kroje leżą w `public/fonts` jako `woff2` i są podpięte przez `@font-face`
w `styles/globals.css`. **Podzbiór `latin-ext` jest obowiązkowy** — bez niego nie
ma polskich znaków. Nie ma tu `next/font` (to Next 12) ani zapytań do Google:
kiosk i telefony w hali bywają na słabym łączu, a produkcja stoi na Mikrusie.
Archivo jest krojem zmiennym, więc cała oś wagi 400–700 mieści się w jednym pliku
na podzbiór.

Podmiana kroju to podmiana plików w `public/fonts`, deklaracji `@font-face`
i `fontFamily` w `tailwind.config.js` — nic więcej nie zna nazw krojów.

### Komponenty

Nowy ekran składa się z `components/ui/`, nie z klas pisanych na miejscu:

| Zamiast | Użyj |
|---|---|
| przycisku z klasami tła i stanu `disabled` | `Button` (`primary`/`secondary`/`ghost`/`danger`/`signal`), `IconButton` |
| pola z etykietą | `Field` + `Input` / `Select` / `Textarea` |
| `<table>` z klasami w każdej komórce | `TableWrap`, `Table`, `Th`, `Td`, `Tr`, `Num` |
| karty albo panelu | `Plate`, `PlateHeader` |
| kolorowego akapitu z komunikatem | `Alert` (`danger`/`ok`/`warn`/`info`) |
| chipa ze statusem | `Badge` |
| kafla z liczbą | `Stat` |
| `<h1>` z opisem strony | `PageHeader` |
| „brak danych” | `EmptyState` |
| emoji jako ikony | `components/ui/icons.js` |

Powłokę daje `BaseLayout` (strażnik sesji) → `AppShell` (pasek, kontener, stopka).
Szerokość strony ustawia się propsem: `<BaseLayout width="narrow">` dla
formularzy, `"wide"` dla raportów, `"full"` dla kiosku, domyślnie `"page"`.
Ekrany sprzed zalogowania używają `AuthLayout`.

Pozycje menu buduje `navItems` w `components/stationRail.js` — widoczność idzie
przez predykaty z `services/roles.js`, a nie przez ręczne porównania ról. Pełny
pasek pokazuje się od **1280 px**; niżej pozycje chowają się pod przycisk menu,
bo przy ośmiu pozycjach kierownika nie mieszczą się obok zegara i konta. Dodając
kolejną pozycję sprawdź pasek na 1280 px — to tam kończy się miejsce.

Uwaga na `@tailwindcss/forms`: plugin twardo maluje pola na biało selektorami
atrybutowymi (`[type='text']`), które wygrywają specyficznością z gołym `input`.
Nadpisanie w `globals.css` przepisuje jego listę selektorów i musi taka zostać.
Druga pułapka stamtąd: pole jest domyślnie `w-full`, więc wąskie pole trzeba
wymusić przez `!w-24` — sam `w-24` przegrywa, bo o zwycięzcy decyduje kolejność
reguł w arkuszu, nie kolejność w atrybucie `class`.

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
