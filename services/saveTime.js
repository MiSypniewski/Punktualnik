import airDB from "./airtableClient";

const saveTime = async (pyload) => {
  const time = await airDB("Times").create([
    {
      fields: {
        ...pyload,
      },
    },
  ]);

  return time;
};

export default saveTime;
