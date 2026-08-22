import { forwardRef } from "react";
import classNames from "classnames";

// Jeden styl pola formularza zamiast trzech równoległych: ciągu „tailblocks”
// powtórzonego dosłownie dziewięć razy w users/*, ramki `border-indigo-400`
// w nadgodzinach i `border-line-strong` w zadaniach.
//
// `focus:ring-0` jest konieczne: @tailwindcss/forms dokłada własny niebieski
// pierścień na :focus, który kłóci się z globalnym :focus-visible z globals.css.
//
// Pole jest domyślnie `w-full`, bo tak wygląda w formularzu. Wąskie pole (godziny,
// minuty) trzeba wymusić przez `!w-24` — sam `w-24` przegrywa z `w-full`, które
// Tailwind generuje PÓŹNIEJ w arkuszu, a o zwycięzcy decyduje kolejność w pliku,
// nie kolejność w atrybucie class.
const control =
  "w-full rounded border border-line-strong bg-surface text-body px-3 py-2 text-sm placeholder:text-faint focus:ring-0 focus:border-accent-strong disabled:opacity-50";

// forwardRef, bo wołający musi umieć postawić kursor w konkretnym polu — pasek
// timera w pages/zadania/index.js odmawia zamknięcia zadania bez opisu i wtedy
// sam prowadzi do brakującego pola. Bez przepuszczenia ref-a `ref` na komponencie
// funkcyjnym po cichu zostaje pusty.
export const Input = forwardRef(({ className, ...rest }, ref) => (
  <input ref={ref} className={classNames(control, className)} {...rest} />
));
Input.displayName = "Input";

export const Select = forwardRef(({ className, children, ...rest }, ref) => (
  <select ref={ref} className={classNames(control, "pr-8", className)} {...rest}>
    {children}
  </select>
));
Select.displayName = "Select";

export const Textarea = ({ className, ...rest }) => (
  <textarea className={classNames(control, "leading-6", className)} {...rest} />
);

/** Etykieta nad polem, podpowiedź i błąd pod nim. Etykieta jest elementem
 *  <label>, więc kliknięcie w napis ustawia kursor w polu. */
export const Field = ({ label, hint, error, htmlFor, className, children }) => (
  <div className={classNames("flex flex-col gap-1", className)}>
    {label && (
      <label htmlFor={htmlFor} className="text-xs font-semibold uppercase tracking-signage text-muted">
        {label}
      </label>
    )}
    {children}
    {hint && !error && <p className="text-xs text-muted">{hint}</p>}
    {error && <p className="text-xs text-danger-strong">{error}</p>}
  </div>
);

export default Field;
