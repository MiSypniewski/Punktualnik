import db from "./db";
import Joi from "joi";
import { getSection } from "./sections";
import { hashPassword, makeSalt } from "./password";

const schema = Joi.object({
  email: Joi.string().email().required(),
  name: Joi.string().required(),
  surname: Joi.string().required(),
  section: Joi.string().required(),
  location: Joi.string().required(),
  password: Joi.string().required(),
});

const findByEmail = db.prepare(`SELECT id FROM Users WHERE email = ?`);
const insertUser = db.prepare(
  `INSERT INTO Users (name, surname, section, location, email, passwordHash, passwordSalt, role, isActive)
   VALUES (@name, @surname, @section, @location, @email, @passwordHash, @passwordSalt, 'user', 0)`
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

  const passwordSalt = makeSalt();
  const passwordHash = await hashPassword(password, passwordSalt);

  const info = insertUser.run({
    name,
    surname,
    section: sectionSlug,
    location,
    email,
    passwordHash,
    passwordSalt,
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
