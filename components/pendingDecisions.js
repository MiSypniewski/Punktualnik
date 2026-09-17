import { useState } from "react";
import Link from "next/link";
import classNames from "classnames";
import { ABSENCE_KINDS, absenceKindLabel } from "../services/absenceKinds";
import { kindLabel as overtimeKindLabel, kindSign } from "../services/overtimeKinds";
import { Alert, Button, EmptyState, Plate, PlateHeader } from "./ui";
import { formatDateRange, formatMinutes } from "../utils";

// Wnioski czekające na decyzję — urlopowe i nadgodzinowe w jednej liście.
//
// Sens łączenia: kierownik nie myśli kategoriami tabel. Rano ma do
// rozstrzygnięcia „cztery rzeczy”, a nie „dwa urlopy w jednym panelu i dwie
// nadgodziny w drugim”. Dwa osobne ekrany znaczyły, że o jednym z nich zawsze
// się zapomina.
//
// Decyzję podejmują ISTNIEJĄCE endpointy: PUT /api/absences/[id] i
// PUT /api/overtime/[id] z { action }. Ten sam zasięg sekcyjny, ta sama blokada
// przy równoległej decyzji (WHERE status='pending' → 409 already_decided) i te
// same maile. Tutaj nie ma ANI JEDNEJ nowej reguły serwerowej — duplikuje się
// wyłącznie obudowa przycisku.
//
// Czego tu świadomie NIE MA: pola notatki, cofania wniosku i przydziału dni.
// Notatka jest sensowna przy odmowie, którą trzeba uzasadnić, a to jest praca
// przy biurku, nie spojrzenie z rana; cofnięcie wymaga obowiązkowego powodu
// i dotyczy wniosków już rozpatrzonych. Na jedno i drugie prowadzi link
// „Rozpatrz szczegółowo”, zawężony do tego pracownika.

const dayWord = (n) => (Math.abs(n) === 1 ? "dzień" : "dni");

/**
 * Ile dni czeka wniosek. Liczone z createdAt, bo to jedyna informacja o tym,
 * czy kierownik o kimś zapomniał — data samej nieobecności tego nie mówi
 * (wniosek na grudzień złożony w styczniu nie jest zaległy).
 */
const waitingDays = (createdAt) => {
  const created = Date.parse(createdAt);
  if (Number.isNaN(created)) return 0;
  return Math.max(0, Math.floor((Date.now() - created) / 86_400_000));
};

const ERRORS = {
  already_decided: "Ten wniosek został już rozpatrzony (np. w innej karcie przeglądarki).",
  permission_denied: "Ten wniosek nie należy do twoich sekcji.",
  not_found: "Wniosek już nie istnieje.",
};

/**
 * Jeden wiersz listy. Kształt jest wspólny dla obu rodzajów wniosku, bo różnią
 * się tylko wymiarem (dni robocze kontra godziny) i adresem API.
 */
const Row = ({ item, busy, onDecide }) => (
  <li className="px-3 py-3 border-b border-line-subtle last:border-0">
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className="font-medium">
        {item.surname} {item.name}
      </span>
      <span className="text-xs text-muted">{item.section}</span>
      <span className="ml-auto font-mono text-sm tabular-nums whitespace-nowrap">{item.when}</span>
    </div>

    <p className="mt-0.5 text-sm text-muted">
      {item.kindLabel} · <strong className="text-body">{item.size}</strong>
      {item.after !== null && (
        <>
          {" · po zatwierdzeniu zostanie "}
          <strong className={item.after < 0 ? "text-danger-strong" : "text-body"}>
            {item.after} {dayWord(item.after)}
          </strong>
        </>
      )}
      {item.waiting > 0 && ` · czeka ${item.waiting} ${dayWord(item.waiting)}`}
    </p>

    {item.reason && <p className="mt-0.5 text-sm text-muted">{item.reason}</p>}

    {/* Ostrzeżenie, nie blokada: zgoda na urlop na poczet przyszłego przydziału
        jest decyzją kierownika, nie pomyłką systemu — tak samo jak w panelu
        wniosków. Bez tego zdania dashboard byłby jedynym miejscem, gdzie saldo
        schodzi na minus po cichu. */}
    {item.after !== null && item.after < 0 && (
      <p className="mt-1 text-sm text-danger-strong">
        Ten wniosek przekracza przydział. Zatwierdzenie jest możliwe — saldo zejdzie poniżej zera.
      </p>
    )}

    <div className="mt-2 flex flex-wrap items-center gap-2">
      <Button variant="primary" disabled={busy} onClick={() => onDecide(item, "approve")}>
        Zatwierdź
      </Button>
      <Button variant="danger" disabled={busy} onClick={() => onDecide(item, "reject")}>
        Odrzuć
      </Button>
      <Link href={item.detailHref}>
        <a className="text-sm text-accent-strong hover:underline">Rozpatrz szczegółowo →</a>
      </Link>
    </div>
  </li>
);

/**
 * @param {object[]} absences wnioski urlopowe ze statusem pending
 * @param {object[]} overtime wnioski nadgodzinowe ze statusem pending
 * @param {Record<string, number>} leaveLeft pozostałe dni puli, klucz "rok:userID"
 * @param {() => Promise<unknown>} onDecided odświeżenie widoku po decyzji.
 *   Podaje je STRONA, bo to ona trzyma klucz SWR — patrz komentarz w decide().
 */
const PendingDecisions = ({ absences = [], overtime = [], leaveLeft = {}, onDecided, className }) => {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const items = [
    ...absences.map((a) => {
      // Pula rozlicza się na rok kalendarzowy, więc saldo bierzemy z ROKU
      // WNIOSKU, a nie bieżącego: w grudniu na liście stoją obok siebie wnioski
      // z dwóch salad i wspólne saldo kłamałoby przy jednym z nich.
      const left = leaveLeft[`${a.year}:${a.userID}`];
      const usesPool = ABSENCE_KINDS[a.kind]?.usesPool;

      return {
        key: `a${a.id}`,
        id: a.id,
        userID: a.userID,
        name: a.name,
        surname: a.surname,
        section: a.section,
        kindLabel: absenceKindLabel(a.kind),
        when: formatDateRange(a.dateFrom, a.dateTo),
        size: `${a.workDays} ${dayWord(a.workDays)} roboczych`,
        after: left === undefined || !usesPool ? null : left - a.workDays,
        reason: a.reason,
        waiting: waitingDays(a.createdAt),
        createdAt: a.createdAt,
        url: `/api/absences/${a.id}`,
        detailHref: `/urlopy/zarzadzaj?userID=${a.userID}`,
      };
    }),
    ...overtime.map((o) => ({
      key: `o${o.id}`,
      id: o.id,
      userID: o.userID,
      name: o.name,
      surname: o.surname,
      section: o.section,
      kindLabel: overtimeKindLabel(o.kind),
      when: o.data,
      // Znak bierze się z rodzaju, tak jak w saldzie — "wcześniejsze wyjście"
      // na 90 minut to −1h 30min, nie +1h 30min.
      size: formatMinutes(kindSign(o.kind) * o.minutes, { withSign: true }),
      after: null,
      reason: o.reason,
      waiting: waitingDays(o.createdAt),
      createdAt: o.createdAt,
      url: `/api/overtime/${o.id}`,
      detailHref: `/nadgodziny/zarzadzaj?userID=${o.userID}`,
    })),
  ]
    // Najdłużej czekające na górze. To jedyny porządek, który odpowiada na
    // pytanie "o kim zapomniałem" — sortowanie po dacie nieobecności stawiałoby
    // na górze wnioski złożone dziś na daleki termin.
    .sort((x, y) => String(x.createdAt).localeCompare(String(y.createdAt)));

  const decide = async (item, action) => {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch(item.url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        setErr(ERRORS[body.error] || "Nie udało się zapisać decyzji.");
        return;
      }
      // Odświeżenie przez mutate SWR, a NIE przez router.replace(router.asPath).
      //
      // Idiom z router.replace działa na stronach czysto serwerowych (panel
      // wniosków, raport zadań), ale nie tutaj i był to realny błąd: ten widok
      // czyta board z SWR (`data ?? initial`), a świeże propsy SSR nie
      // nadpisują istniejącego wpisu w cache'u SWR — fallbackData obowiązuje
      // tylko dopóki cache jest pusty. Decyzja zapisywała się w bazie, po czym
      // ekran dalej pokazywał starą liczbę wniosków, aż do końca cyklu
      // odpytywania. Ten sam powód, dla którego /time/zarzadzaj woła mutate().
      //
      // Jedno żądanie wystarcza: /api/absences/board zwraca CAŁY stan ekranu —
      // wiersze, kafle, wnioski i saldo puli — a zatwierdzony urlop na dziś
      // zmienia nie tylko tę listę, ale i stan pracownika w tabeli.
      if (onDecided) await onDecided();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Plate className={classNames("overflow-hidden", className)}>
      <PlateHeader className="bg-raised">
        <h2 className="text-xs font-bold uppercase tracking-signage">
          Do rozpatrzenia{" "}
          <span className="font-mono font-normal normal-case tracking-normal text-muted">
            {items.length}
          </span>
        </h2>
        <p className="text-xs text-muted">
          Urlopy i nadgodziny razem · notatka, cofnięcie i pula dni w panelach modułów
        </p>
      </PlateHeader>

      {err && (
        <Alert tone="danger" className="m-3">
          {err}
        </Alert>
      )}

      {items.length === 0 ? (
        <EmptyState title="Nic nie czeka" description="Wszystkie wnioski są rozpatrzone." />
      ) : (
        <ul>
          {items.map((item) => (
            <Row key={item.key} item={item} busy={busy} onDecide={decide} />
          ))}
        </ul>
      )}
    </Plate>
  );
};

export default PendingDecisions;
