import dayjs from "dayjs";
import "dayjs/locale/pl";
const AdvancedFormat = require("dayjs/plugin/advancedFormat");
const isSameOrBefore = require("dayjs/plugin/isSameOrBefore");
const duration = require("dayjs/plugin/duration");
dayjs.extend(AdvancedFormat);
dayjs.extend(isSameOrBefore);
dayjs.extend(duration);
dayjs.locale("pl");

export const Timer = (stop) => {
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

export const DifferenceTime = (start, stop) => {
  const workTime = dayjs(stop).diff(dayjs(start), "hours");
  const tmp = dayjs.duration(dayjs(stop).diff(dayjs(start)));
  if (workTime < 8) {
    return {
      overtime: false,
      time: tmp.format(`HH:mm:ss`),
    };
  } else {
    return {
      overtime: true,
      time: tmp.format(`HH:mm:ss`),
    };
  }
};

export const jsonFetcher = (url) => fetch(url).then((res) => res.json());
