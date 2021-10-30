import getSectionTime from "../../../services/getSectionTime";
import saveTimes from "../../../services/saveTime";
import moment from "moment";

export default async (req, res) => {
  switch (req.method) {
    case "GET": {
      // req.query.id;
      // req.query.section;
      const time = await getSectionTime(req.query.id, moment().format("DD-MM-YYYY"));
      res.status(200).json(time);

      break;
    }
    // case "POST": {
    //   const payload = req.body;
    //   console.log("payload on backend", payload);
    //   const time = await saveTimes(payload);
    //   res.status(200).json({ status: "created", time });

    //   break;
    // }
    default:
      res.status(400);
  }
};
