import getUserData from "../../services/getUserData";
import BaseLayout from "../../components/baseLayout";
import { useSession } from "next-auth/react";
import { useRouter } from "next/router";
import { useEffect, useRef, useState } from "react";
import dayjs from "dayjs";
import "dayjs/locale/pl";
dayjs.locale("pl");

export const getServerSideProps = async (context) => {
  const userData = await getUserData(context.params.id);

  return {
    props: {
      userData,
      id: context.params.id,
    },
  };
};

export default function UserData({ userData, id }) {
  const { data: session, status } = useSession();
  const user = { ...userData[0] };
  const router = useRouter();
  const userForm = useRef();
  // const loginForm = useRef();
  const [error, setError] = useState();
  const [formProcessing, setFormProcessing] = useState(false);

  //wywalenie użytkownika o innym ID
  useEffect(() => {
    if (status === "authenticated" && session.user.userID.toString() !== id) {
      router.push("/");
    }
  }, [session, status]);

  const handleSubmit = async (e) => {
    // console.log(`session:`, session.user.id);
    e.preventDefault();
    if (formProcessing) return;
    setError(null);
    setFormProcessing(true);
    const form = new FormData(userForm.current);
    const payload = {
      userID: user.ID,
      oldPassword: form.get("oldPassword"),
      newPassword: form.get("newPassword"),
    };

    if (form.get("passwordConfirm").toLowerCase() === "potwierdzam") {
      setError("Śmieszek 😂😂😂");
      setFormProcessing(false);
      return;
    }

    if (payload.newPassword !== form.get("passwordConfirm")) {
      setError("Hasła się nie zgadzają!");
      setFormProcessing(false);
      return;
    }

    const response = await fetch("/api/users", {
      method: "PUT",
      body: JSON.stringify(payload),
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (response.ok) {
      router.push("/users/password");
    } else {
      const payload = await response.json();
      setFormProcessing(false);
      setError(payload.error);
    }
  };

  return (
    <BaseLayout>
      <section className="container mx-auto p-2 mt-3 mb-8">
        <div className="sm:mt-8 md:mt-8">
          <h2 className="sm:text-3xl text-3xl font-medium title-font mb-4 text-gray-900 text-center">
            {user.name} {user.surname}
          </h2>
        </div>
        <div className="container mx-auto md:w-2/3">
          <form ref={userForm} onSubmit={handleSubmit}>
            <div className="p-2 w-full">
              <label htmlFor="oldPassword" className="leading-7 text-sm text-gray-600">
                Stare hasło:
              </label>
              <input
                type="password"
                id="oldPassword"
                name="oldPassword"
                required
                className="w-full bg-gray-100 bg-opacity-50 rounded border border-gray-300 focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-200 text-base outline-none text-gray-700 py-1 px-3 leading-8 transition-colors duration-200 ease-in-out"
              />
            </div>
            <div className="p-2 w-full">
              <label htmlFor="newPassword" className="leading-7 text-sm text-gray-600">
                Nowe Hasło:
              </label>
              <input
                type="password"
                id="newPassword"
                name="newPassword"
                required
                className="w-full bg-gray-100 bg-opacity-50 rounded border border-gray-300 focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-200 text-base outline-none text-gray-700 py-1 px-3 leading-8 transition-colors duration-200 ease-in-out"
              />
            </div>
            <div className="p-2 w-full ">
              <label htmlFor="passwordConfirm" className="leading-7 text-sm text-gray-600">
                Potwierdź Hasło:
              </label>
              <input
                type="password"
                id="passwordConfirm"
                name="passwordConfirm"
                required
                className="w-full bg-gray-100 bg-opacity-50 rounded border border-gray-300 focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-200 text-base outline-none text-gray-700 py-1 px-3 leading-8 transition-colors duration-200 ease-in-out"
              />
            </div>
            <div className="p-6 w-full">
              <button
                disabled={formProcessing}
                className="disabled:opacity-50 flex mx-auto text-white bg-indigo-500 border-0 py-2 px-8 focus:outline-none hover:bg-indigo-600 rounded text-lg"
              >
                {formProcessing ? "Proszę czekać..." : "Zmień hasło"}
              </button>
              {error && (
                <div className="flex justify-center w-full my-5">
                  <span className="bg-red-600 w-full rounded text-white px-3 py-3 text-center">Błąd: {error}</span>
                </div>
              )}
            </div>
          </form>
        </div>
      </section>
    </BaseLayout>
  );
}
