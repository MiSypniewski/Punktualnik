# Punktualnik 2.0 — szkic architektury

Dokument odpowiada na jedno pytanie: **gdyby tę samą funkcjonalność budować dzisiaj od
zera, co wyglądałoby inaczej.** Nie jest to lista błędów do naprawienia ani plan migracji
— obecna wersja działa produkcyjnie, ma 286 commitów i rozwiązuje problemy, o których
z góry nikt by nie pomyślał. Jest to opis wersji, która zaczynałaby w miejscu, do którego
tamta doszła.

Uwagi są rozdzielone na dwie warstwy i ten podział jest w dokumencie konsekwentny:

| Warstwa | Znaczenie |
|---|---|
| **Przy tych samych ograniczeniach** | Mikrus 2.1 (1 GB, bez swapu), jeden proces, SQLite, brak crona, budżet bliski zeru. Decyzje, które dało się podjąć inaczej **bez** zmiany hostingu. |
| **Gdyby zdjąć ograniczenie hostingu** | Osobny rozdział na końcu. To **nie jest** zalecenie dla obecnego wdrożenia — to opis tego, które dzisiejsze rozwiązania są obejściami, a nie wyborami. |

Wszystko, co dokument mówi o obecnym kodzie, wskazuje konkretny plik i daje się sprawdzić.

---

## Co zostaje bez dyskusji

Zaczynam od tego celowo. Sporą część dzisiejszych rozwiązań uważam za lepsze od tego, co
wyszłoby z domyślnego wyboru w 2026 roku — i wersja 2.0 przenosi je bez zmian.

**Komentarze mówiące „dlaczego”, nie „co”.** `services/db.js`, `services/workday.js`,
`services/loginRateLimit.js` — to nie są komentarze opisujące kod, tylko zapis rozumowania
razem z odrzuconymi wariantami i z datą awarii, która je wymusiła. To najrzadsza rzecz
w tym repozytorium i jedyna, której nie da się odtworzyć z kodu. Zostaje bez wyjątku.

**README jako dokumentacja operacyjna, nie marketingowa.** Tabela „kiedy aplikacja muli”
z komendami do wpisania, sekwencja wdrożenia, opis punktu bez powrotu przy migracji haseł.
Dokument napisany dla osoby, która o 7 rano ma zepsutą produkcję, a nie dla kogoś, kto
ogląda projekt na GitHubie.

**`services/roles.js` i `services/scope.js`.** Predykaty ról w jednym pliku i jedno
miejsce odpowiadające na pytanie „czyje dane wolno oglądać temu zalogowanemu”. Rozdzielenie
`canPunchCards` od `canEditTimes`, mimo że oba prowadzą do tabeli `Times`, jest dokładnie
tym rodzajem decyzji, którego nie podejmuje się przypadkiem. W 2.0 ta warstwa rośnie
(o czym niżej), ale zasada zostaje.

**Reguła biznesowa wyrażona w bazie.** Indeks częściowy `idx_entries_running` —
„najwyżej jeden biegnący timer na osobę” pilnowane przez `UNIQUE INDEX ... WHERE endedAt
IS NULL`, a nie przez sprawdzenie w kodzie. Dwie otwarte zakładki dostają `SQLITE_CONSTRAINT`
zamiast dwóch liczników. To wzorzec do **rozszerzenia**, nie do porzucenia.

**Zapadka `JobRuns` zamiast crona.** Budzik wewnątrz procesu plus wiersz w bazie mówiący,
dla którego okresu zadanie już poszło. Odporne na restart, na deploy, na proces, który
przez noc nie żył, i na `next build` odpalony o 3:05. Przy jednym procesie i bazie
plikowej to jest poprawna odpowiedź, nie proteza.

**Dwie niezależne osie ewidencji bez walidacji krzyżowej.** `Times` mówi, że ktoś **był**
w pracy, `TaskEntries` — czym się **zajmował**, i nic się między nimi nie sprawdza.
Zapomniana karta nie blokuje raportowania zadań. Pokusa „przecież suma zadań powinna się
zgadzać z dniówką” jest silna i każde jej ustąpienie kończy się aplikacją, która karze
ludzi za to, że pracowali.

**Redundancja policzona świadomie, z jednym miejscem przeliczania.** `TaskEntries.seconds`
i `Absences.workDays` są nadmiarowe wobec danych źródłowych i trzymane dlatego, że raporty
je sumują — z warunkiem, że liczy je **jedna** funkcja. To jest właściwy kompromis, pod
warunkiem że warunek jest egzekwowany (w 2.0 — typem, patrz niżej).

**Strumieniowy eksport.** `utils/csv.js` i `utils/xlsx.js` piszą prosto do odpowiedzi HTTP,
`WorkbookWriter` zamiast budowania skoroszytu w pamięci, `exceljs` wypchnięty z bundla
serwerowego w `next.config.js`. W kontenerze bez swapu to nie jest optymalizacja, tylko
warunek działania.

**`/api/health` z pomiarem opóźnienia pętli zdarzeń.** Metryka dobrana do rzeczywistej
przyczyny awarii, a nie do listy „co się zwykle mierzy”. Przy synchronicznym API bazy
`maxLagMs` jest jedynym wskaźnikiem, który cokolwiek znaczy.

**System wizualny z jedną zasadą.** „Bursztyn znaczy teraz, nigdzie indziej”, tokeny
semantyczne zamiast palety Tailwinda, zero wariantów `dark:` w kodzie stron, rozróżnienie
kształtem (kropka = stan na żywo, kwadrat = kolor projektu). Jedna reguła, która rozstrzyga
spory o wygląd bez dyskusji, jest warta więcej niż dziesięć stron guideline'ów.

---

## Model danych

To jest rdzeń dokumentu. Największa różnica między wersją 1 a 2 nie leży w stacku ani
w warstwie HTTP — leży w tym, że dzisiejszy schemat trzyma **dwa różne modele czasu obok
siebie**, a tylko jeden z nich jest modelem, który sam bym wybrał.

### Jedna oś zdarzeń zamiast wiersza-na-dzień

`TaskEntries` jest modelem zdarzeniowym: wpis ma początek, koniec, autora, podpis korekty
i flagę `autoClosed`. `Times` jest modelem rekordowym odziedziczonym po Airtable i widać
to w każdym szczególe:

- `services/newDay.js` zakłada **z góry** wiersz dla każdego pracownika sekcji ze statusem
  `wait`, godzinami ustawionymi na 3:00 i `totalWorkTime` równym `"00:00:00"` — czyli baza
  zawiera zapis o dniówce, która się nie wydarzyła;
- `name`, `surname`, `section`, `location` są zdenormalizowane w każdym wierszu (w `Overtime`
  tego już nie ma i komentarz przy tabeli słusznie się z tego tłumaczy);
- `totalWorkTime` to **tekst** `"HH:mm:ss"` — wielkość, którą raporty muszą parsować
  z powrotem (`parseHmsToSeconds` w `services/entryStats.js`);
- `status` to wolny tekst bez ograniczenia, a stany (`wait`, `workInProgress`, `finishWork`)
  żyją w `components/card.js`, czyli w komponencie widoku;
- `getTime.js` odnajduje dzisiejszą kartę porównaniem **dosłownym** pełnego ciągu ISO
  razem z offsetem strefy — stąd rozdział w komentarzu `services/manageTime.js` o tym, że
  jedno pole tej samej tabeli musi powstać w strefie procesu, a dwa inne w strefie
  aplikacji;
- usunięcie karty jest nieodwracalne i ślad po nim idzie **do logu serwera**, bo tabela nie
  ma gdzie go zapisać;
- `saveTime.js` zwraca pole `airtableID`, a jego parametr nazywa się `pyload`;
- **liczbę godzin liczy przeglądarka.** `components/card.js` wyznacza status
  (`wait` → `workInProgress` → `finishWork`) i `totalWorkTime` funkcją `DifferenceTime`,
  po czym wysyła gotowy wiersz, a `pages/api/time/[id].js` zapisuje go bez zmian
  (`const payload = req.body; saveTimes(payload)`) i bez walidacji — jako jedyna ścieżka
  zapisu w tej aplikacji, bo wszystkie pozostałe przechodzą przez Joi. Wymiar dniówki
  zależy więc od zegara tabletu w hali, a treść wiersza od tego, co przyszło w żądaniu.
  Moduł zadań robi to dokładnie odwrotnie i tłumaczy dlaczego: `runningSeconds`
  w `services/taskEntries.js` liczy się **na serwerze**, „bo przeglądarka z przestawionym
  zegarem policzyłaby czas przesunięty o godziny”.

W 2.0 karta czasu jest **logiem odbić**, dokładnie tak jak wpisy zadań:

```
Punches
  id, userID, at (UTC), kind ('in' | 'out'),
  source ('kiosk' | 'manager' | 'auto'),
  createdBy, createdByName, note
```

Dniówka nie jest wierszem, tylko **projekcją**: para odbić w obrębie doby roboczej.
Konsekwencje, i to one są tu istotne, a nie sam kształt tabeli:

| Dziś | Po zmianie |
|---|---|
| Korekta nadpisuje wiersz; historii nie ma | Korekta to **nowe zdarzenie** z autorem i powodem; stara wartość zostaje |
| Usunięcie karty zostawia ślad w logu procesu | Usunięcie to zdarzenie odwracające, widoczne w danych |
| `wait` to wiersz w bazie | Brak odbicia to **brak danych**; kafelek „Nie odbito” liczy sam widok |
| `autoClosed` to flaga na wierszu | Domknięcie to odbicie ze `source = 'auto'` — niosące tę samą informację, ale bez osobnego pojęcia |
| Dwa dotknięcia kafelka = INSERT + UPDATE tego samego wiersza | Dwa dotknięcia = dwa INSERT-y; nie ma czego blokować ani nadpisywać |

Ostatni wiersz tabeli ma znaczenie operacyjne: `UPDATE` w `better-sqlite3` bierze blokadę
zapisu, a kolizja o nią zamraża **cały** proces. Log tylko dopisywany jest tańszy i bardziej
odporny w dokładnie tym scenariuszu, który 21.08.2026 położył aplikację.

### Jeden format czasu

Dzisiaj są dwa i oba są udokumentowane, obronione i niebezpieczne:

- `Times.data`, `startTime`, `endTime` — ISO z offsetem strefy **procesu** (na Mikrusie
  `+00:00`, lokalnie `+02:00`), porównywane dosłownie;
- `TaskEntries.startedAt`, `endedAt` — `'YYYY-MM-DD HH:mm:ss'`, czas lokalny **bez**
  offsetu, żeby porównanie leksykograficzne w SQL wykrywało kolizje.

Komentarz w `services/workday.js` tłumaczy, dlaczego strefy nie da się wymusić globalnym
`TZ`: naprawiłoby to jeden moduł i zepsuło drugi. To jest opis pułapki, nie projektu.

W 2.0 obowiązuje jedna reguła, bez wyjątków:

- **W bazie wszystko jest UTC** w jednym kształcie (`YYYY-MM-DDTHH:mm:ssZ` albo epoch —
  byle jednym). Porównanie leksykograficzne działa, bo kształt jest jeden.
- **Strefa istnieje wyłącznie na granicy**: przy wejściu (parsowanie tego, co wpisał
  człowiek) i przy wyjściu (render, mail, eksport). Ani jedna funkcja domenowa nie zna
  `Europe/Warsaw`.
- **Doba robocza to osobna kolumna `DATE`** (`'YYYY-MM-DD'`), nigdy znacznik z godziną
  3:00 i offsetem. Reguła „doba zaczyna się o 3:00” liczy tę kolumnę przy zapisie i jest
  jedną funkcją, tak jak dziś `workDay()`.

Zysk nie polega na estetyce. Polega na tym, że znika cała klasa błędów, w której serwer
przestawiony na inną strefę przestaje odnajdywać własne wiersze.

### Jeden obieg wniosku

`Overtime` i `Absences` to ten sam automat: `pending → approved | rejected`, plus
anulowanie przez pracownika i wycofanie decyzji przez kierownika. Różnią się tym, że jeden
dotyczy dnia, a drugi zakresu dni — i tym, że mają **dwa komplety kodu**:
`createOvertimeRequest` / `decideOvertimeRequest` / `cancelOvertimeRequest` /
`revokeOvertimeRequest` i lustrzana czwórka dla nieobecności, plus dwa zestawy powiadomień,
dwa zestawy stron i dwa zestawy tras API.

W 2.0 przejścia stanów, uprawnienia do nich i podpis pod decyzją są **jednym modułem**,
a nadgodziny i nieobecności są jego dwoma zastosowaniami:

```
requests/workflow.ts   — stany, dozwolone przejścia, kto może je wykonać, podpis
requests/overtime.ts   — co znaczy wniosek o nadgodziny (wymiar w minutach, znak)
requests/absence.ts    — co znaczy wniosek o nieobecność (zakres dni, pula, zaświadczenie)
```

Tabele mogą zostać dwie — różnią się realnie ładunkiem. Wspólny jest **automat**, bo to on
jest przepisany dwa razy i to on rozjedzie się przy pierwszej zmianie zasad („anulowanie
możliwe do 24 h po decyzji” zaimplementowane w jednym module i zapomniane w drugim).

### Grafik pracy — byt, którego brakuje

Cała aplikacja stoi na stałej `WORKDAY_HOURS = 8` z `utils/index.js`. Ta liczba
rozstrzyga: kolor kafelka na kiosku, granicę nadgodzin, godzinę domknięcia zapomnianej
karty, planowane wyjście na ekranie dnia zespołu i próg niedogodzin. README przyznaje to
wprost: „nie zna grafiku pracy”.

To nie jest brak funkcji — to brak **bytu w modelu**. Dopóki go nie ma, nie da się obsłużyć
połowy etatu, zmian ruchomych, czterodniowego tygodnia ani soboty pracującej, a każde
z tych pytań prędzej czy później przyjdzie z kadr. W 2.0 grafik istnieje od pierwszego dnia,
choćby w najprostszej postaci:

```
WorkSchedules
  userID, validFrom, validTo,
  hoursPerDay (albo wzorzec tygodniowy), workingDays
```

Wszystkie miejsca, które dziś czytają stałą, pytają o **normę tego pracownika w tym dniu**.
Domyślna odpowiedź to nadal 8 godzin od poniedziałku do piątku — różnica polega na tym, że
jest to dana, a nie `const`.

### Reguły w schemacie

Wzorzec `idx_entries_running` (reguła biznesowa jako indeks) występuje dziś **raz**.
Pozostałe reguły tej samej wagi pilnuje kod:

| Reguła | Dziś | W 2.0 |
|---|---|---|
| Jeden biegnący timer na osobę | `UNIQUE INDEX ... WHERE endedAt IS NULL` | bez zmian — wzorzec |
| Jedna karta na osobę i dobę | sprawdzenie w `manageTime.js` → `409 card_exists` | `UNIQUE (userID, workDay)` |
| Status z zamkniętego zbioru | wolny `TEXT` | `CHECK (status IN (...))` |
| `dateTo >= dateFrom` we wniosku | walidacja w `createAbsence.js` | `CHECK` w schemacie **i** walidacja |
| Wniosek nie przechodzi przez sylwestra | walidacja w kodzie | `CHECK` na zgodności `year` z `dateFrom`/`dateTo` |

Zasada: walidacja w kodzie daje **komunikat dla człowieka**, ograniczenie w schemacie daje
**gwarancję**. Jedno nie zastępuje drugiego, a dziś jest tylko pierwsze.

### Migracje z numerem, nie z `PRAGMA table_info`

`services/db.js` ma dziś 620 linii: DDL całego schematu plus sześć funkcji migracyjnych
sterowanych stanem schematu (`PRAGMA table_info` → `ALTER TABLE` albo przepisanie tabeli).
Każda jest idempotentna i każda jest napisana starannie — łącznie z pełną przebudową
`TaskEntries` z `foreign_key_check` po fakcie. Problem nie leży w jakości, tylko w tym, że:

- plik rośnie liniowo i po dwudziestej migracji nikt go nie przeczyta w całości;
- nie da się z niego odczytać **kolejności ani historii** — kolejność jest niepisaną umową
  między wywołaniami na dole `createDb()` (komentarz przy `migrateEntryProjectOptional`
  wprost mówi „musi lecieć PO tamtej”);
- nie ma drogi powrotnej ani zapisu, co i kiedy się wykonało;
- **`scripts/admin.js` trzyma lustrzaną kopię DDL** dla `Users`, `ManagerSections`
  i `Sections`. README sam nazywa to miejscem, w którym schemat może się rozjechać — i to
  jest jedyna rzecz w tym repozytorium, która budzi mój niepokój bez zastrzeżeń.

W 2.0:

```
migrations/
  0001_init.sql
  0002_sections.sql
  0003_entry_seconds.sql
  ...
platform/schema.ts   — jedno źródło DDL, importowane i przez aplikację, i przez CLI
```

plus tabela `schema_migrations (version, appliedAt)`. Runner jest trywialny (kilkanaście
linii na `better-sqlite3`), a zysk podwójny: kolejność jest jawna, a wdrożenie potrafi
powiedzieć „ta baza jest na wersji 7, kod oczekuje 9” **zanim** cokolwiek zepsuje. Tryb
„sprawdź i odmów startu” jest przy jednym procesie i pliku na dysku wart więcej niż
automatyczne dociąganie.

---

## Granice modułów

`services/` ma dziś 64 pliki i jest to katalog **płaski**. Dominuje konwencja „jeden
przypadek użycia = jeden plik z jednym eksportem domyślnym”: `getUsers.js`,
`getAllUsers.js`, `getUserData.js`, `getTime.js`, `getSectionTime.js`, `getSectionTimes.js`,
`getAbsences.js`, `getAbsencesForDay.js`, `getAbsencesForUser.js`. Każdy z nich importuje
`db` bezpośrednio.

Ta konwencja ma zaletę, której nie chcę stracić: plik jest mały, a jego nazwa mówi
wszystko. Ma też trzy koszty, które przy sześćdziesięciu kilku plikach są już widoczne:

1. **Nie widać modułów.** Nazwa pliku mówi, co robi funkcja, ale nie mówi, do czego
   należy. Pytanie „co dokładnie składa się na moduł urlopów” wymaga przeczytania listy
   katalogu i zgadywania po przedrostkach.
2. **Nie widać granicy.** Skoro każdy plik ma dostęp do `db`, to każdy plik może sięgnąć
   do każdej tabeli. Nic nie powstrzymuje modułu zadań przed zapytaniem do `Absences` —
   poza dyscypliną autora, która działa dokładnie tak długo, jak długo autor jest jeden.
3. **Podział jest po czasowniku, nie po rzeczowniku.** Reguły jednej dziedziny są
   rozsypane po kilkunastu plikach (`createAbsence`, `decideAbsence`, `cancelAbsence`,
   `revokeAbsence`, `getAbsenceById`, `leaveBalance`, `absenceKinds`), więc odpowiedź na
   pytanie „jakie są reguły urlopów” nie mieszka w żadnym z nich.

W 2.0 układ jest domenowy, a rozmiar plików zostaje mały:

```
domain/
  attendance/    odbicia, doba robocza, domykanie, tablica sekcji
  tasks/         wpisy czasu, projekty, podpowiedzi, kafelki
  requests/      wspólny obieg + nadgodziny + nieobecności + pula dni
  people/        konta, role, sekcje, zasięg kierownika
platform/        db, schema, migracje, log, scheduler, runtime
integrations/    poczta, Google Chat, eksport CSV/XLSX
```

Reguła, która to trzyma: **`db` importuje wyłącznie repozytorium wewnątrz domeny.**
Moduł domenowy udostępnia funkcje operujące na pojęciach, nie na tabelach; inna domena woła
te funkcje, a nie SQL. `services/scope.js` jest dziś dowodem, że to działa — jedno miejsce
odpowiada na pytanie o zasięg i żadna trasa nie liczy go sama.

Trzy pliki wymagają osobnej uwagi, bo ich obecne położenie jest **wymuszone technicznie**,
a nie wybrane: `utils/resumeTiles.js`, `services/absenceKinds.js` i `services/workingDays.js`
nie mogą importować bazy, bo wchodzą do bundla przeglądarki (`better-sqlite3` ciągnie za
sobą `fs`). Komentarze w nich to tłumaczą i mają rację, ale efekt jest taki, że o
przynależności pliku decyduje bundler. W 2.0 to jest jawny podział, a nie skutek uboczny:

```
domain/<nazwa>/rules.ts    czysta logika, zero I/O — wolno importować wszędzie
domain/<nazwa>/repo.ts     jedyne miejsce z SQL — wyłącznie serwer
```

Przy okazji znika pułapka „zaimportowałem stałą i wciągnąłem sterownik bazy do
przeglądarki”, dziś pilnowana wyłącznie komentarzem.

---

## Warstwa HTTP

Każda trasa w `pages/api/` zaczyna się dziś od tego samego prologu, przepisanego ręcznie:

```js
const token = await getToken({ req });
if (!token) return res.status(401).json({ error: "not_authorized" });
if (!canTrackTasks(token.role)) return res.status(403).json({ error: "permission_denied" });
if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405)... }
```

Powtórzony kilkanaście razy — i już dziś w **dwóch odmianach**. Część tras sprawdza rolę
globalnie, a metodę dopiero po niej (`pages/api/entries/index.js`, `entries/timer.js`,
`report/index.js`); część rozgałęzia się najpierw po metodzie i sprawdza uprawnienia
osobno w każdej gałęzi (`overtime/index.js`, `absences/index.js`, `projects/index.js`).
Skutek jest taki, że `GET` od kogoś bez uprawnień dostaje w jednym miejscu 403, a w drugim
405. Praktycznie to nie boli, ale pokazuje, co się dzieje z regułą przepisywaną ręcznie:
pierwsza kopia jest wzorcem, dziesiąta jest wariantem. Gorsza odmiana tego samego jest
w gałęziach: przy sprawdzeniu uprawnień **wewnątrz** `if (req.method === ...)` dodanie
trzeciej metody to trzecie miejsce, w którym można o nim po prostu zapomnieć.

W 2.0 prolog jest jeden:

```ts
export default withRoute({
  method: "POST",
  require: canTrackTasks,
  body: startEntrySchema,      // walidacja deklaratywna, dziś Joi — w 2.0 zod
  handler: async ({ token, body }) => { ... },
});
```

Do tego **jedna** mapa kodów domenowych na statusy HTTP. Dziś istnieje jej lokalny zalążek
— `STATUS_FOR` w `services/manageTime.js`, z trafnym komentarzem o dwóch odręcznych
kopiach — ale obok tego `pages/api/entries/index.js` ma własną listę `CONFLICT_CODES`,
a reszta tras mapuje kody na miejscu. Kod błędu należy do domeny, status HTTP do
transportu, a tłumaczenie jednego na drugie jest jedną tabelą.

Zysk jest mierzalny: trasa przestaje mieć trzydzieści linii prologu i dziesięć linii
obsługi, a zostaje z wywołaniem funkcji domenowej. Przy okazji „czy ta trasa na pewno
sprawdza uprawnienia” przestaje być pytaniem, na które odpowiada się czytaniem.

Drugi zysk jest ważniejszy i widać go na `pages/api/time/[id].js`. Ta trasa przyjmuje
`req.body` i podaje go wprost do `saveTime` — całym wierszem, razem z `userID`, godzinami,
statusem i wyliczonym czasem pracy. Sprawdzana jest tylko rola. Ponieważ schemat jest
deklarowany **obok** obsługi, a nie w niej, „ta trasa nie ma walidacji” jest w 2.0 stanem
niewyrażalnym: brak schematu to brak trasy. Dziś jest to jedna linia różnicy między tym
endpointem a resztą aplikacji, której nikt z zewnątrz nie zauważy — bo reszta aplikacji
waliduje wzorowo.

---

## Front

Dzisiejszy podział jest prosty: `getServerSideProps` na dwunastu stronach dostarcza dane
przy renderze, SWR dokłada polling tam, gdzie coś ma być „na żywo”, a strona jest jednym
plikiem. `pages/zadania/index.js` ma **1785 linii** i mieści kilkanaście komponentów;
`pages/zadania/zarzadzaj.js` — 982; `pages/urlopy/zarzadzaj.js` — 795.

### Podział plików

To nie jest zarzut o styl. To jest zarzut o **granicę testowalności**: dopóki formularz
korekty wpisu jest komponentem zadeklarowanym w środku pliku strony, nie da się go
uruchomić bez strony, a strony nie da się uruchomić bez bazy. W 2.0:

```
features/zadania/
  page.tsx            komponowanie, nic więcej
  RunningTimer.tsx
  EntryRow.tsx
  ResumeTiles.tsx
  useEntries.ts
```

Reguła: **plik, który przekracza jakieś 300 linii, ma w środku moduł, którego nie
wydzielono.**

### Co jedzie w propsach, a co przez API

`services/entryStats.js` tnie szczegóły raportu do 200 wierszy i mówi wprost dlaczego: przy
500 wierszach props SSR rósł do 175 kB i Next ostrzegał o przekroczeniu progu
`large-page-data`. Limit jest sensowny, ale jest **objawem**, nie decyzją — dane tabeli
jadą przez props, bo wszystko inne w tej aplikacji też jedzie przez props.

Granica w 2.0:

| Rodzaj danych | Droga |
|---|---|
| To, co musi być na pierwszym malowaniu (kto jestem, co teraz biegnie, stan dnia) | render serwera |
| Listy i tabele, które się filtruje, stronicuje i sortuje | API, ładowane po stronie klienta |
| Stan „teraz” współdzielony przez wiele ekranów | strumień zdarzeń (niżej) |

Przy okazji znika problem, który dziś jest obchodzony przez `router.replace` i ręczne
odświeżanie: strona wyrenderowana serwerowo nie wie, że jej dane się zdezaktualizowały,
więc `/zadania` sprawdza to osobnym zapytaniem do `/api/entries/timer`.

### Polling → strumień

Dziś są trzy niezależne widoki odpytujące serwer w pętli: tablica kiosku i „Teraz w toku”
co 45 s (`LIVE_POLL_MS`), własny biegnący timer co 60 s (`TIMER_POLL_MS`) z trzech miejsc
naraz, zlewanych w jedno zapytanie przez `dedupingInterval` w `pages/_app.js`. Rozwiązanie
jest zrobione starannie — wspólny klucz SWR, wspólny fetcher, stałe w jednym pliku
z komentarzem, dlaczego rozjazd wartości byłby błędem.

I mimo to jest to **odpytywanie o coś, co się nie zmienia**. Kiosk z dwunastoma kafelkami
pyta bazę co 45 sekund niezależnie od tego, czy ktokolwiek czegoś dotknął, a każde takie
zapytanie jest synchroniczne i konkuruje o ten sam wątek co odbicie karty.

W 2.0 to jest **SSE** (`EventSource`): jedno połączenie na otwarty ekran, serwer wysyła
zdarzenie po zapisie. Przy tej skali — kilkanaście przeglądarek, kilkadziesiąt zdarzeń
dziennie — koszt utrzymania połączenia jest nieporównanie mniejszy niż koszt odpytywania,
a kiosk przestaje być o 44 sekundy do tyłu. WebSocketów tu nie potrzeba: ruch jest
jednokierunkowy, a SSE działa przez zwykły HTTP, więc przechodzi przez Cloudflare i pm2
bez konfiguracji.

### Kiosk jako ekran maksymalnie głupi

Warto to powiedzieć osobno, bo jest to jedyne miejsce, w którym rozważałbym **odejście od
Reacta**. Kiosk wyświetla siatkę kafelków i przyjmuje dotknięcia. Nie ma formularzy, nie ma
nawigacji, nie ma stanu, który przeżywa przeładowanie. Cała jego złożoność po stronie
przeglądarki — hydratacja, SWR, liczenie czasu w `components/card.js`, ryzyko rozjazdu
zegara urządzenia — wynika z tego, że jest budowany tą samą techniką co panel kierownika.

Strona serwerowa odświeżana strumieniem zdarzeń, z dotknięciem jako zwykłym `POST`,
robiłaby to samo przy ułamku kodu i **bez** pytania, czy tablet w hali ma dobrze ustawiony
czas (dziś liczy go przeglądarka — komentarz w `services/taskEntries.js` tłumaczy, dlaczego
wpisy zadań liczy się dla odmiany na serwerze).

---

## Stack, typy, testy

### TypeScript

To jest pojedyncza największa zmiana w całym dokumencie.

Ta aplikacja żyje na **kształtach rekordów wędrujących przez wiele warstw**: wiersz z SQL →
mapowanie w serwisie → props `getServerSideProps` → komponent → `fetch` → API → z powrotem
do SQL. Nic nie sprawdza, że pole nazywa się tak samo po obu stronach. Dzisiejszą obroną
są komentarze — i trzeba oddać, że działa ona zaskakująco dobrze, ale utrzymuje ją jedna
osoba pamiętająca całość.

Trzy przykłady z tego repozytorium, w których typ zastąpiłby komentarz:

- `TaskEntries.seconds` jest redundantne i **wolno je przeliczać tylko w jednym module** —
  dziś to zdanie w komentarzu, w 2.0 typ, którego nie da się skonstruować poza tym modułem;
- `Times.data` musi powstać w strefie procesu, a `startTime`/`endTime` w strefie aplikacji
  — dziś dwadzieścia linii komentarza w `manageTime.js`, w 2.0 dwa różne typy znacznika,
  których kompilator nie pozwoli pomylić;
- `visibleSections(token)` zwraca pustą tablicę dla pracownika i **nigdy nie znaczy to
  „wszystko”** — dziś konwencja powtórzona w komentarzu każdego serwisu, w 2.0 typ
  `SectionScope`, który nie ma reprezentacji „brak ograniczenia”.

Wariant minimalny, gdyby przepisanie na TS było za drogie: `// @ts-check` plus JSDoc plus
`checkJs` w `jsconfig.json`. Daje może 60% zysku bez zmiany ani jednego pliku na `.ts`
— a projekt ma już dobre JSDoc-i w kilkunastu miejscach, więc start jest bliżej, niż się
wydaje.

### Testy

Dzisiaj nie ma **ani jednego** testu i nie ma CI. Przy aplikacji, która liczy ludziom
wynagrodzenie i urlopy, to jest ryzyko nieproporcjonalne do kosztu jego usunięcia —
zwłaszcza że ta baza kodu jest do testowania wyjątkowo wdzięczna.

Trzy poziomy, w kolejności opłacalności:

**1. Czyste funkcje, bez bazy — zwrot natychmiastowy.** `services/workday.js`
(granica 3:00, okno edycji, doba robocza o 1:00 w nocy), `services/workingDays.js`
(Wielkanoc algorytmem Meeusa, Boże Ciało, dni robocze w zakresie), `utils/index.js`
(`DifferenceTime`, `parseHmsToSeconds`, formaty dat), `services/overtimeKinds.js`
(znak przy `early_leave`), `services/leaveBalance.js` (pula minus wykorzystanie).
To jest dosłownie kilkadziesiąt testów, które piszą się w godzinę i pokrywają logikę,
której błąd zobaczy najpierw księgowość.

**2. Serwisy na bazie w pamięci.** `better-sqlite3` otwiera `:memory:` natychmiast, więc
test integracyjny to: utwórz schemat, wstaw dwóch użytkowników, zawołaj serwis, sprawdź
wiersz. Warte pokrycia: kolizje wpisów (`stmtOverlap`), domykanie o 3:00 z wpisem
z piątku, zakaz dwóch kart na jedną dobę, zasięg kierownika bez przypisań (musi zwracać
**zero**, nigdy wszystko), pula urlopowa z korektą ujemną.

**3. Playwright na ścieżce kiosku i logowania.** Repozytorium ma już `.playwright-mcp/`
i konta testowe, więc narzędzie jest na miejscu — brakuje tylko zapisanych scenariuszy
zamiast sesji ad hoc.

Do tego CI, choćby najprostsze: `lint` + `test` + `build` na każdej gałęzi. Przy pracy
gałęziami (a tak ten projekt jest prowadzony — 29 gałęzi lokalnych) to jest jedyna rzecz,
która wyłapie „scaliłem i nie zbudowałem”.

### Next i reszta zależności

`next@12` wyszedł w 2021 i jest bez wsparcia. To nie jest argument sam w sobie — działająca
aplikacja nie musi gonić wersji — ale ciągnie za sobą konkretne koszty widoczne w kodzie:
brak `next/font` (fonty podpięte ręcznie przez `@font-face`, o czym README wspomina), dwa
osobne runtime'y webpacka, przez które połączenie do bazy **musi** siedzieć na `globalThis`
(to jest bezpośrednia przyczyna awarii z 21.08.2026) i brak nowoczesnych mechanizmów
strumieniowania.

W 2.0 to jest Next 15 z App Routerem albo — i to nie jest żart — **świadomie mniej**:
zwykły serwer HTTP z renderowaniem po stronie serwera, skoro połowa aplikacji to formularze
i tabele. Wybór zależy od tego, ile Reacta naprawdę potrzebują ekrany zadań (sporo:
licznik, przeciąganie kafelków, edycja w miejscu) w stosunku do reszty (mało).

Pozostałe zamiany, każda z konkretnym powodem:

| Dziś | W 2.0 | Dlaczego |
|---|---|---|
| Joi | zod | Ten sam koszt, ale typ wynika ze schematu — walidacja i typ przestają być dwoma opisami tego samego |
| PBKDF2-HMAC-SHA512 | scrypt (`node:crypto`) lub argon2id | PBKDF2 liczy się na wątku i to on wymusił powstanie limitera („limiter nie jest dodatkiem — jest warunkiem”, `loginRateLimit.js`). scrypt daje ten sam koszt dla atakującego przy mniejszym dla serwera i nie wymaga natywnej zależności |
| Rola w JWT | rola czytana z bazy przy żądaniu | Dziś zmiana roli wymaga wylogowania i README musi o tym przypominać cztery razy. Przy lokalnym SQLite jeden `SELECT` na żądanie kosztuje mniej niż ta instrukcja obsługi |
| `dayjs` + 4 wtyczki | `Temporal` albo `date-fns` | Przy jednym formacie czasu (UTC w bazie) potrzeba jest o połowę mniejsza niż dziś |

---

## Operacje — przy tych samych ograniczeniach

Wszystko poniżej mieści się na Mikrusie 2.1 i nie wymaga ani złotówki więcej.

### Ciężkie odczyty poza pętlą zdarzeń

To jest największa rzecz, którą da się poprawić **bez** zmiany hostingu. `better-sqlite3`
jest synchroniczne, więc każde zapytanie blokuje wątek główny, a przez to wszystkich
użytkowników naraz. Dziś dotyczy to również zapytań, które trwają najdłużej i nie są
pilne: raport kierownika za kwartał, eksport XLSX, dashboard z sześcioma filtrami
(`services/entryStats.js`). Dokładnie ta klasa zapytań jest w pamiętnej notatce z 21.08.2026
wskazana jako mnożnik problemu.

Rozwiązanie mieści się w Node bez żadnej nowej zależności: **`worker_threads` z osobnym,
tylko-do-odczytu połączeniem do tego samego pliku.**

- WAL pozwala czytać **równolegle** z zapisem, więc czytelnik w wątku nie kłóci się
  z kioskiem odbijającym kartę;
- połączenie otwarte z `readonly: true` fizycznie nie może wziąć blokady zapisu, więc nie
  wraca problem „dwa połączenia w jednym procesie”, przed którym słusznie ostrzega
  `services/db.js` — tamten dotyczył dwóch połączeń **piszących**;
- pętla zdarzeń zostaje wolna: trzysekundowy raport przestaje być trzema sekundami,
  w których serwer nie odpowiada nikomu.

Zapisy zostają tam, gdzie są: jedno połączenie, jeden wątek, `busy_timeout` 3 s.

### Kopie zapasowe, które istnieją bez pamiętania o nich

Dziś backup to zdanie w README: „skopiuj plik przy zatrzymanej aplikacji albo zrób
`.backup`”. To znaczy, że kopia istnieje wtedy, gdy ktoś o niej pomyślał.

W 2.0 jest to zadanie okresowe na tym samym budziku, na którym stoi domykanie kart, a
mechanizm ma już w bazie własną zapadkę (`JobRuns`):

- `VACUUM INTO 'kopia-RRRR-MM-DD.sqlite'` — spójna kopia **bez** zatrzymywania aplikacji,
  przy okazji zdefragmentowana;
- rotacja: siedem dziennych, cztery tygodniowe (dysk ma 10 GB, baza jest rzędu megabajtów);
- po kopii `PRAGMA integrity_check` na pliku wynikowym i wpis w logu — kopia, której nikt
  nigdy nie odczytał, jest kopią hipotetyczną.

### Budżet pamięci jako liczba, nie przeczucie

`ecosystem.config.js` restartuje proces przy 700 MB, a `services/loginRateLimit.js` ma
policzone górne granice map (2000 + 5000 kluczy ≈ 1,4 MB) z uzasadnieniem, dlaczego to musi
być **wyliczone**, a nie „pewnie się zmieści”. To jest właściwe podejście i w 2.0 obowiązuje
je każdy byt żyjący w pamięci procesu: cache statementów w `entryStats.js`, cache świąt
w `workingDays.js`, bufory eksportu. Reguła: struktura rosnąca z ruchem ma zapisany sufit
albo jej nie ma.

---

## Gdyby zdjąć ograniczenie hostingu

Ten rozdział jest osobno, bo **nie jest zaleceniem dla obecnego wdrożenia**. Opisuje,
które dzisiejsze rozwiązania są obejściami — czyli co zniknęłoby samo, gdyby baza nie była
plikiem obsługiwanym synchronicznie przez jeden proces.

### Postgres

Nie dlatego, że „SQLite to zabawka” — dla kilkunastu użytkowników i bazy rzędu megabajtów
SQLite jest wyborem poprawnym. Dlatego, że **cały łańcuch dzisiejszych decyzji
architektonicznych jest jego konsekwencją**:

| Dzisiejsze rozwiązanie | Powód | Przy Postgresie |
|---|---|---|
| Połączenie na `globalThis`, nie w zmiennej modułu | dwa runtime'y webpacka = dwa połączenia = zamrożenie procesu | pula połączeń, temat nie istnieje |
| `pm2 instances: 1`, zakaz klastra | kilka procesów przy jednym pliku | tyle instancji, ile trzeba |
| `busy_timeout` 3 s jako „próg zamrożenia całego serwera” | czekanie jest synchroniczne | czekanie jest asynchroniczne i dotyczy jednego żądania |
| Dławik `SWEEP_EVERY_MS` i skracanie `busy_timeout` do 250 ms przy sprzątaniu | każdy zapis przy odczycie strony to ryzyko kolizji | sprzątanie jako zwykłe zadanie |
| Limiter logowania w pamięci, nie w bazie | zapis przy każdej nieudanej próbie to kolizje | wiersz w bazie albo Redis, wspólny dla instancji |
| Budzik w procesie + zapadka `JobRuns` | brak crona i zakaz drugiego procesu | cron systemowy albo kolejka zadań |
| Raporty synchroniczne blokujące wszystkich | brak innego trybu | zwykłe zapytanie asynchroniczne |

Zwracam uwagę na kolumnę środkową: **żadna z tych decyzji nie jest błędem**. Każda jest
poprawną odpowiedzią na ograniczenie. Jest ich tylko siedem i każda kosztuje trochę
złożoności, którą ktoś musi pamiętać.

### Co jeszcze wygląda inaczej

- **Zadania okresowe** — cron systemowy albo zewnętrzny wyzwalacz zamiast `setInterval`
  z zapadką. Zapadka jest rozwiązaniem eleganckim, ale istnieje, bo drugi proces był
  zakazany.
- **Eksporty** — generowane w tle, odkładane do magazynu obiektowego, użytkownik dostaje
  link zamiast czekać na strumień. Dziś strumieniowanie jest konieczne, bo nie ma gdzie
  odłożyć pliku.
- **Poczta** — kolejka z ponowieniami. Dziś wysyłka jest odpalana i porzucana
  (`notifyOvertimeApproved(request, author).catch(() => {})` w `pages/api/overtime/[id].js`),
  więc nie opóźnia odpowiedzi — ale też nie ma ponowienia: chwilowa awaria SMTP-a albo
  restart procesu w złym momencie znaczy, że powiadomienie po prostu nie powstało.
  Przy jednym procesie bez kolejki nie ma lepszego wyjścia, bo alternatywą jest wysyłka
  blokująca użytkownika.
- **Sesje i limitery** — wspólny magazyn zamiast pamięci procesu, bo instancji jest więcej
  niż jedna.

I zdanie, które jest tu ważniejsze od wszystkich powyższych: **przy obecnej skali nic
z tego nie jest potrzebne.** Dwunastu jednoczesnych użytkowników na SQLite to problem
rozwiązany i zmierzony (README: 0,4 s po poprawce zamiast 5,7 s). Ten rozdział ma sens
dopiero wtedy, gdy przyjdzie pytanie o sto osób w kilku lokalizacjach.

---

## Czego bym nie zmieniał mimo pokusy

**SQLite.** Dla kilkunastu do stu użytkowników w jednej firmie jest to wybór, którego bym
bronił. Backup jest kopią pliku, wdrożenie nie ma osobnego serwera bazy, a opóźnienia są
mikrosekundowe. Zmiana na Postgresa bez realnej potrzeby to dokładanie drugiego procesu do
utrzymania w zamian za problem, którego nie ma.

**Brak ORM-a.** Przygotowane `statement`-y w `better-sqlite3` z SQL-em napisanym wprost są
tutaj czytelniejsze i szybsze od czegokolwiek, co wygeneruje warstwa pośrednia — zwłaszcza
przy zapytaniach takich jak indeks na wyrażeniu `substr(data,1,10)` czy funkcja
`plContains` rejestrowana w SQLite do porównywania polskich znaków. ORM by tego nie
ułatwił, tylko przykrył. Query builder (Kysely) rozważyłbym wyłącznie jako narzędzie do
**typów**, nie do abstrakcji.

**Brak mikroserwisów, kolejek i warstwy zdarzeń w architekturze.** Jedna aplikacja, jeden
proces, jeden plik bazy. Przy tej dziedzinie wszystko inne byłoby kosztem bez odbiorcy.

**Brak systemu designu z półki.** Komponenty w `components/ui/` plus tokeny semantyczne
w `tailwind.config.js` to jakieś kilkaset linii i zero zależności, a dają spójność, której
Material czy shadcn nie dałyby lepiej — za to dałyby kilkadziesiąt megabajtów i cudzy
język wizualny zamiast „tablicy odjazdów”.

**Polski w nazwach adresów, sekcji i komunikatów.** `/nadgodziny`, `/urlopy/zarzadzaj` —
to jest aplikacja dla konkretnej firmy, a nie produkt na eksport. Angielski w adresach
byłby tłumaczeniem dla nikogo.

---

## Gdyby to było jedno zdanie

Wersja 1 broni się komentarzami tam, gdzie wersja 2 broniłaby się typami, testami
i schematem. Zdecydowana większość decyzji w tym repozytorium jest świadoma i opisana —
łącznie z tymi, które sam bym podjął inaczej. To, czego brakuje, to nie pomysły, tylko
**mechanizmy egzekwujące** te, które już zapadły: dziś „przeliczaj `seconds` tylko tutaj”
jest zdaniem w komentarzu, a nie czymś, czego kompilator albo test nie przepuści.

Jeśli miałbym z całego dokumentu wybrać trzy rzeczy do jednej wersji, byłyby to:

1. **Jeden format czasu** — bo dzisiejszy rozdźwięk między `Times` a `TaskEntries` jest
   jedynym miejscem, w którym poprawny kod daje złą liczbę po zmianie strefy serwera.
2. **Testy czystych funkcji** — kilkadziesiąt testów na `workday`, `workingDays`,
   `leaveBalance` i `DifferenceTime` chroni dokładnie te liczby, które trafiają do kadr.
3. **Grafik pracy jako byt** — bo `WORKDAY_HOURS = 8` jest stałą, o którą prędzej czy
   później zapyta pierwszy pracownik na pół etatu.

A niezależnie od całej wersji 2.0: `pages/api/time/[id].js` jest jedynym miejscem, w którym
serwer zapisuje do bazy to, co przysłała przeglądarka, bez sprawdzenia czegokolwiek poza
rolą. To nie wymaga przepisywania aplikacji — wystarczy schemat Joi i wyliczenie
`totalWorkTime` po stronie serwera, dokładnie tak jak robi to moduł zadań.
