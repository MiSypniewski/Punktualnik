import moment from "moment";

export const jsonFetcher = (url) => fetch(url).then((res) => res.json());

export const getCurrentTime = () => {
  moment.locale("pl");
  return moment().format("HH:mm:ss");
};
