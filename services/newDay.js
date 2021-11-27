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

    for (let i = 0; i <= 60; i++) {
      const newDay = moment(addHours).add(i, "days").format();
      console.log(moment(newDay).format());

      const pyload = {
        userID: user.ID,
        name: user.name,
        surname: user.surname,
        section: user.section,
        location: user.location,
        data: newDay,
        startTime: newDay,
        endTime: newDay,
        differenceTime: moment(newDay).hours(8).minutes(0).seconds(0).milliseconds(0).format(),
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
    }
  });
};

export default newDay;
