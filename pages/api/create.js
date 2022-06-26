import newDay from "../../services/newDay";

export default async (req, res) => {
  // switch (req.method) {
  //   case "GET": {
  //     console.log(`metoda GET`);
  //     const newDays = await newDay();
  //     res.status(200).json(newDays);
  //     break;
  //   }
  //   case "POST": {
  //     const payload = req.body;
  //     if (payload.text === "punktuanalnik") {
  //       console.log("payload on backend", payload);
  //       const offer = await newDay();
  //       res.status(200).json({ status: "created", offer });
  //     } else {
  //       res.status(200).json({ status: "error" });
  //     }
  //     break;
  //   }
  //   default:
  //     res.status(400);
  // }
};
