import dayjs from "dayjs";
import "dayjs/locale/pl";
import "dayjs/plugin/advancedFormat";
import "dayjs/plugin/isSameOrBefore";
import "dayjs/plugin/duration";
dayjs.extend(AdvancedFormat); // use plugin
dayjs.extend(isSameOrBefore);
dayjs.extend(duration);
dayjs.locale("pl");

const Timer = ({ stop }) => {
  if (dayjs().isSameOrBefore(stop, "seconds")) {
    const tmp = dayjs.duration(dayjs(stop).diff(dayjs()));
    return {
      overtime: false,
      time: tmp.format(`HH:mm:ss`),
    };
  } else {
    const tmp = dayjs.duration(dayjs(dayjs()).diff(stop));
    return {
      overtime: true,
      time: tmp.format(`HH:mm:ss`),
    };
  }
};

export default Timer;
