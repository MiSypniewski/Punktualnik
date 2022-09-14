import getTime from "../../../services/getTime";
import saveTimes from "../../../services/saveTime";
import updateTime from "../../../services/updateTime";
import { getSession } from "next-auth/react";
import dayjs from "dayjs";
dayjs.locale("pl");

export default async (req, res) => {
  switch (req.method) {
    case "GET": {
      //tutaj zmienić datę na zmienną
      // const pyload = req.body;
      // console.log(`GET on backend. `);
      const session = await getSession({ req });
      if (!session) {
        return res.status(401).json({ error: "not_authotized" });
      }
      const time = await getTime(req.query.id);
      res.status(200).json(time);

      break;
    }
    case "POST": {
      const session = await getSession({ req });
      if (!session) {
        return res.status(401).json({ error: "not_authotized" });
      }
      if (session.user.role !== "editor") {
        return res.status(401).json({ error: "permission_denied" });
      }
      const payload = req.body;
      // console.log("POST payload on backend", payload);
      const time = await saveTimes(payload);
      res.status(200).json({ status: "created", time });

      break;
    }
    case "PUT": {
      const session = await getSession({ req });
      if (!session) {
        return res.status(401).json({ error: "not_authotized" });
      }
      if (session.user.role !== "editor") {
        return res.status(401).json({ error: "permission_denied" });
      }
      const payload = req.body;
      // console.log("PUT payload on backend", payload);
      const time = await updateTime(req.query.id, payload);
      res.status(200).json({ status: "update", time });

      break;
    }
    default:
      res.status(400);
  }
};
