import Joi from "joi";
import db from "./db";
import { MIN_TILES, MAX_TILES, DEFAULT_TILES, clampTileCount, tileKey } from "../utils/resumeTiles";

// Kafelki "Wznów" pod paskiem timera na /zadania — ich LICZBA i PRZYPIĘCIA.
//
// Skąd bierze się zawartość kafelka, opisuje services/entrySuggestions.js:
// para projekt + opis wyliczona z własnej historii, sortowana po liczbie użyć.
// Ten moduł dokłada do tego dwie rzeczy, których z historii wyliczyć się nie da:
//
//  - ile kafelków w ogóle pokazać (6..18, Users.resumeTiles),
//  - które pary mają stać NA STAŁE, niezależnie od tego, co robiono w tym
//    tygodniu (tabela ResumeTiles).
//
// Przypięcia to nie to samo co podpowiedzi. Podpowiedź jest OBSERWACJĄ ("tak
// wyglądały ostatnie 90 dni") i ma prawo się zmieniać; przypięcie jest DECYZJĄ
// pracownika i ma stać, także wtedy, gdy tej pary nie ma jeszcze w historii ani
// razu — bo od tego jest: przypiąć czynność, którą się dopiero zaczyna robić.

// Granice, tożsamość kafelka i składanie listy do renderu siedzą w
// utils/resumeTiles.js — używa ich też przeglądarka, a import z tego pliku
// wciągnąłby jej do bundla better-sqlite3.

// Zwykły JOIN, ale BEZ warunku p.isActive — świadomie, w odróżnieniu od
// zapytania podpowiedzi (services/entrySuggestions.js). Tam projekt
// zarchiwizowany ma wypaść z listy, tutaj przypięcie na nim ma zostać widoczne:
// pracownik je ustawił, więc musi zobaczyć, że przestało działać, i mieć co
// poprawić. Kafelek nieużywalny rozpoznaje buildTiles w utils/resumeTiles.js.
const stmtPins = db.prepare(`
  SELECT t.position, t.projectID, t.description,
         p.name AS projectName, p.color AS projectColor
    FROM ResumeTiles t
    JOIN Projects p ON p.id = t.projectID
   WHERE t.userID = ?
   ORDER BY t.position`);

const stmtCount = db.prepare(`SELECT resumeTiles FROM Users WHERE id = ?`);
const stmtSetCount = db.prepare(`UPDATE Users SET resumeTiles = @count WHERE id = @userID`);
const stmtClear = db.prepare(`DELETE FROM ResumeTiles WHERE userID = ?`);
const stmtInsert = db.prepare(`
  INSERT INTO ResumeTiles (userID, position, projectID, description)
       VALUES (@userID, @position, @projectID, @description)`);

/**
 * Ustawienia kafelków jednej osoby.
 *
 * @returns {{count: number, pins: {projectID: number, description: string,
 *            projectName: string, projectColor: string}[]}}
 */
export const getTilePrefs = (userID) => {
  const id = Number(userID);
  const row = stmtCount.get(id);

  return {
    // Clamp na ODCZYCIE, nie tylko przy zapisie: kolumnę da się przestawić
    // z konsoli sqlite3, a widok ma wtedy pokazać sensowną liczbę zamiast
    // renderować dwieście kafelków.
    count: clampTileCount(row ? row.resumeTiles : DEFAULT_TILES),
    pins: stmtPins.all(id).map(({ position, ...pin }) => pin),
  };
};

const fail = (code, message) => {
  const err = new Error(message);
  err.code = code;
  throw err;
};

// Opis WYMAGANY i ucięty do 200 znaków — te same granice co descRequiredSchema
// w services/taskEntries.js. Kafelek startuje wpis, więc nie wolno mu pozwolić
// zapisać czegoś, czego wpis by nie przyjął.
const schema = Joi.object({
  count: Joi.number().integer().min(MIN_TILES).max(MAX_TILES).required().messages({
    "number.min": `Kafelków może być od ${MIN_TILES} do ${MAX_TILES}.`,
    "number.max": `Kafelków może być od ${MIN_TILES} do ${MAX_TILES}.`,
  }),
  pins: Joi.array()
    .items(
      Joi.object({
        projectID: Joi.number().integer().positive().required().messages({
          "any.required": "Wybierz projekt dla przypiętego kafelka.",
          "number.base": "Wybierz projekt dla przypiętego kafelka.",
        }),
        description: Joi.string().trim().min(1).max(200).required().messages({
          "string.empty": "Opisz przypięty kafelek.",
          "any.required": "Opisz przypięty kafelek.",
        }),
      })
    )
    .default([]),
});

/**
 * Zapis ustawień. Wymiana W CAŁOŚCI, nie łatanie po jednym wierszu: pozycje są
 * gęste (0..n-1), więc każda zmiana kolejności i tak dotyka wszystkich, a jedno
 * DELETE + INSERT w transakcji nie zostawia stanu pośredniego, który trzeba by
 * odkręcać po błędzie.
 *
 * Zasięg sekcji i archiwizację projektu sprawdza WOŁAJĄCY (pages/api/entries/tiles.js),
 * dokładnie tym samym torem co start wpisu — tutaj zostają reguły, które nie
 * potrzebują wiedzieć, kto pyta.
 */
export const saveTilePrefs = (userID, payload) => {
  const { count, pins } = Joi.attempt(payload ?? {}, schema);

  // Więcej przypięć niż slotów to nie jest stan do cichego ucięcia: ucięty
  // kafelek zniknąłby bez śladu, a pracownik dowiedziałby się o tym dopiero
  // wtedy, gdy zacznie go szukać.
  if (pins.length > count) {
    fail(
      "too_many_pins",
      `Przypiętych kafelków (${pins.length}) jest więcej niż miejsc (${count}). Odepnij któryś albo zwiększ liczbę kafelków.`
    );
  }

  const seen = new Set();
  pins.forEach(({ projectID, description }) => {
    const key = tileKey(projectID, description);
    if (seen.has(key)) {
      fail("duplicate_pin", `Kafelek „${description}” jest przypięty dwa razy.`);
    }
    seen.add(key);
  });

  const id = Number(userID);

  db.transaction(() => {
    stmtSetCount.run({ userID: id, count });
    stmtClear.run(id);
    pins.forEach(({ projectID, description }, position) =>
      stmtInsert.run({ userID: id, position, projectID, description })
    );
  })();

  return { count, pins };
};

export default getTilePrefs;
