import { getToken } from "next-auth/jwt";
import { getCard, correctCard, deleteCard, STATUS_FOR } from "../../../../services/manageTime";
import { canEditTimes } from "../../../../services/roles";
import { canSeeSection } from "../../../../services/scope";
import { notifyCardChanged } from "../../../../services/notifyMail";
import { logApiError } from "../../../../services/log";

// Korekta (PUT) i usunięcie (DELETE) pojedynczej karty czasu. `id` to Times.id.
//
// Kolejność sprawdzeń jak w pages/api/absences/[id].js: token → rola → wiersz
// istnieje → zasięg → operacja. Sama rola nie wystarcza nigdy; bez sprawdzenia
// zasięgu wystarczyłoby zgadnąć id, żeby przepisać dniówkę w cudzym dziale.

// eslint-disable-next-line import/no-anonymous-default-export
export default async (req, res) => {
  const token = await getToken({ req });
  if (!token) {
    return res.status(401).json({ error: "not_authorized" });
  }
  if (!canEditTimes(token.role)) {
    return res.status(403).json({ error: "permission_denied" });
  }

  const { id } = req.query;
  if (!/^\d+$/.test(id ?? "")) {
    return res.status(400).json({ error: "bad_id" });
  }

  const card = getCard(id);
  if (!card) {
    return res.status(404).json({ error: "not_found" });
  }

  // Zasięg po Times.section, czyli po sekcji Z DNIA ZAPISU — a nie po dzisiejszej
  // sekcji pracownika. To ta sama reguła, po której panel składa listę
  // (services/getSectionTimes.js) i po której filtruje eksport. Gdyby te dwie
  // rzeczy się rozjechały, kierownik widziałby w tabeli wiersze, których nie da
  // się zapisać — i nie miałby jak zgadnąć dlaczego.
  if (!canSeeSection(token, card.section)) {
    return res.status(403).json({ error: "permission_denied" });
  }

  const actor = { userID: token.userID, name: token.name };

  if (req.method === "DELETE") {
    const removed = deleteCard({ id, card, actor, reason: req.body?.reason });

    // Wiadomość niesie dane wiersza SPRZED skasowania — po DELETE nie ma już
    // czego odczytać, a pracownik ma prawo wiedzieć, jaka dniówka zniknęła.
    if (removed) {
      notifyCardChanged(card, "deleted", actor).catch(() => {});
    }

    return removed
      ? res.status(200).json({ status: "deleted" })
      : res.status(404).json({ error: "not_found" });
  }

  if (req.method !== "PUT") {
    res.setHeader("Allow", "PUT, DELETE");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  try {
    const updated = correctCard({ id, start: req.body?.start, end: req.body?.end, actor });

    // `card` to stan sprzed korekty — odczytany wyżej, na potrzeby kontroli
    // zasięgu. Idzie do wiadomości jako "było", żeby dało się sprawdzić, czy
    // zmiana jest tą, o którą pracownik prosił.
    notifyCardChanged(updated, "corrected", actor, card).catch(() => {});

    return res.status(200).json({ status: "updated", card: updated });
  } catch (error) {
    const status = STATUS_FOR[error.code] ?? 422;
    logApiError("api/time/manage/[id]", error, status, { cardID: Number(id), by: token.userID });
    return res.status(status).json({ error: error.code || "invalid", message: error.message });
  }
};
