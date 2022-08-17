import getTime from "../../../services/getTime";
import saveTimes from "../../../services/saveTime";
import updateTime from "../../../services/updateTime";
import dayjs from "dayjs";
dayjs.locale("pl");

export default async (req, res) => {
  switch (req.method) {
    case "GET": {
      //tutaj zmienić datę na zmienną
      const times = await getTime(dayjs().format("DD-MM-YYYY"));
      res.status(200).json(times);

      break;
    }
    case "POST": {
      const payload = req.body;
      console.log("payload on backend", payload);
      const time = await saveTimes(payload);
      res.status(200).json({ status: "created", time });

      break;
    }
    case "PUT": {
      const payload = req.body;
      // console.log("payload on backend", payload);
      const time = await updateTime(req.query.id, payload);
      res.status(200).json({ status: "update", time });

      break;
    }
    default:
      res.status(400);
  }
};
