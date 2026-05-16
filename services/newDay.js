import getUsers from "./getUsers";
import saveTime from "./saveTime";
import dayjs from "dayjs";
import "dayjs/locale/pl";
dayjs.locale("pl");

const newDay = async (section) => {
  const users = await getUsers(section);

  const toDay = dayjs().hour(3).minute(0).second(0).millisecond(0).format();

  for (const user of users) {
    const pyload = {
      userID: user.ID,
      name: user.name,
      surname: user.surname,
      section: user.section,
      location: user.location,
      data: toDay,
      startTime: toDay,
      endTime: toDay,
      totalWorkTime: `00:00:00`,
      status: "wait",
      overTime: false,
    };

    await saveTime(pyload);
  }
};

export default newDay;
