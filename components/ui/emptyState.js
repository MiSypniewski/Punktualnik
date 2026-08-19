import classNames from "classnames";

// Pusty ekran to zaproszenie do działania, nie komunikat o awarii.
const EmptyState = ({ title, description, action, className }) => (
  <div className={classNames("px-4 py-10 text-center", className)}>
    <p className="text-sm font-semibold uppercase tracking-signage text-muted">{title}</p>
    {description && <p className="mt-2 text-sm text-muted max-w-prose mx-auto">{description}</p>}
    {action && <div className="mt-4 flex justify-center">{action}</div>}
  </div>
);

export default EmptyState;
