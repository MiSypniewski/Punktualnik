import Link from "next/link";
import classNames from "classnames";

// Jeden przycisk zamiast trzech wariantów `bg-indigo-500` sklejanych na miejscu
// i trzech różnych stanów `disabled:`.
//
// Etykiety piszemy zdaniowo, nie wersalikami: wersaliki są w tym systemie
// zarezerwowane dla nagłówków i statusów, a polskie etykiety bywają długie
// („Pobierz zestawienie sald wszystkich pracowników”).
const VARIANTS = {
  primary: "bg-accent text-accent-ink hover:bg-accent/90",
  secondary: "bg-surface text-body border border-line-strong hover:bg-raised",
  ghost: "text-muted hover:text-body hover:bg-raised",
  danger: "bg-danger text-danger-ink hover:bg-danger/90",
  // Wyłącznie do zatrzymania czegoś, co leci: „Stop” przy timerze.
  signal: "bg-signal text-signal-ink hover:bg-signal/90",
};

const SIZES = {
  sm: "py-1.5 px-3 text-sm",
  md: "py-2 px-4 text-sm",
  lg: "py-2.5 px-6 text-base",
};

const base =
  "inline-flex items-center justify-center gap-2 rounded font-medium whitespace-nowrap transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

export const buttonClass = ({ variant = "primary", size = "md", className }) =>
  classNames(base, VARIANTS[variant] || VARIANTS.primary, SIZES[size] || SIZES.md, className);

const Button = ({ variant, size, className, type = "button", ...rest }) => (
  <button type={type} className={buttonClass({ variant, size, className })} {...rest} />
);

/** Ten sam wygląd, ale to link — np. pobranie CSV, które musi być nawigacją,
 *  żeby zadziałał nagłówek Content-Disposition. */
export const ButtonLink = ({ href, variant, size, className, external, ...rest }) => {
  const anchor = <a className={buttonClass({ variant, size, className })} href={external ? href : undefined} {...rest} />;
  return external ? anchor : <Link href={href}>{anchor}</Link>;
};

export default Button;

/** Kwadratowy przycisk z samą ikoną — w wierszach list, gdzie na etykietę nie
 *  ma miejsca. `title` i `aria-label` są OBOWIĄZKOWE: bez nich zostaje sam
 *  obrazek bez znaczenia. */
export const IconButton = ({ label, className, children, ...rest }) => (
  <button
    type="button"
    title={label}
    aria-label={label}
    className={classNames(
      "inline-flex items-center justify-center w-8 h-8 rounded border border-line text-muted transition-colors hover:text-body hover:bg-raised disabled:opacity-40 disabled:cursor-not-allowed",
      className
    )}
    {...rest}
  >
    {children}
  </button>
);
