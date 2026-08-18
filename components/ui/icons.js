// Ikony rysowane w miejscu, bez biblioteki: aplikacja ma ich dokładnie tyle,
// ile widać poniżej, a każda zależność to kolejne kilobajty w bundlu.
//
// Wszystkie na siatce 16, obrys `currentColor`, grubość 1.5 — dzięki temu
// dziedziczą kolor tekstu i wyglądają jak jedna rodzina. Emoji (▶ ✎ 🗑),
// które tu były wcześniej, renderowały się inaczej w każdym systemie i nie
// dawały się pomalować.
const Icon = ({ children, className = "w-4 h-4" }) => (
  <svg
    viewBox="0 0 16 16"
    className={className}
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

export const PlayIcon = (props) => (
  <Icon {...props}>
    <path d="M5 3.5l7 4.5-7 4.5z" fill="currentColor" stroke="none" />
  </Icon>
);

export const PencilIcon = (props) => (
  <Icon {...props}>
    <path d="M11.2 2.8l2 2L6 12H4v-2z" />
    <path d="M9.8 4.2l2 2" />
  </Icon>
);

export const TrashIcon = (props) => (
  <Icon {...props}>
    <path d="M2.5 4h11M6 4V2.5h4V4M4 4l.6 9h6.8L12 4" />
  </Icon>
);

export const DownloadIcon = (props) => (
  <Icon {...props}>
    <path d="M8 2v8M4.5 7L8 10.5 11.5 7M2.5 13h11" />
  </Icon>
);

export const CheckIcon = (props) => (
  <Icon {...props}>
    <path d="M3 8.5l3.5 3.5L13 4.5" />
  </Icon>
);

export const CloseIcon = (props) => (
  <Icon {...props}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </Icon>
);

export default Icon;
