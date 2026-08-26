import { getToken } from "next-auth/jwt";
import createOvertimeRequest from "../../../services/createOvertimeRequest";
import getOvertimeBalance from "../../../services/getOvertimeBalance";
import getOvertimeForUser from "../../../services/getOvertimeForUser";
import getOvertimeRequests from "../../../services/getOvertimeRequests";
import { canApproveOvertime } from "../../../services/roles";
import { STATUS_KEYS } from "../../../services/overtimeKinds";
import getUserData from "../../../services/getUserData";
import { notifyNewOvertimeRequest } from "../../../services/notifyGChat";
import { notifyOvertimePending } from "../../../services/notifyMail";
import { visibleSections } from "../../../services/scope";
import { logApiError } from "../../../services/log";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// eslint-disable-next-line import/no-anonymous-default-export
export default async (req, res) => {
  const token = await getToken({ req });
  if (!token) {
    return res.status(401).json({ error: "not_authorized" });
  }

  if (req.method === "GET") {
    const { userID, status, from, to } = req.query;
    const wantsOthers = [userID, status, from, to].some((v) => v !== undefined && v !== "");

    // Bez parametrów każdy widzi swoje. Jakikolwiek filtr = widok zbiorczy,
    // a ten jest wyłącznie dla kierownika. Świadomie inaczej niż w
    // /api/time/[id], gdzie GET nie sprawdza w ogóle własności danych.
    if (!wantsOthers) {
      return res.status(200).json({
        balance: getOvertimeBalance(token.userID),
        requests: getOvertimeForUser(token.userID),
      });
    }

    if (!canApproveOvertime(token.role)) {
      return res.status(403).json({ error: "permission_denied" });
    }
    if (status !== undefined && status !== "" && !STATUS_KEYS.includes(status)) {
      return res.status(400).json({ error: "bad_status" });
    }
    if (userID !== undefined && userID !== "" && !/^\d+$/.test(userID)) {
      return res.status(400).json({ error: "bad_user" });
    }
    for (const d of [from, to]) {
      if (d !== undefined && d !== "" && !DATE_RE.test(d)) {
        return res.status(400).json({ error: "bad_date", message: "from/to muszą być w formacie YYYY-MM-DD" });
      }
    }

    // Kierownik widzi wyłącznie sekcje mu przypisane — nawet gdy jawnie poda
    // userID kogoś spoza swojego zasięgu.
    return res.status(200).json({
      requests: getOvertimeRequests({ userID, status, from, to, sections: visibleSections(token) }),
    });
  }

  if (req.method === "POST") {
    const { kind, data, hours, minutes, reason } = req.body ?? {};

    // Formularz przysyła godziny i minuty osobno — w bazie trzymamy jedną liczbę.
    const total = Number(hours || 0) * 60 + Number(minutes || 0);
    if (!Number.isInteger(total) || total <= 0) {
      return res.status(422).json({ status: "not_created", error: "wymiar musi być większy niż zero" });
    }

    try {
      // userID WYŁĄCZNIE z tokenu — gdyby brać je z body, każdy mógłby złożyć
      // wniosek w cudzym imieniu.
      const request = await createOvertimeRequest({
        userID: token.userID,
        kind,
        data,
        minutes: total,
        reason,
      });

      // Powiadomienie na Google Chat bez await — aplikacja chodzi jako stały
      // proces (next start), więc żądanie dokończy się w tle, a pracownik nie
      // czeka na Google. Serwis sam łapie swoje błędy, .catch jest na wypadek
      // wyjątku poza nim, żeby nie zrobić nieobsłużonego odrzucenia.
      const [author] = await getUserData(token.userID);
      notifyNewOvertimeRequest(request, author).catch(() => {});
      // Ten sam sygnał drugim kanałem: czat trzeba mieć otwarty, mail czeka
      // w skrzynce. Oba wyłącza się niezależnie (services/notifyMail.js).
      notifyOvertimePending(request, author).catch(() => {});

      return res.status(201).json({ status: "created", request });
    } catch (error) {
      logApiError("api/overtime", error, 422, { userID: token.userID });
      return res.status(422).json({ status: "not_created", error: error.message });
    }
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "method_not_allowed" });
};
