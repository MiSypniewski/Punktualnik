import dayjs from "dayjs";
import { kindLabel, signedMinutes } from "./overtimeKinds";
import { formatMinutes } from "../utils";

// Powiadomienia na Google Chat przez webhook przestrzeni.
//
// URL webhooka zawiera key i token, więc jest sekretem — siedzi w .env.local
// (poza repozytorium). Brak zmiennej = powiadomienia po prostu wyłączone;
// aplikacja ma działać tak samo na maszynie bez skonfigurowanego czatu.
const WEBHOOK_URL = process.env.GCHAT_WEBHOOK_URL;

// Czat nie może blokować odpowiedzi dla użytkownika — po tym czasie odpuszczamy.
const TIMEOUT_MS = 5000;

const sendMessage = async (text) => {
  if (!WEBHOOK_URL) return;

  // AbortController zamiast czekania w nieskończoność, gdyby Google nie odpowiadał.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({ text }),
      signal: controller.signal,
    });

    if (!res.ok) {
      // Logujemy treść odpowiedzi, ale nie sam URL — ten jest sekretem.
      const body = await res.text().catch(() => "");
      console.error(`[gchat] webhook zwrócił ${res.status}: ${body.slice(0, 300)}`);
    }
  } catch (error) {
    console.error(`[gchat] nie udało się wysłać powiadomienia: ${error.message}`);
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Powiadomienie o nowym wniosku o nadgodziny.
 * Nigdy nie rzuca — złożenie wniosku nie może się wywrócić przez problem z czatem.
 *
 * @param {object} request wiersz z tabeli Overtime
 * @param {{name: string, surname: string, section: string}} user autor wniosku
 */
export const notifyNewOvertimeRequest = async (request, user) => {
  const who = user ? `${user.name} ${user.surname}` : `użytkownik #${request.userID}`;
  const sekcja = user?.section ? ` (${user.section})` : "";

  // Prosty tekst, nie karta — czytelny też w powiadomieniu na telefonie.
  // *gwiazdki* to pogrubienie w składni Google Chat.
  const lines = [
    `*Nowy wniosek o nadgodziny*`,
    `${who}${sekcja}`,
    `${kindLabel(request.kind)}: *${formatMinutes(signedMinutes(request), { withSign: true })}*`,
    `Data: ${dayjs(request.data).format("DD.MM.YYYY")}`,
  ];

  if (request.reason) lines.push(`Powód: ${request.reason}`);

  const panel = process.env.NEXTAUTH_URL
    ? `${process.env.NEXTAUTH_URL.replace(/\/$/, "")}/nadgodziny/zarzadzaj`
    : null;
  if (panel) lines.push(panel);

  await sendMessage(lines.join("\n"));
};

export default sendMessage;
