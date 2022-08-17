import airDB from "../services/airtableClient";
import getUsers from "./getUsers";
import dayjs from "dayjs";
import "dayjs/locale/pl";
dayjs.locale("pl");

const newDay = async (section) => {
  // const getUsers = async (section) => {
  //   const users = await airDB("Users")
  //     // w nowej wersji ma być "1 - true" ("" oznacza false) oraz passwordHash i passwordSalt
  //     .select({ filterByFormula: `AND(Section="${section}", role="user", IsActive="1")` })
  //     // .select({ filterByFormula: `AND(Section="${section}", IsActive="Active")` })
  //     .firstPage();

  //   return users.map((user) => {
  //     user.fields.passwordHash = ";)";
  //     user.fields.passwordSalt = ";)";
  //     user.email = ";)";
  //     // user.fields.password = ";)";
  //     // user.fields.saltPassword = ";)";
  //     return user.fields;
  //   });
  // };

  //zmienić na zmienną section
  const users = await getUsers("biedronka");
  // console.log(`użytkowicy: `);
  // console.log(users);

  users.forEach(async (user) => {
    // moment.locale("pl");
    // const now = moment().hours(0).minutes(0).seconds(0).milliseconds(0).format();
    // const addHours = moment(now).hours(3).format();
    // console.log(`dodaję: ${user}`);

    const toDay = dayjs().hour(3).minute(0).second(0).millisecond(0).format();
    //tutaj zmiemiamy na dayjs

    const pyload = {
      userID: user.ID,
      name: user.name,
      surname: user.surname,
      section: user.section,
      location: user.location,
      data: toDay,
      startTime: toDay,
      endTime: toDay,
      // differenceTime: moment(newDay).hours(8).minutes(0).seconds(0).milliseconds(0).format(),
      totalWorkTime: `00:00:00`,
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

    // for (let i = 0; i <= 30; i++) {
    //   // 1 = zacznij od "jutro"
    //   //przetestować na jakiś jednym dniu "IsActive" z góry ^^^^^^^
    //   // const newDay = moment(addHours).add(i, "days").format();
    //   const newDay = dayjs(toDay).add(i, "days").format();
    //   console.log(newDay);

    //   const pyload = {
    //     userID: user.ID,
    //     name: user.name,
    //     surname: user.surname,
    //     section: user.section,
    //     location: user.location,
    //     data: newDay,
    //     startTime: newDay,
    //     endTime: newDay,
    //     differenceTime: moment(newDay).hours(8).minutes(0).seconds(0).milliseconds(0).format(),
    //     status: "wait",
    //     overTime: false,
    //   };
    //   await airDB("Times").create([
    //     {
    //       fields: {
    //         ...pyload,
    //       },
    //     },
    //   ]);
    // }
  });
};

export default newDay;
