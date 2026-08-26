import { getToken } from "next-auth/jwt";
import addLeaveAllowance from "../../../services/addLeaveAllowance";
import { canApproveLeave } from "../../../services/roles";
import { canSeeUser } from "../../../services/scope";
import getUserData from "../../../services/getUserData";
import { notifyAllowanceAdded } from "../../../services/notifyMail";
import { logApiError } from "../../../services/log";

// Przydzielanie dni urlopu. Wyłącznie kierownik i wyłącznie własnym
// pracownikom — nikt nie dopisuje dni sam sobie.

// eslint-disable-next-line import/no-anonymous-default-export
export default async (req, res) => {
  const token = await getToken({ req });
  if (!token) {
    return res.status(401).json({ error: "not_authorized" });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  if (!canApproveLeave(token.role)) {
    return res.status(403).json({ error: "permission_denied" });
  }

  const { userID, year, days, note } = req.body ?? {};

  if (!/^\d+$/.test(String(userID ?? ""))) {
    return res.status(400).json({ error: "bad_user" });
  }

  // Dwuwarstwowo, jak przy decyzji: rola wpuszcza na endpoint, zasięg sekcyjny
  // rozstrzyga o konkretnym pracowniku.
  const [target] = await getUserData(userID);
  if (!target) {
    return res.status(404).json({ error: "user_not_found" });
  }
  if (!canSeeUser(token, target)) {
    return res.status(403).json({ error: "permission_denied" });
  }

  try {
    const [me] = await getUserData(token.userID);
    const allowance = await addLeaveAllowance({
      userID: Number(userID),
      year: Number(year),
      days: Number(days),
      note,
      createdBy: token.userID,
      createdByName: me ? `${me.name} ${me.surname}` : token.name,
    });

    // Pula to liczba, na którą pracownik patrzy raz w roku i której sam nie
    // ustawia — o jej zmianie musi się dowiedzieć w chwili, gdy zachodzi.
    notifyAllowanceAdded(allowance, target, { userID: token.userID, name: token.name }).catch(() => {});

    return res.status(201).json({ status: "created", allowance });
  } catch (error) {
    logApiError("api/absences/allowance", error, 422, { userID: token.userID });
    return res.status(422).json({ status: "not_created", error: "invalid", message: error.message });
  }
};
