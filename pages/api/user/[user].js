import getRecentTimes from "../../../services/getTime";
import saveTimes from "../../../services/saveTime";

export default async (req, res) => {
  switch (req.method) {
    case "GET": {
      console.log(`req data: ${req.query.user}`);
      const offers = await getRecentTimes("Kamil Milczarek", "15-10-2021");
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
