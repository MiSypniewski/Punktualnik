import classNames from "classnames";

// Nagłówek strony: belka w kolorze atramentu (ta sama forma co bursztynowa
// belka w znaku, ale neutralna — bursztyn zostaje przy stanie „teraz”),
// tytuł wersalikami, pod nim jedno zdanie kontekstu, po prawej miejsce
// na działania strony.
const PageHeader = ({ title, description, actions, className }) => (
  <div className={classNames("mb-6 flex flex-wrap items-start justify-between gap-x-4 gap-y-3", className)}>
    <div className="flex items-start gap-3 min-w-0">
      <span aria-hidden="true" className="mt-1 block w-1 h-6 rounded-sm bg-accent shrink-0" />
      <div className="min-w-0">
        <h1 className="text-xl sm:text-2xl font-bold uppercase tracking-signage leading-tight">{title}</h1>
        {description && <p className="mt-1.5 text-sm text-muted">{description}</p>}
      </div>
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
  </div>
);

export default PageHeader;
