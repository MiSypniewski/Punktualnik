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
| `npm run admin -- role <email\|id> manager` | kierownik: nadgodziny, urlopy, projekty, raport zadań, korekta kart czasu, eksporty |
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
| `node scripts/loadtest.js` | test obciążeniowy uruchomionej aplikacji (patrz niżej) |
| `npm run migrate:airtable -- --dry-run` | jednorazowa migracja kont z Airtable (podgląd) |
| `npm run mail:test -- adres@example.pl` | test poczty wychodzącej: sprawdza logowanie do SMTP-a i wysyła jedną wiadomość |

Aplikację prowadzi `pm2`. Pełna sekwencja: [Wdrożenie na Mikrus](#wdrożenie-na-mikrus).

### Typowe scenariusze

```bash
# Nowy pracownik (formularz /users/register wypełnił ktoś zalogowany)
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
`Sections`, `ManagerSections`, `Projects`, `ProjectSections`, `TaskEntries`,
`Absences`, `LeaveAllowance`) tworzony jest automatycznie przy pierwszym
uruchomieniu.

- Domyślna ścieżka: `./data/punktualnik.sqlite` (katalog `data/` jest w `.gitignore`).
- Ścieżkę można nadpisać zmienną `SQLITE_PATH` (zob. `.env.local`).

### Wdrożenie na Mikrus

Produkcja stoi na **Mikrusie 2.1** (1 GB RAM, 10 GB dysku).

1. Ustaw `SQLITE_PATH` na trwałą ścieżkę poza katalogiem aplikacji,
   np. `/home/UŻYTKOWNIK/punktualnik-data/punktualnik.sqlite`,
   żeby baza przeżyła redeploy/rebuild.
2. `pm2 stop` → `npm run build` → `pm2 restart` → `pm2 save`.
   `npm ci` tylko wtedy, gdy zmienił się `package.json`/lock.
   Konfigurację procesu opisuje `ecosystem.config.js` — patrz [pm2](#pm2--konfiguracja-i-logi).
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

### pm2 — konfiguracja i logi

Proces opisuje `ecosystem.config.js` w katalogu aplikacji. **Pierwsze uruchomienie
po wdrożeniu tego pliku wymaga usunięcia starego wpisu**, inaczej pm2 zrobi drugi
proces obok istniejącego:

```bash
pm2 delete Punktualnik
pm2 start ecosystem.config.js
pm2 save
```

Potem wystarcza `pm2 restart Punktualnik`.

Konfiguracja pilnuje trzech rzeczy, których wcześniej nie było: znaczników czasu
w logach, jednej instancji (klaster oznaczałby kilka procesów piszących do tego
samego pliku SQLite — patrz niżej) i restartu przy 700 MB, żeby OOM-killer nie
ubił procesu bez śladu.

Logi rosną bez końca, a dysk ma 10 GB — **rotację włącz raz**:

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 14
```

### Test obciążeniowy

`scripts/loadtest.js` symuluje N równoległych przeglądarek chodzących po
najcięższych stronach i mierzy p50/p95/max czasu odpowiedzi. Bez zależności,
działa na uruchomionej aplikacji (dev lub produkcyjnej):

```bash
npm run build && npm run start          # w jednym terminalu
node scripts/loadtest.js --users 12     # w drugim
```

Domyślnie bije bez sesji, więc mierzy koszt SSR do momentu odmowy. Żeby zmierzyć
realne strony, podaj ciastko zalogowanej sesji (DevTools → Application → Cookies):

```bash
node scripts/loadtest.js --users 12 --cookie "next-auth.session-token=..."
```

Liczy się **max i p95**, nie średnia: przy jednym procesie z synchroniczną bazą
średnia potrafi wyglądać świetnie, podczas gdy co dwudziesty użytkownik czeka
kilka sekund. Wszystko powyżej sekundy warto zestawić z `/api/health`.

### Kiedy „aplikacja muli” — co sprawdzić

| Komenda | Czego szukać |
|---|---|
| `pm2 describe Punktualnik` | `restarts` (powinno stać w miejscu) i zużycie pamięci |
| `pm2 logs Punktualnik --lines 200 --nostream` | wpisy `[error]` i `[warn]` |
| `pm2 logs Punktualnik \| grep eventloop` | ostrzeżenia o zablokowanej pętli zdarzeń |
| `/api/health` w przeglądarce (po zalogowaniu) | `eventLoop.maxLagMs` i `db.probeMs` |

`eventLoop.maxLagMs` to najdłuższa chwila od startu procesu, w której serwer nie
odpowiadał **nikomu**. Kilkanaście milisekund to norma. Wartości rzędu sekund
znaczą, że coś synchronicznego blokuje wszystkich — a przy tej aplikacji
synchroniczne jest każde zapytanie do bazy (`better-sqlite3` nie ma innego trybu).

**Dlaczego to ma znaczenie:** 21.08.2026 aplikacja przestała odpowiadać przy
dwunastu jednoczesnych użytkownikach (Cloudflare 522), mimo że proces żył i pm2 nie
odnotował restartu. Przyczyną były dwa równoległe połączenia SQLite w jednym procesie
(Next 12 ma osobne runtime'y dla stron i dla API, a singleton połączenia był wyłączony
w produkcji) plus zapis wykonywany przy każdym wejściu na stronę. `better-sqlite3` jest
synchroniczne, więc kolizja o blokadę zapisu zamraża **cały** serwer — także żądania,
które niczego nie zapisują.

Zmierzone na gałęzi sprzed poprawki: cudza blokada trzymana 6 s wydłużyła każde
żądanie do 5,7 s. Po poprawce (jedno połączenie, `busy_timeout` 3 s, sprzątanie
z limitem 250 ms i bez rzucania wyjątkiem) ta sama blokada daje 0,4 s i wpis
`[warn] auto-domykanie pominięte` w logu.

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
Typowy flow nowego pracownika: formularz `/users/register` → `pending` →
`activate` → (jeśli ma obsługiwać karty) `role <id> editor`.

**Formularz rejestracji wymaga zalogowania** — konto zakłada ktoś, kto już je ma
(kiosk nie, to konto współdzielone). Nie jest to samoobsługa z ulicy: `POST
/api/users` bez sesji odpowiada 401, bo inaczej dowolna osoba z internetu
wsypywałaby wiersze do tabeli `Users` i listy „do aktywacji”. Konto pierwsze
oraz konta zakładane hurtem robi się i tak z linii poleceń.

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

## Karty czasu

Odbicia z kiosku (tabela `Times`). Kafelek na tablicy sekcji ma dwa dotknięcia:
pierwsze zapisuje wejście, drugie wyjście. Między nimi wpis ma status
`workInProgress` i leci licznik.

### Domykanie o 3:00

Drugiego dotknięcia często nie ma — ktoś wychodzi bocznym wyjściem, ktoś zapomina.
Taki wpis zostawał otwarty **na zawsze**: nie liczył się jako dniówka w żadnym
raporcie, a na ścianie wisiał z licznikiem lecącym trzecią dobę.

Na granicy doby roboczej (3:00) zadanie nocne domyka je same:

- **koniec = wejście + 8 h**, `totalWorkTime` = `08:00:00`, status `finishWork`;
- wpis dostaje flagę `autoClosed`, a kafelek i panel korekty pokazują znacznik
  **`auto`**.

Ta godzina jest **założona, nie zmierzona** — stąd znacznik i stąd mail
(zob. [Powiadomienia mailowe](#powiadomienia-mailowe)). Reguła jest inna niż przy
zadaniach, gdzie timer zamyka się na granicy doby: tam wpis mierzy czas przy
robocie i „do 3:00" jest najbliższą prawdą, jaką da się obronić, a tutaj karta
mówi o dniówce — a dniówka trwająca 19 godzin jest w eksporcie do kadr oczywistym
fałszem. Kafelek `auto` ma **paletę neutralną**, nie zieloną: zieleń w tym systemie
znaczy „przepracowane i pełne", czyli dokładnie to zdanie, którego tu nie wolno
postawić.

**Nie ma tu crona** — na Mikrusie go nie ma, a drugi proces przy tej samej bazie
SQLite to przyczyna awarii z 21.08.2026. Budzikiem jest `setInterval` wewnątrz
procesu Next (`services/nightlyJob.js`), a o tym, czy jest co robić, rozstrzyga
**zapadka w tabeli `JobRuns`**: trzyma dobę roboczą, dla której zadanie już poszło.

| Sytuacja | Co się dzieje |
|---|---|
| Restart procesu o 3:05, po przebiegu | nic — zapadka trzyma dzisiejszą dobę |
| Restart o 2:59, przed przebiegiem | przebieg leci normalnie po 3:00 |
| Proces leżał całą noc, wstaje o 8:00 | **nadrabia** zaległy przebieg od razu przy starcie |
| Pierwsze uruchomienie na tej bazie | zapadka zakładana w ciszy, bez wysyłki — inaczej wdrożenie rozesłałoby lawinę maili o kartach otwartych od miesięcy |
| `next build` obok działającej aplikacji | budzik się nie instaluje (`NEXT_PHASE`), żeby maili nie wysłał proces, który za chwilę znika |

Domykanie nadrabia **wszystkie** zaległe doby (`<= dzień`), powiadomienia idą
**tylko** o tej, która właśnie się skończyła: mail o karcie sprzed trzech tygodni
nie ma już czego naprawić.

### Korekta — `/time/zarzadzaj`

Wyłącznie rola `manager`, w zasięgu z [Kto czyje dane widzi](#kto-czyje-dane-widzi).
Trzy operacje:

- **poprawa godzin** istniejącej karty — przelicza `totalWorkTime` tą samą funkcją,
  której używa kafelek (`utils/index.js`: `DifferenceTime`), i **zdejmuje flagę
  `autoClosed`**: korekta jest właśnie tym potwierdzeniem, o które prosił znacznik;
- **dopisanie karty** za dzień, w którym nikt nie odbił wejścia. Dzień, na który
  pracownik ma już kartę, jest odrzucany (`409`) — dwa wpisy na jedną dobę
  rozstrajają dopasowanie kafelka;
- **usunięcie** wpisu odbitego przez pomyłkę. Nieodwracalne: `Times` nie ma
  statusów ani miejsca na notatkę, więc ślad (kto, kiedy, czyja karta, powód)
  idzie do logu serwera z prefiksem `[manageTime]`.

Każda zmiana zostaje **podpisana** (`editedBy`, `editedByName`) i widać ją
w tabeli jako `popr.`. Okno „dziś i wczoraj", które wiąże pracownika w module
zadań, kierownika tu nie dotyczy — odpowiada za poprawność ewidencji, więc musi
sięgnąć także starszego błędu.

Godziny wpisuje się jako `HH:MM`, a serwer sam przypina je do doby roboczej karty:
godzina wcześniejsza niż 3:00 należy do następnego dnia kalendarzowego, więc
zmianę nocną wpisuje się wprost jako `22:00 – 01:00` i wychodzą z niej trzy
godziny, a nie ujemne dwadzieścia jeden.

> Uprawnienie `canEditTimes` jest **osobne** od `canPunchCards`, choć obie
> prowadzą do tej samej tabeli. Kiosk stoi w miejscu publicznym i klika go byle
> kto stojący przed tabletem; przepisywanie cudzych dniówek sprzed miesiąca nie
> ma prawa być o jedno dotknięcie od odbicia karty.

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
- **Kierownik może usunąć każdy wniosek ze swoich sekcji, w dowolnym statusie.**
  Wniosek nie znika z bazy — dostaje status *Cofnięty*, podpis („Cofnął: …”)
  i **obowiązkowy powód**. Saldo liczy wyłącznie wnioski zatwierdzone, więc po
  cofnięciu poprawia się samo. To narzędzie do odkręcania własnej pomyłki
  (zatwierdzone przez nieuwagę) i do sprzątania zgłoszeń wpisanych bez pokrycia.
- *Anulowany* i *Cofnięty* to dwie różne rzeczy: pierwsze robi pracownik przed
  decyzją, drugie kierownik — w każdej chwili. Jeden wspólny status znaczyłby, że
  po pół roku nie da się odróżnić „rozmyślił się” od „kierownik wycofał zgodę”.
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

Zasięg obejmuje: panel nadgodzin, oba eksporty CSV, `GET /api/time/[id]`,
stronę kart `/time/[sekcja]` oraz [korektę kart](#korekta--timezarzadzaj).
Ta ostatnia zawęża się po `Times.section`, czyli po sekcji Z DNIA ZAPISU — tą samą
regułą, którą składa listę, więc kierownik nigdy nie zobaczy w tabeli wiersza,
którego nie da się zapisać. Eksport czasów filtruje po `Times.section`,
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

### Powiadomienia mailowe

Drugi, **niezależny** kanał obok Google Chat. Czat mówi „jest nowy wniosek do
rozpatrzenia" i trafia na wspólną przestrzeń; mail jest imienny i mówi, jak sprawa
się skończyła. Żaden nie zastępuje drugiego.

Adresat jest zawsze ten sam: **pracownik, którego sprawa dotyczy** (pole `To`)
oraz **komplet kierowników jego sekcji** (pole `Cc`) — wszyscy przypisani
w `ManagerSections`, a nie ten jeden, który kliknął. Zastępstwo w czasie urlopu
jest normalną sytuacją, a wiadomość wysłana do jednej osoby przepadłaby razem
z jej nieobecnością. Kierownik będący jednocześnie bohaterem sprawy dostaje
wiadomość raz, nie dwa.

| Kiedy | Treść |
|---|---|
| **Brak odbicia wyjścia** — karta domknięta o 3:00 | dzień, godzina wejścia, wpisana godzina wyjścia z zaznaczeniem, że jest ZAŁOŻONA, link do korekty |
| **Niezakończone zadanie** — timer domknięty o 3:00 | projekt, opis, start, wymiar po domknięciu, link do `/zadania` |
| **Zatwierdzony urlop** | rodzaj, termin, dni robocze, kto zatwierdził **i przypomnienie o obowiązku wypisania urlopu w systemie Comarch** |
| **Zatwierdzone nadgodziny / wcześniejsze wyjście** | rodzaj, wymiar ze znakiem, data, kto zatwierdził, saldo po tej decyzji |

Wysyłamy **wyłącznie przy zatwierdzeniu**. Odrzucenie, anulowanie przez pracownika
i cofnięcie przez kierownika zostają poza tym kanałem.

```bash
# .env.local — plik jest w .gitignore i NIE trafia do repozytorium
email_login=anetka@opss.pl
email_password=…
# poniższe mają wartości domyślne zgodne z instrukcją OVH i można je pominąć
SMTP_HOST=ssl0.ovh.net          # alternatywnie smtp.mail.ovh.net
SMTP_PORT=465                   # SSL/TLS od pierwszego bajtu, bez STARTTLS
EMAIL_FROM=Punktualnik <anetka@opss.pl>
```

- **Brak `email_login` lub `email_password` = powiadomienia wyłączone**, reszta
  aplikacji działa bez zmian. Ta sama zasada co przy webhooku czatu.
- Wysyłka z tras wniosków **nie blokuje odpowiedzi** dla kierownika: decyzja jest
  już w bazie, a niedostępna skrzynka nie ma prawa jej spowolnić. Błędy lądują
  w logu z prefiksem `[mail]`; adresów w logu nie ma.
- OVH odrzuca kopertę z adresem nadawcy innym niż zalogowany — `EMAIL_FROM` musi
  wskazywać tę samą skrzynkę co `email_login`.
- Link w treści budowany jest z `NEXTAUTH_URL`, więc na produkcji ta zmienna musi
  wskazywać publiczny adres aplikacji.

**Zanim uznasz, że to nie działa**, sprawdź sam transport, w oderwaniu od aplikacji:

```bash
npm run mail:test -- adres@example.pl
```

Skrypt najpierw robi `verify()` (samo połączenie i logowanie, bez wysyłki), potem
wysyła jedną wiadomość. To rozdziela dwa zupełnie różne powody, dla których mail
nie dochodzi: złe hasło albo port (widać tutaj) od błędu w logice wysyłki
(widać dopiero w aplikacji).

> **DNS.** Domena jest w OVH, ale rekordami zarządza Cloudflare. Poczta wychodząca
> z serwerów OVH potrzebuje rekordu SPF, który je dopuszcza
> (`v=spf1 include:mx.ovh.com ~all`), i najlepiej włączonego DKIM-a w panelu OVH.
> Bez tego kod jest poprawny, a wiadomości i tak lądują w spamie. Po pierwszej
> udanej wysyłce zajrzyj w źródło dostarczonej wiadomości: nagłówek
> `Authentication-Results` mówi wprost, czy SPF i DKIM przeszły.

Nadanie uprawnień kierownika:

```bash
npm run admin -- role michal@example.pl manager
```

Rola jest zapisana w tokenie JWT, więc **po jej zmianie trzeba się wylogować
i zalogować ponownie**, żeby zaczęła obowiązywać.

## Urlopy i nieobecności

Drugi obieg akceptacji obok nadgodzin, na tej samej zasadzie: pracownik składa
wniosek, kierownik go zatwierdza albo odrzuca, a zatwierdzone wnioski schodzą
z puli dni. Różnica jest jedna, ale istotna — wniosek dotyczy **zakresu dni**,
nie pojedynczego dnia, więc jego wymiar trzeba policzyć.

**Pracownik** — `/urlopy`: pula na bieżący rok (przydzielone / wykorzystane /
pozostało), formularz wniosku i historia z możliwością anulowania, dopóki wniosek
czeka na decyzję.

**Kierownik** — `/urlopy/zarzadzaj`: wnioski do rozpatrzenia, wpisywanie
nieobecności za pracownika, przydzielanie dni i historia z filtrami. Widzi
wyłącznie swoje sekcje (`ManagerSections`, jak przy nadgodzinach).

**Zatwierdzony urlop da się cofnąć** — i to jest najczęstszy przypadek użycia:
pracownik rezygnuje, a sam już nic nie zrobi, bo anulowanie działa tylko na
wniosku oczekującym. Kierownik usuwa nieobecność z historii, podając
**obowiązkowy powód**; wniosek zostaje w bazie ze statusem *Cofnięty* i podpisem.
Konsekwencje odkręcają się same: dni wracają do puli, kafelek nieobecności znika
z kiosku i sprzed nazwiska w „Teraz w toku”, a ten sam termin da się zgłosić
ponownie (kontrola nakładania patrzy tylko na *Oczekuje* i *Zatwierdzony*).

### Rodzaje

| Rodzaj | Zdejmuje dni z puli | Zgłasza pracownik |
|---|---|---|
| Urlop wypoczynkowy | tak | tak |
| Urlop na żądanie | tak | nie — wpisuje kierownik |
| Zwolnienie lekarskie (L4) | **nie** | nie — wpisuje kierownik |
| Urlop bezpłatny | nie | tak |
| Opieka | nie | tak |
| Urlop okolicznościowy | nie | tak |

Rodzaje, których pracownik nie zgłasza sam, wpisuje kierownik po fakcie —
telefon rano albo zwolnienie na biurku. **Taki wpis zapisuje się od razu jako
zatwierdzony**: nie ma czego akceptować, skoro zakłada go osoba, która i tak by
go akceptowała. W historii widać wtedy „Wpisał: …”.

Słownik siedzi w `services/absenceKinds.js` i to jedyne miejsce, gdzie żyje
wiedza „czy rodzaj rusza pulę” — SQL sald składa z niego warunek sam.

### Ile dni schodzi z puli

Liczą się **dni robocze**: bez sobót, niedziel i świąt ustawowo wolnych. Wniosek
piątek–poniedziałek kosztuje dwa dni, nie cztery. Formularz pokazuje wymiar
jeszcze przed wysłaniem, tą samą funkcją, którą serwer liczy przy zapisie
(`services/workingDays.js`).

Świąt nie ma na liście wpisanej ręcznie — część z nich jest ruchoma, więc
Wielkanoc liczy algorytm, a Poniedziałek Wielkanocny, Zielone Świątki i Boże
Ciało wynikają z niej przesunięciem. Lista wpisana z palca zestarzałaby się po
cichu i pierwszy źle policzony urlop zauważyłby dopiero ktoś, komu zniknął dzień.

### Pula dni

Pula rozlicza się **na rok kalendarzowy** i powstaje z przydziałów dopisywanych
przez kierownika. Przydziału się nie nadpisuje — dokłada się kolejny:

```
26 dni  — wymiar podstawowy
 4 dni  — zaległe z poprzedniego roku
-2 dni  — korekta po zmianie wymiaru etatu
```

Dzięki temu po roku widać, skąd wzięła się liczba, a nie tylko jaka jest.
Liczba ujemna to jedyny sposób na pomniejszenie puli i jest dozwolona.

**Saldo może zejść poniżej zera.** Przy zatwierdzaniu kierownik widzi ostrzeżenie
„po zatwierdzeniu zostanie −3 dni”, ale przycisk działa: zgoda na urlop na poczet
przyszłego przydziału jest jego decyzją, nie pomyłką systemu.

### Reguły, których pilnuje serwer

| Reguła | Zachowanie |
|---|---|
| Wniosek nie przechodzi przez koniec roku | `422 year_boundary` — podziel na dwa wnioski |
| Zakres bez dnia roboczego (sam weekend, samo święto) | `422 no_working_days` |
| Nieobecności jednej osoby nie mogą na siebie nachodzić | `422 overlap` (liczą się `pending` i `approved`) |
| Rodzaj spoza listy pracownika, zgłoszony przez pracownika | `403 kind_not_self_service` |
| Wpis za kogoś bez uprawnień kierownika | `403 permission_denied` |
| Dwie karty kierownika rozpatrujące ten sam wniosek | `409 already_decided` |

Rok rozliczeniowy bierze się z daty początkowej i dlatego wniosek nie może
przechodzić przez sylwestra — inaczej jeden wpis musiałby dzielić dni między dwa
salda i mieć dwa wymiary naraz. Raz na rok trzeba złożyć dwa wnioski i to jest
tańsze niż tłumaczenie, czemu pula się nie zgadza.

### Kiosk

Kafelek osoby nieobecnej pokazuje rodzaj (L4, Urlop, Opieka) i termin powrotu,
zamiast wyglądać identycznie jak kafelek spóźnialskiego. Kolor neutralny —
w tym systemie bursztyn znaczy „teraz”, a nieobecność nie jest stanem „teraz”.

**Odbicie karty pozostaje możliwe.** Ktoś wraca z L4 dzień wcześniej albo wpada
na dwie godziny w środku urlopu; kafelek wtedy liczy jego czas normalnie,
a znacznik nieobecności przenosi się do rogu — bo „w pracy, choć miał być na
urlopie” to dokładnie ta sytuacja, o której kierownik ma wiedzieć.

Zatwierdzone nieobecności podpisują się też w „Teraz w toku” na
`/zadania/zarzadzaj`, przy nazwiskach w sekcji „bez timera”.

**Tablica odświeża się sama co 45 sekund** — z `/api/time/board?section=…`, tym
samym cyklem co „Teraz w toku” w raporcie kierownika (stała `LIVE_POLL_MS`
w `utils/live.js`). Bez tego odbicie zrobione na drugim urządzeniu, nowo
aktywowane konto i zatwierdzony przed chwilą urlop pojawiały się na ekranie
dopiero po ręcznym przeładowaniu. Odbicie karty dociąga tablicę od razu, nie
czekając na koniec cyklu.

Ekran w hali nie pokazuje przy tym żadnego komunikatu o błędzie sieci — inaczej
niż raport kierownika, gdzie taki napis jest. Na ścianie nie ma go kto przeczytać
ani co z nim zrobić, więc przy zerwanym łączu zostają ostatnie znane kafelki,
a odpytywanie wraca samo.

**Kafelki nie zmieniają kolejności w ciągu dnia.** Lista idzie zawsze porządkiem
pracowników, a nie „najpierw ci, którzy odbili” — inaczej przy odświeżaniu czyjś
kafelek uciekałby spod palca w chwili dotknięcia.

Kafelek ze znacznikiem **`auto`** to karta, której nikt nie zamknął — domknęło
ją zadanie nocne o 3:00 na osiem godzin od wejścia. Zasady i korekta:
[Karty czasu](#karty-czasu).

Pełne przeładowanie strony o 3:30 (`components/stationClock.js`) zostaje mimo
pollingu: przy okazji podmienia kod aplikacji po wdrożeniu i odświeża sesję,
a kosztuje jedno żądanie na dobę.

Endpoint tablicy wyłącznie **czyta** i tak ma zostać — odpytuje go każdy kiosk
w firmie, a zapis wykonywany przy odczycie to dokładnie ta przyczyna, która
położyła serwer 21.08.2026 (zob. [Kiedy „aplikacja muli”](#kiedy-aplikacja-muli--co-sprawdzić)).

### Eksport CSV

`/api/report/urlopy` w dwóch trybach: `nieobecnosci` (domyślny) i `salda`.
Salda to cudze dane, więc wyłącznie dla kierownika; nieobecności pracownik
pobiera w wersji własnej, niezależnie od tego, co poda w `userID`. Eksport
zawsze zwraca komplet, także gdy widok przyciął listę do 500 pozycji.

### Czego moduł NIE robi

- Nie dotyka tabeli `Times` ani eksportu kart czasu — urlop nie tworzy wpisu
  obecności.
- Nie zna kalendarza zespołu ani limitu „ilu naraz może być na urlopie”.
- Nie przenosi zaległego urlopu na nowy rok sam z siebie — kierownik dopisuje
  go jako zwykły przydział.

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

**Powtórzenia da się zwinąć — „Grupuj takie same zadania”.** Checkbox nad listą
dni skleja wpisy o **tym samym opisie i tym samym projekcie** w jeden wiersz
z licznikiem („3”), łącznym wymiarem i rozpiętością godzin; kliknięcie rozwija
składowe, każdą z pełnym kompletem przycisków. Ludzie wracają w ciągu dnia do tej
samej czynności po kilka razy, a dzień z kilkunastoma wpisami jest ścianą tekstu,
w której nie widać, ile łącznie na czym zeszło. Domyślnie **wyłączone** — to
dodatek do widoku, nie nowy widok.

Trzy rzeczy warte zapamiętania:

- **Godziny na wierszu grupy to ROZPIĘTOŚĆ, nie ciągła praca.** „16:51–17:46”
  przy wymiarze 12 minut znaczy, że między wpisami było coś innego. Wymiar zawsze
  jest sumą składowych, nigdy różnicą krańców — wyjaśnia to podpowiedź pod kursorem.
- **Suma dnia w nagłówku się nie zmienia.** Liczy się ją z płaskiej listy, przed
  grupowaniem — checkbox nie ma prawa ruszyć liczby, którą ktoś przepisuje do
  zestawienia.
- **Wpisy domknięte automatycznie zostają osobno**, także przy włączonym
  grupowaniu. Mają własne ostrzeżenie i bursztynowy pasek, a zwinięcie schowałoby
  właśnie ten sygnał; to zarazem jedyne wpisy, które bywają bez projektu i opisu.

Na wierszu grupy jest **wyłącznie „wznów”**. Poprawka i kasowanie dotyczą
konkretnych godzin, więc żyją przy wpisach, po rozwinięciu — kosz na grupie
kasowałby jednym kliknięciem pół dnia pracy, bez cofnięcia.

Ustawienie siedzi w `localStorage` (klucz `zadania:grupuj`), jak motyw — jest
ustawieniem widoku, nie daną pracownika, więc nie ma go w bazie ani w raportach.
Płynie z tego jedno: **żyje w jednej przeglądarce** (na tablecie trzeba je włączyć
osobno), a po wejściu na stronę pierwsza klatka jest niepogrupowana, bo serwer nie
zna tej wartości w chwili renderu. Sama logika zwijania to czysta funkcja
w `utils/groupEntries.js` — grupuje po tej samej parze (projekt, opis), po której
`services/entrySuggestions.js` buduje kafelki „wznów”.

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

**Obok ołówka jest kosz.** Wpis dopisany „dla zabawy”, duplikat wklejony dwa razy
albo praca zaraportowana na złym koncie nie da się naprawić poprawką — zostałby
w sumach jako czyjaś praca, tylko pod inną nazwą. Kliknięcie kosza nie kasuje od
razu: wiersz zamienia się w pytanie z **obowiązkowym powodem**, bo znika cudza
praca, a nie własna notatka (na `/zadania` pracownik potwierdza usunięcie
własnego wpisu zwykłym „na pewno?”).

Wpis znika z bazy **na stałe** — `TaskEntries` nie ma statusów ani miejsca na
notatkę, więc kasujemy tak samo, jak robi to pracownik u siebie. Powód trafia do
logu serwera (`pm2 logs`, wpis `wpis usunięty przez kierownika` z id, właścicielem
i wymiarem) i to jest jedyny ślad, jaki bez tabeli audytu zostaje. Przy własnym
wpisie log milczy — nie ma komu o tym mówić, dokładnie jak przy podpisie „popr.”.

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

### Daty

**Data wyświetlana to zawsze `RRRR-MM-DD`, znacznik z godziną — `RRRR-MM-DD GG:MM`.**
W kodzie: `formatDate`, `formatDateTime` i `formatDateRange` z `utils/index.js`.
Nowy ekran nie woła `dayjs(...).format(...)` do daty — od tego są te trzy funkcje.

Wcześniej ta sama data wyglądała na pięć sposobów naraz: `14.08.26` w raporcie
zadań, `14.08.2026` w urlopach, `środa, 14 sierpnia` w nagłówku dnia, `śr, 14.08`
na tablicy kiosku i `2026-08-14` w eksporcie CSV. Porównanie wydruku z ekranem
wymagało tłumaczenia jednego na drugie, a dwucyfrowy rok dokładał pytanie, czy
`14.08.26` to nie rok 2014.

Format ISO wygrał z trzech powodów: dzień nigdy nie myli się z miesiącem, sortuje
się leksykograficznie i jest **dokładnie tym samym kształtem**, w którym daty
siedzą w bazie (`Absences.dateFrom`, `Overtime.data`, `TaskEntries.data`) i we
wszystkich eksportach CSV. To samo dotyczy treści powiadomień — mailowych
i czatowych.

Nazwy dni zostają tam, gdzie niosą informację, ale **obok daty, nie zamiast niej**:
nagłówek tablicy kiosku (`środa, 2026-08-26`), nagłówki grup dni w zadaniach
(`Dziś · 2026-08-26`, `Wczoraj · 2026-08-25`, `wtorek, 2026-08-18`). W gęstych
tabelach skróconych nazw dni nie ma — istniały wyłącznie po to, żeby ścisnąć
krótką datę, a `2026-08-26` czyta się bez podpowiedzi.

`utils/index.js` jest tu właściwym miejscem, bo tych funkcji potrzebują OBIE
strony: przeglądarka do tabel i serwer do treści maili. Ten moduł nie dotyka bazy,
więc wolno go zaimportować i tam, i tam — jak `TASK_QUERY_MAX` czy `TIME_LIST_LIMIT`.

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
