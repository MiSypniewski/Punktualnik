import nodemailer from "nodemailer";
import { logError, logInfo, logWarn } from "./log";

// Transport poczty wychodzącej (OVH, SMTP po SSL/TLS na porcie 465).
//
// Zbudowany na tej samej zasadzie co services/notifyGChat.js: BRAK KONFIGURACJI
// = powiadomienia po prostu wyłączone, a cała reszta aplikacji działa bez zmian.
// Maszyna deweloperska bez hasła do skrzynki ma zachowywać się normalnie, a nie
// wywracać się przy zatwierdzaniu wniosku.
//
// Hasło do skrzynki jest sekretem — siedzi w .env.local, poza repozytorium.

// Nazwy zmiennych czytamy w OBU wielkościach liter, bo process.env jest na nie
// wrażliwe, a plik konfiguracyjny na serwerze ma je zapisane małymi. Wielkie
// warianty zostają jako droga wyjścia, gdyby nazewnictwo kiedyś ujednolicono.
const LOGIN = process.env.EMAIL_LOGIN || process.env.email_login || "";
const PASSWORD = process.env.EMAIL_PASSWORD || process.env.email_password || "";

// Domyślne wartości wprost z instrukcji OVH. Alternatywny host to smtp.mail.ovh.net.
const HOST = process.env.SMTP_HOST || "ssl0.ovh.net";
const PORT = Number(process.env.SMTP_PORT || 465);

// OVH odrzuca kopertę z adresem nadawcy innym niż zalogowany, więc domyślnie
// nadawcą jest po prostu login skrzynki.
const FROM = process.env.EMAIL_FROM || (LOGIN ? `Punktualnik <${LOGIN}>` : "");

export const mailEnabled = Boolean(LOGIN && PASSWORD);

// Zawieszony socket nie zablokuje nocnej pętli ani nie zostawi wiszącego
// uchwytu. To nie jest ścieżka żądania użytkownika, ale wysyłek bywa kilka
// z rzędu i jedna martwa potrafi zatrzymać całą kolejkę.
const TIMEOUT_MS = 10_000;

// Transport trzymany na `globalThis`, nie w zmiennej modułu — z dokładnie tego
// samego powodu co uchwyt bazy w services/db.js: Next 12 buduje osobne rejestry
// modułów dla stron i dla tras API, więc ten plik wykonuje się w procesie dwa
// razy. Przy `pool: true` znaczyłoby to dwie pule otwartych połączeń SMTP.
const globalForMail = globalThis;

const createTransport = () => {
  const transport = nodemailer.createTransport({
    host: HOST,
    port: PORT,
    // Port 465 to SMTPS: szyfrowanie od pierwszego bajtu, bez STARTTLS.
    secure: PORT === 465,
    auth: { user: LOGIN, pass: PASSWORD },
    pool: true,
    // Jedno połączenie i jedna wiadomość naraz. Nocna paczka to kilkanaście
    // maili, a dostawcy poczty współdzielonej nie lubią równoległych sesji.
    maxConnections: 1,
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
    socketTimeout: TIMEOUT_MS,
  });

  logInfo("mail", "transport gotowy", { host: HOST, port: PORT });
  return transport;
};

const getTransport = () => {
  if (!globalForMail.__punktualnikMailer) {
    globalForMail.__punktualnikMailer = createTransport();
  }
  return globalForMail.__punktualnikMailer;
};

/**
 * Wysyłka jednej wiadomości. NIGDY nie rzuca — problem ze skrzynką nie ma prawa
 * wywrócić zatwierdzenia wniosku ani przerwać nocnej pętli w połowie.
 *
 * Adresów NIE logujemy: services/log.js mówi wprost "id tak, hasła i e-maile nie".
 * W logu zostaje rodzaj powiadomienia i liczba odbiorców.
 *
 * @param {{to: string[], cc?: string[], subject: string, text: string, html?: string, kind?: string}} message
 * @returns {Promise<boolean>} czy wiadomość wyszła
 */
export const sendMail = async ({ to, cc = [], subject, text, html, kind = "?" }) => {
  if (!mailEnabled) return false;

  const toList = (to ?? []).filter(Boolean);
  const ccList = (cc ?? []).filter(Boolean);
  if (toList.length === 0 && ccList.length === 0) {
    logWarn("mail", "powiadomienie bez adresatów — pominięte", { kind });
    return false;
  }

  try {
    await getTransport().sendMail({
      from: FROM,
      to: toList,
      cc: ccList,
      subject,
      text,
      html,
    });
    logInfo("mail", "wysłano", { kind, to: toList.length, cc: ccList.length });
    return true;
  } catch (error) {
    logError("mail", error, { kind, to: toList.length, cc: ccList.length });
    return false;
  }
};

/** Adres publiczny aplikacji do linków w treści — jak w services/notifyGChat.js. */
export const appUrl = (path = "") => {
  const base = process.env.NEXTAUTH_URL;
  if (!base) return null;
  return `${base.replace(/\/$/, "")}${path}`;
};

export default sendMail;
