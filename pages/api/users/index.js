import createUser from "../../../services/createUser";
// import authorizeUser from "../../../services/authorize";

export default async (req, res) => {
  switch (req.method) {
    case "POST": {
      try {
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
