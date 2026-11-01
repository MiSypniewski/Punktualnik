import { apiRoute } from "../../../services/apiAuth";

export const config = { api: { bodyParser: { sizeLimit: "16kb" } } };

// Sprawdzenie klucza: kim jestem i co ten klucz może. Działa z każdym uprawnieniem.
export default apiRoute("api/v1/me", {
  GET: {
    scope: null,
    handle: (req, res, { token, key }) =>
      res.status(200).json({
        user: { id: token.userID, name: token.name, section: token.section },
        key: { id: key.id, name: key.name, scopes: key.scopes, expiresAt: key.expiresAt },
      }),
  },
});
