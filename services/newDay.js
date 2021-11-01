import airDB from "../services/airtableClient";
import moment from "moment";

const newDay = async (section) => {
  moment.locale("pl");
  const getUsers = async (section) => {
    const users = await airDB("Users")
      .select({ filterByFormula: `AND(Section="${section}", IsActive="Active")` })
      .firstPage();

    return users.map((user) => {
      user.fields.password = ";)";
      user.fields.saltPassword = ";)";
      return user.fields;
    });
  };

  //zmienić na zmienną section
  const users = await getUsers("biedronka");

  users.forEach(async (user) => {
    moment.locale("pl");
    const now = moment().hours(0).minutes(0).seconds(0).milliseconds(0).format();
    const addHours = moment(now).hours(3).format();
    const pyload = {
      userID: user.ID,
      name: user.name,
      surname: user.surname,
      section: user.section,
      location: user.location,
      data: addHours,
      startTime: addHours,
      endTime: addHours,
      differenceTime: moment(now).hours(8).format(),
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
