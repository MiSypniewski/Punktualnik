import getSectionTime from "../../../services/getSectionTime";
import moment from "moment";

export default async (req, res) => {
  switch (req.method) {
    case "GET": {
      // req.query.id;
      // req.query.section;
      const now = moment().hours(0).minutes(0).seconds(0).milliseconds(0).format();
      const data = moment(now).hours(3).format();
      const time = await getSectionTime(req.query.id, data);
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
