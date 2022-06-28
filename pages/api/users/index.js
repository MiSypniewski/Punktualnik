import createUser from "../../../services/createUser";
import { getSession } from "next-auth/react";
// import authorizeUser from "../../../services/authorize";

export default async (req, res) => {
  switch (req.method) {
    case "POST": {
      try {
        // console.log(req);
        const session = await getSession({ req });
        if (!session) {
          return res.status(401).json({ error: "not_authotized" });
        }

        const payload = req.body;
        const user = await createUser(payload);
        res.status(200).json({ status: "created", user });
      } catch (error) {
        res.status(422).json({ status: "not_created", error: error.message });
      }
      break;
    }
    default: {
      res.status(400);
    }
  }
};
