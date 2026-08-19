// Wskaźnik oczekiwania w duchu tablicy: cienki pierścień, bez wypełnień
// i bez koloru marki. Ruch wyłącza globalna reguła prefers-reduced-motion.
const Spinner = ({ label = "Ładowanie" }) => (
  <div role="status" className="flex flex-col items-center justify-center gap-3 py-20">
    <svg viewBox="0 0 40 40" className="w-10 h-10 animate-spin text-line-strong" aria-hidden="true">
      <circle cx="20" cy="20" r="17" fill="none" stroke="currentColor" strokeWidth="2.5" opacity="0.3" />
      <path
        d="M20 3a17 17 0 0 1 17 17"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        className="text-signal"
      />
    </svg>
    <p className="text-xs uppercase tracking-signage text-muted">{label}</p>
    <span className="sr-only">{label}…</span>
  </div>
);

export default Spinner;
