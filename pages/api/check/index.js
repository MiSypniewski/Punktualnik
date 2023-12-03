// import getTime from "../../../services/getTime";
// import saveTimes from "../../../services/saveTime";
// import updateTime from "../../../services/updateTime";
// import { getSession } from "next-auth/react";
import { getToken } from "next-auth/jwt";
import dayjs from "dayjs";
dayjs.locale("pl");

// eslint-disable-next-line import/no-anonymous-default-export
export default async (req, res) => {
  // const session = await getSession({ req });
  // console.log(`req :`, req);
  // console.log(`res :`, res);
  const token = await getToken({ req });
  if (!token) {
    return res.status(401).json({ error: "not_authotized" });
  }

  // console.log(`token: `, token);
  switch (req.method) {
    case "GET": {
      //tutaj zmienić datę na zmienną
      // const pyload = req.body;
      // console.log(`GET on backend. `);
      // console.log(`funkcja GET wywołana!`)
      //   const time = await getTime(req.query.id);
      res.status(200).json({ message: "GET wywołana!", ...token });

      break;
    }
    case "POST": {
      // const session = await getSession({ req });
      // if (!session) {
      //   return res.status(401).json({ error: "not_authotized" });
      // }
      // if (session.user.role !== "editor") {
      //   return res.status(401).json({ error: "permission_denied" });
      // }
      const payload = req.body;
      // console.log("POST payload on backend", payload);
      //   const time = await saveTimes(payload);
      res.status(200).json({ message: "POST wywołana!", ...token });
      //   res.status(200).json({ status: "created", time });

      break;
    }
    case "PUT": {
      // const session = await getSession({ req });
      // if (!session) {
      //   return res.status(401).json({ error: "not_authotized" });
      // }
      // if (session.user.role !== "editor") {
      //   return res.status(401).json({ error: "permission_denied" });
      // }
      const payload = req.body;
      // console.log("PUT payload on backend", payload);
      //   const time = await updateTime(req.query.id, payload);
      res.status(200).json({ message: "UPDATE wywołana!", ...token });
      //   res.status(200).json({ status: "update", time });

      break;
    }
    default:
      res.status(400);
  }
};
