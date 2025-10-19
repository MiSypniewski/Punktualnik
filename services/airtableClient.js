// import Airtable from "airtable";

// Airtable.configure({
//   endpointUrl: "https://api.airtable.com",
//   apiKey: process.env.AIRTABLE_API_KEY,
// });

// export default Airtable.base(process.env.AIRTABLE_BASE);

import Airtable from "airtable";

Airtable.configure({
  endpointUrl: "https://api.airtable.com",
  apiKey: process.env.AIRTABLE_API_KEY,
});

const api1Key = process.env.AIRTABLE_API_KEY;
const api2Key = process.env.AIRTABLE_API_KEY2;
// Pobierz dzisiejszą datę
const today = new Date();
// Pobierz numer dnia miesiąca (od 1 do 31)
const dayOfMonth = today.getDate();

// Wybierz odpowiednią bazę w zależności od dnia miesiąca
const baseId = dayOfMonth <= 15 ? api1Key : api2Key;

export default Airtable.base(baseId);
