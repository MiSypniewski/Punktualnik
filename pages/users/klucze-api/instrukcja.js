import Link from "next/link";
import BaseLayout from "../../../components/baseLayout";
import Alert from "../../../components/ui/alert";
import PageHeader from "../../../components/ui/pageHeader";
import { Table, TableWrap, Td, Th, Tr } from "../../../components/ui/table";
import { getActiveToken } from "../../../services/session";
import { canTrackTasks } from "../../../services/roles";
import { now as appNow, workDay } from "../../../services/workday";
import { API_KEY_MAX_ACTIVE, API_SCOPE_LABEL, API_SCOPES } from "../../../utils/apiScopes";
import { apiExamples } from "../../../utils/apiExamples.cjs";
import { EMPTY_CLOSE_MIN } from "../../../utils/emptyTimer";

// Instrukcja API dla pracownika. README opisuje to samo od strony utrzymania, ale
// pracownik nie ma powodu tam zaglądać. Przykłady żyją w utils/apiExamples.cjs i uruchamia
// je scripts/apidocs-check.js, więc nie mogą po cichu rozjechać się z zachowaniem API.
export const getServerSideProps = async (context) => {
  const token = await getActiveToken(context.req);
  if (!token) {
    return { redirect: { destination: "/users/signin", permanent: false } };
  }
  if (!canTrackTasks(token.role)) {
    return { notFound: true };
  }
  return {
    props: {
      // Adres z konfiguracji, nie z nagłówka Host, który podaje klient.
      baseUrl: (process.env.NEXTAUTH_URL || "").replace(/\/$/, ""),
      today: workDay(appNow()),
    },
  };
};

const Heading = ({ children }) => (
  <h2 className="mt-10 mb-3 text-sm font-bold uppercase tracking-signage">{children}</h2>
);

const Text = ({ children }) => <p className="mb-3 text-sm leading-6">{children}</p>;

const Inline = ({ children }) => <code className="font-mono text-xs px-1 rounded-sm bg-raised break-all">{children}</code>;

const Example = ({ example: { title, command, note } }) => (
  <div className="mb-5">
    <p className="mb-1 text-sm font-medium">{title}</p>
    <pre className="p-3 rounded border border-line-subtle bg-raised overflow-x-auto">
      <code className="font-mono text-xs leading-5">
        {command}
      </code>
    </pre>
    {note && <p className="mt-1 text-xs text-muted">{note}</p>}
  </div>
);

const Rows = ({ head, rows }) => (
  <TableWrap className="mb-4">
    <Table>
      <thead>
        <tr>
          {head.map((h) => (
            <Th key={h}>{h}</Th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((cells, row) => (
          <Tr key={row}>
            {cells.map((cell, i) => (
              <Td key={i}>{cell}</Td>
            ))}
          </Tr>
        ))}
      </tbody>
    </Table>
  </TableWrap>
);

export default function ApiInstructions({ baseUrl, today }) {
  const examples = apiExamples({ baseUrl, today });

  return (
    <BaseLayout>
      <PageHeader
        title="Instrukcja API"
        description="Jak sterować własnym timerem i wpisami spoza przeglądarki."
      />

      <Text>
        API robi to samo co strona Zadania: uruchamia timer, dopisuje i poprawia wpisy. Działa wyłącznie na Twoich
        wpisach. Nie daje dostępu do kart czasu, urlopów, nadgodzin ani danych innych osób.
      </Text>

      <Heading>Pierwsze kroki</Heading>
      <ol className="mb-4 ml-5 list-decimal text-sm leading-7">
        <li>
          Utwórz klucz na stronie{" "}
          <Link href="/users/klucze-api">
            <a className="text-accent-strong hover:underline">Klucze API</a>
          </Link>{" "}
          i od razu go skopiuj. Później nie da się go odczytać.
        </li>
        <li>Zapisz klucz w zmiennej środowiskowej, a nie w kodzie skryptu.</li>
        <li>Sprawdź, czy działa.</li>
      </ol>
      <Example example={examples.exportKey} />
      <Example example={examples.me} />
      <Alert tone="info" className="mb-4">
        Przykłady są napisane dla terminala macOS i Linuksa. W Windows najprościej uruchomić je w Git Bash albo WSL.
      </Alert>

      <Heading>Uprawnienia klucza</Heading>
      <Text>Zaznacz tylko to, czego potrzebuje dany program. Uprawnień istniejącego klucza nie da się zmienić, trzeba utworzyć nowy.</Text>
      <Rows head={["Uprawnienie", "Co pozwala robić"]} rows={API_SCOPES.map((scope) => [<Inline key={scope}>{scope}</Inline>, API_SCOPE_LABEL[scope]])} />

      <Heading>Timer</Heading>
      <Example example={examples.projects} />
      <Example example={examples.start} />
      <Example example={examples.patch} />
      <Example example={examples.running} />
      <Example example={examples.switchTask} />
      <Example example={examples.stop} />
      <Alert tone="warn" className="mb-4">
        Timer bez opisu i bez projektu zostanie zamknięty po {EMPTY_CLOSE_MIN} minutach, tak samo jak w aplikacji, a kierownik
        dostanie o nim wcześniej wiadomość. Skrypt powinien od razu podawać przynajmniej jedno z tych pól.
      </Alert>

      <Heading>Wpisy</Heading>
      <Example example={examples.list} />
      <Example example={examples.create} />
      <Example example={examples.update} />
      <Example example={examples.remove} />

      <Heading>Reguły</Heading>
      <ul className="mb-4 ml-5 list-disc text-sm leading-7">
        <li>Wpisy można dopisywać, poprawiać i kasować tylko z dziś i wczoraj. Dotyczy to także kierowników.</li>
        <li>Doba robocza zaczyna się o 3:00, więc wpis z 1:00 w nocy należy jeszcze do poprzedniego dnia.</li>
        <li>Godziny są w czasie polskim i bez strefy, w formacie <Inline>GG:MM</Inline>. Daty mają format <Inline>RRRR-MM-DD</Inline>.</li>
        <li>Wpisy nie mogą na siebie nachodzić.</li>
        <li>Opis może mieć najwyżej 200 znaków.</li>
        <li>Limity na osobę: 120 odczytów i 30 zmian na minutę. Możesz mieć {API_KEY_MAX_ACTIVE} aktywnych kluczy.</li>
        <li>Kierownik widzi przy wpisie utworzonym kluczem znacznik „API”. Nie obniża on oceny poprawności wpisów.</li>
      </ul>

      <Heading>Gdy coś nie działa</Heading>
      <Rows
        head={["Kod", "Co znaczy", "Co zrobić"]}
        rows={[
          ["401", "Klucz nie działa: jest błędny, odwołany lub wygasły albo konto zmieniło hasło", "Sprawdź stan na stronie Klucze API i w razie potrzeby utwórz nowy"],
          ["403", "Klucz nie ma uprawnienia albo projekt jest poza Twoim zasięgiem", "Pole required podaje brakujące uprawnienie. Sprawdź też listę projektów"],
          ["404", "Nie ma takiego wpisu albo projektu, albo wpis należy do kogoś innego", "Sprawdź numer"],
          ["409", "Konflikt: timer już biegnie, nie biegnie, wpis nachodzi na inny albo jest starszy niż wczoraj", "Pole error mówi, o który przypadek chodzi"],
          ["415", "Treść żądania nie jest JSON-em", 'Dodaj nagłówek "Content-Type: application/json"'],
          ["422", "Dane niezgodne z regułami, np. brak opisu albo projektu przy zatrzymaniu", "Pole message wyjaśnia to po polsku"],
          ["429", "Za dużo żądań", "Poczekaj tyle sekund, ile podaje nagłówek Retry-After"],
          ["503", "Baza jest chwilowo zajęta", "Ponów po czasie z nagłówka Retry-After"],
        ]}
      />

      <Heading>Bezpieczeństwo klucza</Heading>
      <ul className="mb-4 ml-5 list-disc text-sm leading-7">
        <li>Traktuj klucz jak hasło. Nie wklejaj go do repozytorium, czatu ani zgłoszenia.</li>
        <li>Używaj osobnego klucza dla każdego programu, żeby móc odciąć jeden bez ruszania pozostałych.</li>
        <li>Klucz wysyłaj wyłącznie w nagłówku Authorization, nigdy w adresie.</li>
        <li>Po wycieku odwołaj klucz na stronie Klucze API. Działa to od następnego żądania.</li>
        <li>Zmiana hasła unieważnia wszystkie Twoje klucze. Programy trzeba wtedy wyposażyć w nowe.</li>
        <li>Klucz wygasa w wybranym terminie i nie dostaniesz o tym przypomnienia. Program zacznie wtedy dostawać błąd 401.</li>
      </ul>

      <Heading>Agent AI i systemy zewnętrzne</Heading>
      <ul className="mb-4 ml-5 list-disc text-sm leading-7">
        <li>Agentowi AI daj zwykle tylko <Inline>read</Inline> i <Inline>timer</Inline>. Bez <Inline>entries:delete</Inline> nie skasuje wpisów, nawet jeśli zostanie do tego nakłoniony treścią, którą czyta.</li>
        <li>Program z kluczem wysyła nazwy projektów i klientów oraz opisy zadań tam, gdzie sam działa, np. do dostawcy modelu AI. Sprawdź, czy wolno Ci tam przekazywać te dane.</li>
        <li>Klucz na cudzym serwerze ustaw na możliwie krótki termin ważności i sprawdzaj datę ostatniego użycia.</li>
      </ul>
    </BaseLayout>
  );
}
