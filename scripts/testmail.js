#!/usr/bin/env node
// Sprawdzenie samego SMTP-a, w oderwaniu od aplikacji.
//
//   node scripts/testmail.js adres@example.pl
//
// Powstał po to, żeby dało się rozdzielić dwa zupełnie różne powody, dla których
// powiadomienie nie dochodzi: złe hasło / port / host (widać tutaj) od błędu
// w logice wysyłki (widać dopiero w aplikacji). Bez tego rozdzielenia diagnoza
// sprowadza się do zgadywania.
//
// CommonJS jak scripts/admin.js — skrypt bywa uruchamiany bez builda Next.

const fs = require("fs");
const path = require("path");
const nodemailer = require("nodemailer");

// .env.local wczytujemy sami: Next robi to tylko dla własnego procesu, a ten
// skrypt chodzi obok. Parser jest celowo prymitywny (KLUCZ=wartość, # to
// komentarz) — do trzech zmiennych nie potrzeba biblioteki.
const loadEnv = (file) => {
  const full = path.join(__dirname, "..", file);
  if (!fs.existsSync(full)) return;

  for (const line of fs.readFileSync(full, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;

    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!(key in process.env)) process.env[key] = value;
  }
};

loadEnv(".env.local");
loadEnv(".env");

const LOGIN = process.env.EMAIL_LOGIN || process.env.email_login || "";
const PASSWORD = process.env.EMAIL_PASSWORD || process.env.email_password || "";
const HOST = process.env.SMTP_HOST || "ssl0.ovh.net";
const PORT = Number(process.env.SMTP_PORT || 465);
const FROM = process.env.EMAIL_FROM || `Punktualnik <${LOGIN}>`;

const to = process.argv[2];

if (!to) {
  console.error("Podaj adres odbiorcy:  node scripts/testmail.js adres@example.pl");
  process.exit(1);
}
if (!LOGIN || !PASSWORD) {
  console.error("Brak email_login lub email_password w .env.local — wysyłka jest wyłączona.");
  process.exit(1);
}

const main = async () => {
  console.log(`Host:    ${HOST}:${PORT} (secure=${PORT === 465})`);
  console.log(`Login:   ${LOGIN}`);
  console.log(`Nadawca: ${FROM}`);
  console.log(`Odbiorca:${to}\n`);

  const transport = nodemailer.createTransport({
    host: HOST,
    port: PORT,
    secure: PORT === 465,
    auth: { user: LOGIN, pass: PASSWORD },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
  });

  // verify() sprawdza połączenie i logowanie BEZ wysyłania czegokolwiek —
  // rozdziela "nie mogę się zalogować" od "zalogowałem się, ale serwer odrzucił
  // wiadomość", a to dwie różne naprawy.
  console.log("Sprawdzam połączenie i logowanie…");
  await transport.verify();
  console.log("OK — serwer przyjął dane logowania.\n");

  const info = await transport.sendMail({
    from: FROM,
    to,
    subject: "Punktualnik: test poczty wychodzącej",
    text:
      "To jest wiadomość testowa z Punktualnika.\n\n" +
      "Jeśli ją widzisz, transport SMTP działa. Sprawdź jeszcze nagłówek " +
      "Authentication-Results w źródle wiadomości — powie, czy SPF i DKIM przechodzą.\n",
  });

  console.log("Wysłano.");
  console.log(`  messageId: ${info.messageId}`);
  console.log(`  przyjęte:  ${info.accepted.join(", ") || "(brak)"}`);
  console.log(`  odrzucone: ${info.rejected.join(", ") || "(brak)"}`);
  console.log(`  odpowiedź: ${info.response}`);

  transport.close();
};

main().catch((error) => {
  console.error("\nNIE UDAŁO SIĘ.");
  console.error(`  ${error.message}`);
  if (error.code) console.error(`  kod: ${error.code}`);
  if (error.responseCode) console.error(`  kod SMTP: ${error.responseCode}`);
  process.exit(1);
});
