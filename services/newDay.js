import airDB from "../services/airtableClient";
import moment from "moment";

const newDay = async (section) => {
  const getUsers = async (section) => {
    const users = await airDB("Users")
      // .select({ filterByFormula: `AND(User="${user}", Data="${data}")` })
      .select({ filterByFormula: `AND(Section="${section}", IsActive="Active")` })
      .firstPage();

    return users.map((user) => {
      user.fields.password = ";)";
      user.fields.saltPassword = ";)";
      return user.fields;
    });
  };

  const users = await getUsers("biedronka");

  users.forEach(async (user) => {
    const pyload = {
      userID: user.ID,
      name: user.name,
      surname: user.surname,
      section: user.section,
      location: user.location,
      data: moment().format("DD-MM-YYYY"),
      startTime: moment({ h: 0, m: 0, s: 0, ms: 0 }).format("HH:mm:ss"),
      endTime: moment({ h: 0, m: 0, s: 0, ms: 0 }).format("HH:mm:ss"),
      differenceTime: moment({ h: 0, m: 0, s: 0, ms: 0 }).format("HH:mm:ss"),
      status: "wait",
      overTime: false,
    };
    await airDB("Times").create([
      {
        fields: {
          ...pyload,
        },
      },
    ]);
  });
};

export default newDay;
