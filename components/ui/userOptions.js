// Lista <option> z pracownikami do <Select>. Wcześniej każdy z siedmiu dropdownów
// „wybierz pracownika" renderował własne `users.map(...)` — niemal identyczne siedem
// razy i bez żadnego rozróżnienia, przez co konto zwolnionego pracownika dawało się
// wybrać przy wpisywaniu urlopu.
//
// Dwa tryby, bo te dropdowny mają dwa różne zadania:
//
//   formularz ZAPISUJE dane na koncie — nieaktywne nie ma prawa się tu pojawić,
//     bo konto zwolnionego nie dostaje ani urlopu, ani puli dni, ani nowej karty;
//   filtr tylko PRZEGLĄDA — historia byłego pracownika nadal siedzi w Times,
//     Absences i TaskEntries i musi dać się wyciągnąć, więc nieaktywni zostają,
//     tyle że w osobnej grupie.
//
// Lista przychodzi z services/getAllUsers.js posortowana po (surname, name); podział
// zachowuje tę kolejność wewnątrz obu grup.
const UserOptions = ({ users = [], includeInactive = false, showSection = false }) => {
  // Sekcję pokazują nadgodziny: kierownik obsługujący kilka działów ma tam obok
  // siebie ludzi z różnych sekcji i po samym nazwisku ich nie rozróżni.
  const caption = (u) => (showSection ? `${u.surname} ${u.name} (${u.section})` : `${u.surname} ${u.name}`);

  const options = (list) =>
    list.map((u) => (
      <option key={u.id} value={u.id}>
        {caption(u)}
      </option>
    ));

  const active = users.filter((u) => u.isActive);
  if (!includeInactive) return options(active);

  const inactive = users.filter((u) => !u.isActive);
  // Bez byłych pracowników zostaje płaska lista — samotny nagłówek „Pracownicy"
  // nad wszystkimi nazwiskami niczego nie rozdziela, więc tylko zaśmieca.
  if (inactive.length === 0) return options(active);

  return (
    <>
      <optgroup label="Pracownicy">{options(active)}</optgroup>
      <optgroup label="Byli pracownicy">{options(inactive)}</optgroup>
    </>
  );
};

export default UserOptions;
