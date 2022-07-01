import { useRef, useState } from "react";
import { useRouter } from "next/router";
import { signIn } from "next-auth/react";

export default function LogIn() {
  const loginForm = useRef();
  const [error, setError] = useState();
  const [formProcessing, setFormProcessing] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (formProcessing) return;
    setError(null);
    setFormProcessing(true);
    const form = new FormData(loginForm.current);
    const { ok } = await signIn("credentials", {
      redirect: false,
      email: form.get("email"),
      password: form.get("password"),
    });

    if (ok) {
      router.push("/");
    } else {
      setError("Brak autoryzacji. Spróbuj ponownie");
      setFormProcessing(false);
    }
  };

  return (
    <section className="p-2 mt-3 mb-8">
      <div className="mt-16">
        <h2 className="sm:text-3xl text-2xl font-medium title-font mb-4 text-gray-900 text-center">Logowanie</h2>
      </div>
      <div className="container mx-auto lg:w-2/3">
        <form ref={loginForm} onSubmit={handleSubmit}>
          <div className="p-2">
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
          <div className="p-6 w-full">
            <button
              disabled={formProcessing}
              className="disabled:opacity-50 flex mx-auto text-white bg-indigo-500 border-0 py-2 px-8 focus:outline-none hover:bg-indigo-600 rounded text-lg"
            >
              {formProcessing ? "Proszę czekać..." : "Login"}
            </button>
            {error && (
              <div className="flex justify-center w-full my-5">
                <span className="bg-red-600 w-full rounded text-white px-3 py-3 text-center">
                  Niepoprawny login / hasło lub Twoje konto nie zostało aktywowane!
                </span>
              </div>
            )}
          </div>
        </form>
      </div>
    </section>
  );
}
