import { useRouter } from "next/router";

export default function Comfirm() {
  const router = useRouter();

  const handleReturnToMain = (e) => {
    e.preventDefault();
    router.push("/");
  };

  return (
    <section className="sm:container mx-auto p-2 mt-16 mb-8">
      <h2 className="sm:text-3xl text-2xl font-medium title-font mb-4 text-gray-900 text-center">
        Użytkownik utworzony
      </h2>
      <p className="text-center">Proszę czekać na aktywację konta.</p>
      <div className="mt-40">
        <button
          onClick={(e) => {
            handleReturnToMain(e);
          }}
          className="disabled:opacity-50 flex mx-auto text-white bg-indigo-500 border-0 py-2 px-8 focus:outline-none hover:bg-indigo-600 rounded text-lg font-bold"
        >
          OK
        </button>
      </div>
    </section>
  );
}
