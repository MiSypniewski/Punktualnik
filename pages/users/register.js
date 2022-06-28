import { useState, useRef } from "react";
import { jsonFetcher } from "../../utils";
import { useRouter } from "next/router";
import { fromJSON } from "postcss";

export default function CreateUser() {
  const userForm = useRef();
  const [error, setError] = useState();
  const [formProcessing, setFormProcessing] = useState(false);
  const router = useRouter();
  // potrzebne do innego projektu - Raportowacz master
  // const [cashregisterNumbers, setCashRegisterNumbers] = useState(0);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (formProcessing) return;
    setError(null);
    setFormProcessing(true);
    const form = new FormData(userForm.current);
    const payload = {
      email: form.get("email"),
      name: form.get("name"),
      surname: form.get("surname"),
      password: form.get("password"),
      location: form.get("location"),
      section: form.get("section"),
      // potrzebne do innego projektu! (raportowacz master)
      // iloscKas: form.get("iloscKas"),
      // numeryKas: form.getAll("numerKasy"),
    };

    if (payload.password !== form.get("passwordConfirm")) {
      setError("Hasła się nie zgadzają!");
      setFormProcessing(false);
      return;
    }

    const response = await fetch("/api/users", {
      method: "POST",
      body: JSON.stringify(payload),
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (response.ok) {
      router.push("/users/comfirm");
    } else {
      const payload = await response.json();
      setFormProcessing(false);
      setError(payload.error);
    }
  };

  return (
    <section className="sm:container mx-auto p-2 mt-3 mb-8">
      <div className="sm:mt-4 md:mt-8 lg:mt-16">
        <h2 className="sm:text-3xl text-2xl font-medium title-font mb-4 text-gray-900 text-center">Nowy użytkownik</h2>
      </div>
      <div>
        <form ref={userForm} onSubmit={handleSubmit}>
          <div className="p-2 w-full">
            <label htmlFor="email" className="leading-7 text-sm text-gray-600">
              E-mail:
            </label>
            <input
              type="email"
              id="email"
              name="email"
              required
              className="w-full bg-gray-100 bg-opacity-50 rounded border border-gray-300 focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-200 text-base outline-none text-gray-700 py-1 px-3 leading-8 transition-colors duration-200 ease-in-out"
            />
          </div>
          <div className="p-2 w-full">
            <label htmlFor="password" className="leading-7 text-sm text-gray-600">
              Hasło:
            </label>
            <input
              type="password"
              id="password"
              name="password"
              required
              className="w-full bg-gray-100 bg-opacity-50 rounded border border-gray-300 focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-200 text-base outline-none text-gray-700 py-1 px-3 leading-8 transition-colors duration-200 ease-in-out"
            />
          </div>
          <div className="p-2 w-full ">
            <label htmlFor="passwordConfirm" className="leading-7 text-sm text-gray-600">
              Powtórz Hasło:
            </label>
            <input
              type="password"
              id="passwordConfirm"
              name="passwordConfirm"
              required
              className="w-full bg-gray-100 bg-opacity-50 rounded border border-gray-300 focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-200 text-base outline-none text-gray-700 py-1 px-3 leading-8 transition-colors duration-200 ease-in-out"
            />
          </div>
          <div className="flex">
            <div className="p-2 w-full">
              <label htmlFor="name" className="leading-7 text-sm text-gray-600">
                Imię:
              </label>
              <input
                type="text"
                id="name"
                name="name"
                required
                className="w-full bg-gray-100 bg-opacity-50 rounded border border-gray-300 focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-200 outline-none text-gray-700 leading-8 py-1 px-3 text-base transition-colors duration-200 ease-in-out"
              />
            </div>
            <div className="p-2 w-full">
              <label htmlFor="surname" className="leading-7 text-sm text-gray-600">
                Nazwisko:
              </label>
              <input
                type="text"
                id="surname"
                name="surname"
                required
                className="w-full bg-gray-100 bg-opacity-50 rounded border border-gray-300 focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-200 outline-none text-gray-700 leading-8 py-1 px-3 text-base transition-colors duration-200 ease-in-out"
              />
            </div>
          </div>
          <div className="flex">
            <div className="p-2 w-full">
              <label htmlFor="section" className="leading-7 text-sm text-gray-600">
                Dział:
              </label>
              <select
                name="section"
                id="section"
                required
                className="appearance-none w-full h-10 bg-gray-100 bg-opacity-50 rounded border border-gray-300 focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-200 outline-none text-gray-700 leading-8 py-1 px-3 text-base transition-colors duration-200 ease-in-out"
              >
                <option value=""></option>
                <option value="biedronka">Biedronka</option>
                <option value="cns">CNS</option>
                <option value="pio">PiO</option>
                <option value="spedycja">Spedycja</option>
                <option value="lidl">Lidl</option>
                <option value="dyrekcja">Dyrekcja</option>
              </select>
            </div>
            <div className="p-2 w-full">
              <label htmlFor="location" className="leading-7 text-sm text-gray-600">
                Miejsce pracy:
              </label>
              <select
                name="location"
                id="location"
                required
                className="appearance-none w-full h-10 bg-gray-100 bg-opacity-50 rounded border border-gray-300 focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-200 outline-none text-gray-700 leading-8 py-1 px-3 text-base transition-colors duration-200 ease-in-out"
              >
                <option value=""></option>
                <option value="gajowa 6">Gajowa 6</option>
                <option value="chlebowa 22">Chlebowa 22</option>
                <option value="chlebowa 26">Chlebowa 26</option>
              </select>
            </div>
          </div>
          {/* Potrzebne do projektu Raportowacz - master */}
          {/* <div className="p-2 w-full">
            <fieldset className="flex">
              <div className="p-2">
                <input
                  type="checkbox"
                  id="K15"
                  name="numerKasy"
                  value="K15"
                  className="appearance-none indeterminate:bg-gray-300 h-4 w-4 border border-gray-300 rounded-sm bg-gray-100 text-indigo-500  checked:bg-indigo-500 checked:border-indigo-600 focus:border-indigo-500 focus:outline-none transition duration-200 mt-1 align-top bg-no-repeat bg-center bg-contain float-left mr-2 cursor-pointer"
                />
                <label htmlFor="K15" className="inline-block leading-7 text-sm text-gray-600">
                  K15
                </label>
              </div>

              <div className="p-2">
                <input
                  type="checkbox"
                  id="K16"
                  name="numerKasy"
                  value="K16"
                  className="indeterminate:bg-gray-300 h-4 w-4 border border-gray-300 rounded-sm bg-gray-100 text-indigo-500  checked:bg-indigo-500 checked:border-indigo-600 focus:border-indigo-500 focus:outline-none transition duration-200 mt-1 align-top bg-no-repeat bg-center bg-contain float-left mr-2 cursor-pointer"
                />
                <label htmlFor="K16" className="leading-7 text-sm text-gray-600">
                  K16
                </label>
              </div>
              <div className="p-2">
                <input
                  type="checkbox"
                  id="K17"
                  name="numerKasy"
                  value="K17"
                  className=" indeterminate:bg-gray-300 h-4 w-4 border border-gray-300 rounded-sm bg-gray-100 text-indigo-500  checked:bg-indigo-500 checked:border-indigo-600 focus:border-indigo-500 focus:outline-none transition duration-200 mt-1 align-top bg-no-repeat bg-center bg-contain float-left mr-2 cursor-pointer"
                />
                <label htmlFor="K17" className="leading-7 text-sm text-gray-600">
                  K17
                </label>
              </div>
            </fieldset>
          </div>
          <div className="p-2 w-full">
            <p className="leading-7 text-sm text-gray-600">Podaj liczbę kas:</p>
            <input
              type="range"
              id="iloscKas"
              name="iloscKas"
              step="1"
              min="0"
              max="15"
              value={cashregisterNumbers}
              onChange={(e) => {
                setCashRegisterNumbers(e.target.value);
              }}
              className="w-full  accent-indigo-500  focus:accent-indigo-600 slider-thumb:bg-red-500"
            />
            <p className="leading-7 text-sm text-gray-600">{cashregisterNumbers}</p>
          </div>
          <div className="p-2 w-full">
            <p className="leading-7 text-sm text-gray-600">Czy będziesz głosować na PiS?</p>
            <fieldset className="md:flex">
              <div className="p-2 md:mx-4 ">
                <input
                  type="radio"
                  id="tak"
                  name="glosowanie"
                  value="tak"
                  className="appearance-none indeterminate:bg-gray-300 h-4 w-4 rounded-full border border-gray-300  bg-gray-100 text-indigo-500  checked:bg-indigo-500 checked:border-indigo-600 focus:border-indigo-500 focus:outline-none transition duration-200 mt-1 align-top bg-no-repeat bg-center bg-contain float-left mr-2 cursor-pointer"
                />
                <label htmlFor="tak" className="inline-block leading-3 text-sm text-gray-600 cursor-pointer">
                  Tak, jestem pedałem
                </label>
              </div>

              <div className="p-2 md:mx-4">
                <input
                  type="radio"
                  id="nie"
                  name="glosowanie"
                  value="nie"
                  className="indeterminate:bg-gray-300 h-4 w-4 rounded-full border border-gray-300 bg-gray-100 text-indigo-500  checked:bg-indigo-500 checked:border-indigo-600 focus:border-indigo-500 focus:outline-none transition duration-200 mt-1 align-top bg-no-repeat bg-center bg-contain float-left mr-2 cursor-pointer"
                />
                <label htmlFor="nie" className="leading-3 text-sm text-gray-600">
                  Nie, jebać PiS!
                </label>
              </div>
              <div className="p-2 md:mx-4">
                <input
                  type="radio"
                  id="nieumiem"
                  name="glosowanie"
                  value="nieumiem"
                  className=" indeterminate:bg-gray-300 h-4 w-4 border rounded-full border-gray-300 bg-gray-100 text-indigo-500  checked:bg-indigo-500 checked:border-indigo-600 focus:border-indigo-500 focus:outline-none transition duration-200 mt-1 align-top bg-no-repeat bg-center bg-contain float-left mr-2 cursor-pointer"
                />
                <label htmlFor="nieumiem" className="leading-3 text-sm text-gray-600">
                  Nie umiem
                </label>
              </div>
            </fieldset>
          </div> */}
          <div className="p-6 w-full">
            <button
              disabled={formProcessing}
              className="disabled:opacity-50 flex mx-auto text-white bg-indigo-500 border-0 py-2 px-8 focus:outline-none hover:bg-indigo-600 rounded text-lg"
            >
              {formProcessing ? "Proszę czekać..." : "Uwtórz nowe konto"}
            </button>
            {error && (
              <div className="flex justify-center w-full my-5">
                <span className="bg-red-600 w-full rounded text-white px-3 py-3 text-center">
                  Konto nie utworzone! Błąd: {error}
                </span>
              </div>
            )}
          </div>
        </form>
      </div>
    </section>
  );
}
