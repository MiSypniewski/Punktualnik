import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import classNames from "classnames";
import { ProjectDot } from "./projectColors";
import { formatDuration, hhmm } from "../utils";

// Sekcja "Teraz w toku" na górze raportu kierownika.
//
// Osobny plik, bo pages/zadania/zarzadzaj.js jest już długi, a ta część ma
// własne życie: tyka co sekundę i sama dociąga dane. NIC stąd nie importuje
// z services/ — tamte moduły wciągają better-sqlite3, które w bundlu klienta
// nie ma czego szukać.

const POLL_MS = 45_000;

// Timer biegnący dłużej niż dniówka to prawie zawsze zapomniany licznik, a nie
// ośmiogodzinne zadanie. Auto-domknięcie złapie go dopiero o 3:00, więc ta
// lista jest jedynym miejscem, gdzie da się zareagować tego samego dnia.
const LONG_RUN_MIN = 8 * 60;

// Świadomie NIE używamy jsonFetcher z utils/ — tamten nie sprawdza res.ok, więc
// odpowiedź 403 albo 401 wróciłaby do SWR jako poprawne dane ({error: ...})
// i lista wyzerowałaby się bez żadnego śladu. Rzucony wyjątek zostawia
// na ekranie ostatni znany stan.
const fetchBoard = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

const fullName = (person) => `${person.surname} ${person.name}`;

export default function LiveBoard({ initial, currentUserID }) {
  const { data, error } = useSWR("/api/entries/running", fetchBoard, {
    // Dane z SSR jako pierwszy render — sekcja nie miga pustką przy wejściu.
    fallbackData: initial,
    refreshInterval: POLL_MS,
    // refreshWhenHidden zostaje domyślnie wyłączone: karta schowana w tle nie
    // odpytuje serwera, a revalidateOnFocus dociąga świeże dane dokładnie
    // w chwili powrotu do zakładki, bez czekania na koniec cyklu.
  });

  const board = data ?? initial;
  const running = board?.running ?? [];
  const idle = board?.idle ?? [];

  // Sekundy dorobione lokalnie od chwili odebrania danych. Startuje od zera,
  // więc pierwszy render klienta jest identyczny z HTML-em z serwera i nie ma
  // ostrzeżenia o niezgodnej hydracji.
  const [drift, setDrift] = useState(0);
  const receivedAt = useRef(null);

  useEffect(() => {
    receivedAt.current = Date.now();
    setDrift(0);
  }, [board]);

  useEffect(() => {
    // Licznik liczony RÓŻNICOWO wobec chwili odbioru, nigdy przez prev + 1:
    // karta w tle bywa dławiona do jednego ticka na minutę i inkrementacja
    // rozjechałaby się nieodwracalnie.
    const tick = () => {
      if (receivedAt.current === null) return;
      setDrift(Math.floor((Date.now() - receivedAt.current) / 1000));
    };

    const handle = setInterval(tick, 1000);
    return () => clearInterval(handle);
  }, []);

  const total = running.length + idle.length;

  return (
    <section className="mb-6 border border-line rounded overflow-hidden">
      <header className="flex items-baseline justify-between gap-2 flex-wrap px-3 py-2 bg-raised border-b border-line">
        <h2 className="font-bold">
          Teraz w toku{" "}
          <span className="font-normal text-muted">
            ({running.length} z {total})
          </span>
        </h2>
        <p className="text-xs text-muted">
          Stan bieżący, <span className="font-medium">niezależny od filtrów poniżej</span>
          {board?.generatedAt && ` · ${hhmm(board.generatedAt)}`}
          {error && <span className="text-amber-800 dark:text-amber-300"> · brak łączności, dane mogą być nieaktualne</span>}
        </p>
      </header>

      {running.length === 0 ? (
        <p className="px-3 py-3 text-sm text-muted">
          Nikt z twoich sekcji nie ma teraz uruchomionego timera.
        </p>
      ) : (
        <ul>
          {running.map((r) => {
            const elapsed = r.elapsedSec + drift;
            const tooLong = elapsed / 60 > LONG_RUN_MIN;

            return (
              <li
                key={r.id}
                className={classNames(
                  "flex items-center gap-3 px-3 py-2 border-b border-line-subtle",
                  tooLong && "bg-amber-50 dark:bg-amber-500/10"
                )}
              >
                <ProjectDot color={r.projectColor} />
                <div className="flex-grow min-w-0">
                  <p className="font-medium truncate">
                    {fullName(r)}
                    {Number(r.userID) === Number(currentUserID) && (
                      <span className="ml-2 text-xs font-normal text-muted">(Ty)</span>
                    )}
                  </p>
                  <p className="text-sm text-muted truncate">
                    {r.projectName} ·{" "}
                    {/* Opis w kolorze przycisku "Pokaż" (indigo-500) — to jedyna
                        rzecz w wierszu, której kierownik naprawdę szuka wzrokiem;
                        projekt i godzina są kontekstem i zostają szare. */}
                    {r.description ? (
                      <span className="text-indigo-500 dark:text-indigo-300">{r.description}</span>
                    ) : (
                      "(bez opisu)"
                    )}{" "}
                    · od {hhmm(r.startedAt)}
                  </p>
                </div>
                <span
                  className={classNames(
                    "font-mono tabular-nums whitespace-nowrap",
                    tooLong ? "text-amber-800 dark:text-amber-300" : "text-body"
                  )}
                  title={tooLong ? "Biegnie ponad 8 godzin — sprawdź, czy to nie zapomniany timer" : null}
                >
                  {formatDuration(elapsed)}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {idle.length > 0 && (
        // Bezczynni zwięźle, w jednym akapicie zamiast drugiej tabeli: sekcja
        // stoi nad całym raportem i przy kilkunastu osobach zepchnęłaby go
        // poza ekran telefonu.
        <div className="px-3 py-2 bg-raised border-t border-line-subtle">
          <p className="text-xs font-medium text-body mb-1">Bez timera ({idle.length})</p>
          <p className="text-xs text-muted leading-5">
            {idle.map((u, i) => (
              <span key={u.id}>
                {i > 0 && " · "}
                {fullName(u)}
                {Number(u.id) === Number(currentUserID) && " (Ty)"}
                <span className="text-faint">
                  {u.lastEndedAt
                    ? ` — ostatni wpis ${hhmm(u.lastEndedAt)}, dziś ${formatDuration(u.seconds)}`
                    : " — brak wpisów dzisiaj"}
                </span>
              </span>
            ))}
          </p>
          {/* Aplikacja nie wie nic o urlopach ani zwolnieniach — bez tego zdania
              lista czyta się jak spis obiboków, a zwykle jest spisem nieobecnych. */}
          <p className="mt-1 text-xs text-muted">
            Brak timera nie znaczy braku pracy — aplikacja nie zna urlopów, zwolnień ani zadań
            raportowanych ręcznie po fakcie.
          </p>
        </div>
      )}
    </section>
  );
}
