import { useState, useRef, useEffect } from "react";
// import { useRouter } from "next/router";
import { useSession } from "next-auth/react";
import BaseLayout from "../../components/baseLayout";
import Button from "../../components/ui/button";
import { Field, Textarea } from "../../components/ui/field";
import PageHeader from "../../components/ui/pageHeader";
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
    <BaseLayout width="narrow">
      <PageHeader
        title="Generator filtra"
        description="Narzędzie doraźne spoza ewidencji czasu: wkleja się MMkę, wychodzi sklejony filtr z numerami SN."
      />

      <div className="flex flex-col gap-4">
        <Field label="MMka" htmlFor="mmka">
          <Textarea
            id="mmka"
            value={mmka}
            onChange={(e) => setMmka(e.target.value)}
            className="h-64 font-mono"
            placeholder="Wklej tutaj całą MMkę"
          />
        </Field>

        <div className="flex gap-2">
          <Button onClick={() => copyToClipboard(filtr)}>Kopiuj filtr</Button>
          <Button
            variant="secondary"
            onClick={() => {
              setMmka("");
              setFiltr("");
            }}
          >
            Wyczyść
          </Button>
        </div>

        <Field label="Wynik" htmlFor="filtr">
          {/* readOnly, bo pole jest wyjściem, nie wejściem — bez tego React
              zgłasza kontrolowane pole bez obsługi zmiany. */}
          <Textarea
            id="filtr"
            value={filtr}
            readOnly
            className="h-40 font-mono"
            placeholder="Tutaj pojawi się filtr"
          />
        </Field>
      </div>
    </BaseLayout>
  );
}
