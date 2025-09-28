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

// Pobierz dzisiejszą datę
const today = new Date();
// Pobierz numer dnia miesiąca (od 1 do 31)
const dayOfMonth = today.getDate();

// Wybierz odpowiednią bazę w zależności od dnia miesiąca
const baseId =
  dayOfMonth <= 15 ? process.env.AIRTABLE_BASE : process.env.AIRTABLE_BASE2;

export default Airtable.base(baseId);
