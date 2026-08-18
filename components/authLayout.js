import Logo from "./logo";
import ThemeToggle from "./themeToggle";
import Plate from "./ui/plate";

// Powłoka ekranów sprzed zalogowania. Nie ma tu paska stacyjnego, bo nie ma
// jeszcze dokąd nawigować — zostaje znak, przełącznik motywu (żeby dało się
// wejść w ciemny motyw PRZED zalogowaniem; dotąd nie było na to sposobu)
// i jedna płyta z treścią.
export default function AuthLayout({ title, description, children, footer }) {
  return (
    <div className="min-h-screen flex flex-col">
      <div className="flex items-center justify-between gap-3 px-4 h-14">
        <Logo href={null} />
        <ThemeToggle />
      </div>

      <main className="flex-grow flex items-start sm:items-center justify-center px-4 py-6 sm:py-10">
        <div className="w-full max-w-narrow">
          <Plate className="p-5 sm:p-8">
            <h1 className="text-lg font-bold uppercase tracking-signage">{title}</h1>
            {description && <p className="mt-1.5 text-sm text-muted">{description}</p>}
            <div className="mt-6">{children}</div>
          </Plate>
          {footer && <div className="mt-4 text-center text-sm text-muted">{footer}</div>}
        </div>
      </main>

      <footer className="px-4 py-3 text-center text-xs text-faint">
        <span className="uppercase tracking-signage">Punktualnik</span>
      </footer>
    </div>
  );
}
