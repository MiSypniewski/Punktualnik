import { useState, useEffect } from "react";
import Button, { IconButton } from "./ui/button";
import { CloseIcon } from "./ui/icons";

// Podpowiedź „zainstaluj na telefonie”, w stopce powłoki.
//
// Bez niej manifest jest pracą niewidoczną: przeglądarka nie proponuje
// instalacji na tyle wyraźnie, żeby ktokolwiek to zauważył, a iPhone nie
// proponuje w ogóle — tam instalacja jest schowana pod „Udostępnij”.
//
// Dlaczego to głównie INSTRUKCJA, a nie przycisk: jednoklikowa instalacja
// wymaga zdarzenia `beforeinstallprompt`, a Chrome nadal wystawia je wyłącznie
// stronom z service workerem obsługującym `fetch` — mimo że sama instalacja
// z menu przeglądarki działa bez service workera od Chrome 108 na telefonach
// (developer.chrome.com/blog/update-install-criteria). Dokładanie pustego
// service workera tylko po to, żeby odblokować przycisk, to dokładnie ten
// zabieg, przez który Chrome przestał traktować jego obecność jako dowód
// jakości — i realny koszt (własny cykl życia, wersjonowanie) za wygodę jednego
// kliknięcia. Jeśli przeglądarka to zdarzenie mimo wszystko poda, przycisk
// pojawia się sam; jeśli nie, zostaje zdanie mówiące, gdzie kliknąć.
const DISMISSED_KEY = "instalacja:ukryta";

const IOS = /iphone|ipad|ipod/i;

/** Czy aplikacja jest już uruchomiona jako zainstalowana (bez paska adresu). */
const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;

export default function InstallHint() {
  // Start zawsze od „nie pokazuj”, decyzja dopiero w useEffect — serwer nie zna
  // ani systemu, ani localStorage, a render serwera i pierwszy render klienta
  // muszą być identyczne. Ten sam zabieg co przy motywie (components/themeToggle.js)
  // i przełączniku grupowania listy zadań.
  const [visible, setVisible] = useState(false);
  const [ios, setIos] = useState(false);
  const [prompt, setPrompt] = useState(null);

  useEffect(() => {
    if (isStandalone() || localStorage.getItem(DISMISSED_KEY) === "1") return undefined;

    // Tylko ekran dotykowy: telefon i tablet w hali. Na komputerze z myszą
    // instalacja niczego nie zmienia, a pasek w stopce byłby czystym szumem.
    if (!window.matchMedia("(pointer: coarse)").matches) return undefined;

    setIos(IOS.test(navigator.userAgent));
    setVisible(true);

    // Gdy przeglądarka jednak zaproponuje instalację — przechwytujemy zdarzenie
    // (blokując jej własny baner) i zamieniamy podpowiedź na przycisk.
    const onPrompt = (event) => {
      event.preventDefault();
      setPrompt(event);
    };
    // Po instalacji podpowiedź znika na dobre — także w karcie przeglądarki,
    // z której instalacja poszła.
    const onInstalled = () => {
      localStorage.setItem(DISMISSED_KEY, "1");
      setVisible(false);
    };

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!visible) return null;

  const hide = () => {
    localStorage.setItem(DISMISSED_KEY, "1");
    setVisible(false);
  };

  const install = () => {
    prompt.prompt();
    // Wynik nas nie interesuje: przy zgodzie zadziała `appinstalled`, przy
    // odmowie podpowiedź ma zostać, bo człowiek może wrócić do niej jutro.
    // Samo zdarzenie jest jednorazowe — drugi `prompt()` na tym samym obiekcie
    // rzuca wyjątkiem, więc je porzucamy.
    setPrompt(null);
  };

  return (
    <div className="border-t border-line-subtle bg-raised">
      <div className="mx-auto max-w-wide px-4 py-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        <span className="font-semibold uppercase tracking-signage">Na telefonie</span>
        <span>
          {ios
            ? "Otwórz „Udostępnij” i wybierz „Dodaj do ekranu początkowego” — Punktualnik dostanie własną ikonę i będzie się otwierał bez paska przeglądarki."
            : "Otwórz menu przeglądarki (⋮) i wybierz „Zainstaluj aplikację” — Punktualnik dostanie własną ikonę i będzie się otwierał bez paska przeglądarki."}
        </span>
        <span className="flex items-center gap-2 ml-auto">
          {prompt && (
            <Button size="sm" onClick={install}>
              Zainstaluj
            </Button>
          )}
          <IconButton label="Nie pokazuj więcej" onClick={hide}>
            <CloseIcon />
          </IconButton>
        </span>
      </div>
    </div>
  );
}
