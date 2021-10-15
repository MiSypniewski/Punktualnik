import getRecentTimes from "../../services/getTime";
import saveTimes from "../../services/saveTime";
import moment from "moment";

export default async (req, res) => {
  switch (req.method) {
    case "GET": {
      const offers = await getRecentTimes(moment().format("DD-MM-YYYY"));
      res.status(200).json(offers);

      break;
    }
    case "POST": {
      const payload = req.body;
      console.log("payload on backend", payload);
      const offer = await saveTimes(payload);
      res.status(200).json({ status: "created", offer });

      break;
    }
    default:
      res.status(400);
  }
};
