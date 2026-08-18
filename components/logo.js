import Link from "next/link";

// Znak firmowy: belka peronu i nazwa wersalikami. Belka jest jedynym miejscem
// poza stanami „na żywo”, gdzie wolno użyć bursztynu — to ten sam znak, który
// wraca w nagłówkach sekcji, więc czyta się jak element systemu, a nie ozdoba.
const Logo = ({ href = "/", size = "base" }) => {
  const mark = (
    <span className="flex items-center gap-2">
      <span
        aria-hidden="true"
        className={size === "lg" ? "block w-[5px] h-8 rounded-sm bg-signal" : "block w-[3px] h-5 rounded-sm bg-signal"}
      />
      <span
        className={
          size === "lg"
            ? "font-bold uppercase tracking-signage text-2xl leading-none"
            : "font-bold uppercase tracking-signage text-sm leading-none"
        }
      >
        Punktualnik
      </span>
    </span>
  );

  if (!href) return mark;

  return (
    <Link href={href}>
      <a className="shrink-0 rounded-sm" aria-label="Punktualnik — strona główna">
        {mark}
      </a>
    </Link>
  );
};

export default Logo;
