import { useState, useRef, useEffect } from "react";
// import { useRouter } from "next/router";
import { useSession } from "next-auth/react";
import BaseLayout from "../../components/baseLayout";
// import Spinner from "../../components/spinner";

export default function GenerujFiltr() {
  const { data: session, status } = useSession();
  const [email, setEmail] = useState("");

  const [filtr, setFiltr] = useState("");
  const [mmka, setMmka] = useState("");

  if (status === "authenticated" && email === "") {
    setEmail(session.user.email);
  }

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text).then(
      function () {
        console.log("Async: Copying to clipboard was successful!");
      },
      function (err) {
        console.error("Async: Could not copy text: ", err);
      }
    );
  };

  useEffect(() => {
    if (mmka.length > 0) {
      const filtrData = [];
      const split = mmka.split("\t");
      split.forEach((el) => {
        if (el.includes("SN/")) {
          filtrData.push(el);
        }
      });
      const filtr = filtrData.join("|");
      setFiltr(filtr);
      copyToClipboard(filtr);
    }
  }, [mmka]);

  return (
    <BaseLayout>
      <section className="mx-auto p-2 mt-3 mb-8 flex flex-col">
        <div>
          <textarea
            value={mmka}
            onChange={(e) => setMmka(e.target.value)}
            className="h-72 w-full p-2 text-sm font-mono text-indigo-400 border border-indigo-400 rounded"
            placeholder="tutaj wklej MMke"
          ></textarea>
        </div>
        <div className="m-2 flex">
          <button
            onClick={(e) => {
              e.preventDefault();
              copyToClipboard(filtr);
            }}
            className="disabled:opacity-50 flex mx-auto text-white  bg-indigo-500 border-0 py-2 px-8 focus:outline-none hover:bg-indigo-600 rounded text-lg"
          >
            KOPIUJ
          </button>
          <button
            onClick={(e) => {
              e.preventDefault();
              setMmka("");
              setFiltr("");
            }}
            className="disabled:opacity-50 flex mx-auto text-white bg-indigo-500 border-0 py-2 px-8 focus:outline-none hover:bg-indigo-600 rounded text-lg"
          >
            WYCZYŚĆ
          </button>
        </div>
        <div className="mt-4">
          <textarea
            value={filtr}
            className="h-48 w-full p-2 text-sm font-mono text-indigo-400"
            placeholder="tutaj będzie wyświetlony filtr"
          ></textarea>
        </div>
      </section>
    </BaseLayout>
  );
}
