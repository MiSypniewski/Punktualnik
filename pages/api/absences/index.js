import { getToken } from "next-auth/jwt";
import dayjs from "dayjs";
import createAbsence from "../../../services/createAbsence";
import { getAbsences } from "../../../services/getAbsences";
import getAbsencesForUser from "../../../services/getAbsencesForUser";
import { getLeaveBalance } from "../../../services/leaveBalance";
import { ABSENCE_KIND_KEYS, ABSENCE_STATUS_KEYS, isSelfService } from "../../../services/absenceKinds";
import { canApproveLeave } from "../../../services/roles";
import { visibleSections, canSeeUser } from "../../../services/scope";
import getUserData from "../../../services/getUserData";
import { notifyNewAbsenceRequest } from "../../../services/notifyGChat";
import { logApiError } from "../../../services/log";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// eslint-disable-next-line import/no-anonymous-default-export
export default async (req, res) => {
  const token = await getToken({ req });
  if (!token) {
    return res.status(401).json({ error: "not_authorized" });
  }

  if (req.method === "GET") {
    const { userID, status, kind, year, from, to } = req.query;

    // Rozgałęzienie po OBECNOŚCI filtrów, nie po roli — jak w /api/overtime.
    // Gołe wywołanie znaczy "pokaż moje", każdy filtr znaczy "pokaż cudze"
    // i dopiero to wymaga uprawnień.
    const wantsOthers = [userID, status, kind, year, from, to].some(
      (v) => v !== undefined && v !== ""
    );

    if (!wantsOthers) {
      const rok = dayjs().year();
      return res.status(200).json({
        balance: getLeaveBalance(token.userID, rok),
        absences: getAbsencesForUser(token.userID),
      });
    }

    if (!canApproveLeave(token.role)) {
      return res.status(403).json({ error: "permission_denied" });
    }
    if (status && !ABSENCE_STATUS_KEYS.includes(status)) {
      return res.status(400).json({ error: "bad_status" });
    }
    if (kind && !ABSENCE_KIND_KEYS.includes(kind)) {
      return res.status(400).json({ error: "bad_kind" });
    }
    if (userID && !/^\d+$/.test(userID)) {
      return res.status(400).json({ error: "bad_user" });
    }
    if (year && !/^\d{4}$/.test(year)) {
      return res.status(400).json({ error: "bad_year" });
    }
    for (const d of [from, to]) {
      if (d && !DATE.test(d)) {
        return res.status(400).json({ error: "bad_date", message: "daty w formacie RRRR-MM-DD" });
      }
    }

    // Kierownik widzi wyłącznie przypisane mu sekcje — nawet gdy jawnie poda
    // userID kogoś spoza swojego zasięgu.
    return res.status(200).json({
      absences: getAbsences({ userID, status, kind, year, from, to, sections: visibleSections(token) }),
    });
  }

  if (req.method === "POST") {
    const { kind, dateFrom, dateTo, reason, userID } = req.body ?? {};

    // Wpis ZA KOGOŚ to uprawnienie kierownika. Brak userID w body znaczy
    // "dla siebie" — i wtedy id bierzemy z tokenu, nigdy z żądania.
    const forSomeoneElse = userID !== undefined && String(userID) !== String(token.userID);

    if (forSomeoneElse) {
      if (!canApproveLeave(token.role)) {
        return res.status(403).json({ error: "permission_denied" });
      }
      if (!/^\d+$/.test(String(userID))) {
        return res.status(400).json({ error: "bad_user" });
      }
      const [target] = await getUserData(userID);
      if (!target) {
        return res.status(404).json({ error: "user_not_found" });
      }
      if (!canSeeUser(token, target)) {
        return res.status(403).json({ error: "permission_denied" });
      }
    } else if (!isSelfService(kind)) {
      // L4 i urlop na żądanie wpisuje kierownik — pierwszy po otrzymaniu
      // zwolnienia, drugi po telefonie. Pracownik nie zgłasza ich sam.
      return res.status(403).json({
        error: "kind_not_self_service",
        message: "Ten rodzaj nieobecności wpisuje kierownik — zgłoś się do niego.",
      });
    }

    try {
      const [author] = await getUserData(token.userID);
      const authorName = author ? `${author.name} ${author.surname}` : token.name;

      const absence = await createAbsence({
        userID: forSomeoneElse ? Number(userID) : token.userID,
        kind,
        dateFrom,
        dateTo,
        reason,
        createdBy: token.userID,
        createdByName: authorName,
        // Wpis kierownika jest zatwierdzony w chwili powstania — zakłada go
        // osoba, która i tak by go akceptowała.
        autoApprove: forSomeoneElse,
      });

      // Powiadomienie tylko dla wniosków pracownika: adresatem jest kierownik,
      // a on właśnie sam ten wpis założył. Bez await — proces żyje dalej
      // (next start), więc żądanie dokończy się w tle.
      if (!forSomeoneElse) {
        const [me] = await getUserData(token.userID);
        notifyNewAbsenceRequest(absence, me).catch(() => {});
      }

      return res.status(201).json({ status: "created", absence });
    } catch (error) {
      logApiError("api/absences", error, 422, { userID: token.userID });
      return res.status(422).json({
        status: "not_created",
        error: error.code ?? "invalid",
        message: error.message,
      });
    }
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "method_not_allowed" });
};
