import db from "./db";
import Joi from "joi";
import { getSection } from "./sections";
import { makePasswordRecord } from "./password";

const schema = Joi.object({
  email: Joi.string().email().required(),
  name: Joi.string().required(),
  surname: Joi.string().required(),
  section: Joi.string().required(),
  location: Joi.string().required(),
  // Do sierpnia 2026 nie było tu ŻADNEGO minimum — przechodziło hasło "1".
  // Żaden algorytm hashujący tego nie naprawi, więc długość jest tu ważniejsza
  // niż liczba iteracji PBKDF2. Bez wymogów na klasy znaków: przy wymuszonej
  // długości produkują głównie "Haslo123!" i karteczki pod klawiaturą.
  //
  // Komunikat to KOD, nie zdanie — składa je strona (pages/users/register.js),
  // tak samo jak przy email_taken. Bez tego użytkownik zobaczyłby angielski
  // tekst Joi, bo formularz wyświetla nieznany kod dosłownie.
  password: Joi.string().min(10).max(200).required().messages({
    "string.min": "password_too_short",
    "string.max": "password_too_long",
  }),
});

const findByEmail = db.prepare(`SELECT id FROM Users WHERE email = ?`);
const insertUser = db.prepare(
  `INSERT INTO Users (name, surname, section, location, email,
                      passwordHash, passwordSalt, passwordParams, role, isActive)
   VALUES (@name, @surname, @section, @location, @email,
           @passwordHash, @passwordSalt, @passwordParams, 'user', 0)`
);

const checkEmail = (email) => {
  if (findByEmail.get(email)) {
    throw new Error("email_taken");
  }
};

const createUser = async (payload) => {
  const { email, name, surname, section, location, password } = await schema.validateAsync(payload);
  checkEmail(email);

  // Sekcja MUSI być ze słownika. Formularz podsuwa wyłącznie istniejące sekcje,
  // ale do POST /api/users da się strzelić z pominięciem formularza, więc bez
  // tej kontroli dowolny tekst wjeżdżałby do Users.section — a konto z sekcją
  // spoza słownika jest niewidoczne dla każdego kierownika i praktycznie nie
  // do znalezienia.
  // Normalizacja przy okazji zamyka temat "Spedycja" kontra "spedycja".
  // Do bazy trafia slug w postaci ZAPISANEJ w słowniku, nie w tej wpisanej przez
  // użytkownika — inaczej sekcja odziedziczona jako 'Spedycja' dostałaby drugi,
  // rozjechany wariant 'spedycja'.
  const found = getSection(section);
  if (!found || !found.isActive) {
    throw new Error("unknown_section");
  }
  const sectionSlug = found.slug;

  // Komplet hash + sól + parametry z jednego wywołania. Składanie tego ręcznie
  // pozwalałoby zapisać hash BEZ parametrów, czyli wiersz, którego po następnej
  // zmianie parametrów nie dałoby się już zweryfikować.
  const record = await makePasswordRecord(password);

  const info = insertUser.run({
    name,
    surname,
    section: sectionSlug,
    location,
    email,
    ...record,
  });

  return {
    id: info.lastInsertRowid,
    name,
    surname,
    section: sectionSlug,
    location,
    email,
    role: "user",
    isActive: 0,
  };
};

export default createUser;
