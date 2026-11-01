import { getActiveToken } from "../../../services/session";
import { canTrackTasks } from "../../../services/roles";
import { revokeApiKey } from "../../../services/apiKeys";
import { logInfo } from "../../../services/log";

// Odwołanie własnego klucza. Hasło nie jest tu potrzebne: odcięcie dostępu ma być
// najłatwiejszą operacją w tym module. Cudzy klucz i klucz już odwołany dają 404.

// eslint-disable-next-line import/no-anonymous-default-export
export default async (req, res) => {
  const token = await getActiveToken(req);
  if (!token) {
    return res.status(401).json({ error: "not_authorized" });
  }
  if (!canTrackTasks(token.role)) {
    return res.status(403).json({ error: "permission_denied" });
  }
  if (req.method !== "DELETE") {
    res.setHeader("Allow", "DELETE");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const { id } = req.query;
  if (!/^\d+$/.test(id || "")) {
    return res.status(400).json({ error: "bad_id" });
  }

  if (!revokeApiKey({ id, userID: token.userID })) {
    return res.status(404).json({ error: "not_found" });
  }

  logInfo("api/keys", "[audit] odwołano klucz", { keyID: Number(id), userID: token.userID });
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({ status: "revoked" });
};
