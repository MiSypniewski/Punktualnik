import Joi from "joi";
import dayjs from "dayjs";
import db from "./db";
import { KIND_KEYS, OVERTIME_KINDS } from "./overtimeKinds";

// Rodzaje, przy których powód jest obowiązkowy — te dopisujące czas do salda
// (patrz requiresReason w overtimeKinds.js). Lista składa się z tej samej
// definicji co predykat, więc nie ma czego rozjechać.
const REASON_REQUIRED_KINDS = KIND_KEYS.filter((k) => OVERTIME_KINDS[k].sign > 0);

// Krótsze niż to i "powód" jest wymówką ("ok", "bo"), a nie odpowiedzią na
// pytanie, co się robiło. Nie zastąpi to czytania ze zrozumieniem, ale odsiewa
// klepnięcie w klawiaturę byle przejść dalej.
const REASON_MIN = 5;

// `data` to zwykłe YYYY-MM-DD — świadomie inaczej niż w Times, gdzie dzień jest
// znacznikiem ISO przypiętym do 03:00. Tu nie ma nic do przypinania: wniosek
// dotyczy całego dnia, a porównania dat są zwykłym porównaniem stringów.
const schema = Joi.object({
  userID: Joi.number().integer().positive().required(),
  kind: Joi.string()
    .valid(...KIND_KEYS)
    .required(),
  data: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
  // Górny limit to doba — chroni przed literówką w stylu "800 godzin".
  minutes: Joi.number().integer().min(1).max(24 * 60).required(),
  // `trim()` przed sprawdzeniem długości: same spacje mają się odbić tak samo
  // jak puste pole.
  reason: Joi.string()
    .trim()
    .max(500)
    .when("kind", {
      is: Joi.valid(...REASON_REQUIRED_KINDS),
      then: Joi.string().trim().min(REASON_MIN).required(),
      otherwise: Joi.string().trim().max(500).allow("").default(""),
    }),
})
  // Komunikaty po polsku, bo API oddaje `error.message` PROSTO do przeglądarki
  // (pages/api/overtime/index.js) — bez tego pracownik dostawał zdanie Joi po
  // angielsku, w rodzaju `"reason" is not allowed to be empty`.
  .messages({
    "any.required": "Uzupełnij wszystkie pola wniosku.",
    "string.empty": "Opisz, co robiłeś na nadgodzinach — bez tego kierownik nie ma czego zatwierdzić.",
    "string.min": "Opis jest za krótki — napisz konkretnie, co robiłeś.",
    "string.max": "Opis jest za długi (najwyżej 500 znaków).",
    "any.only": "Nieznany rodzaj wniosku.",
    "string.pattern.base": "Podaj datę w formacie RRRR-MM-DD.",
    "number.base": "Podaj wymiar jako liczbę.",
    "number.min": "Wymiar musi być większy niż zero.",
    "number.max": "Wymiar nie może przekraczać doby.",
  });

const insert = db.prepare(
  `INSERT INTO Overtime (userID, kind, data, minutes, reason, status, createdAt)
   VALUES (@userID, @kind, @data, @minutes, @reason, 'pending', @createdAt)`
);

const findById = db.prepare(`SELECT * FROM Overtime WHERE id = ?`);

const createOvertimeRequest = async (payload) => {
  const value = await schema.validateAsync(payload);
  const info = insert.run({ ...value, createdAt: dayjs().format() });
  return findById.get(info.lastInsertRowid);
};

export default createOvertimeRequest;
