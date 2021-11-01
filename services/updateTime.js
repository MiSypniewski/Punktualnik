import airDB from "./airtableClient";

const updateTime = async (airtableID, pyload) => {
  const time = await airDB("Times").update([
    {
      id: airtableID,
      fields: {
        ...pyload,
      },
    },
  ]);

  return time;
};

export default updateTime;
