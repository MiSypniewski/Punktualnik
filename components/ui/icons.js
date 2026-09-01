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

// Kłódka — przypięty kafelek "Wznów" (pages/zadania/index.js). Zamknięta znaczy
// "stoi na stałe", otwarta "kliknij, żeby przypiąć". Rozróżnienie niesie sam
// pałąk, bo korpus obu jest ten sam: zamknięty pałąk siedzi na korpusie,
// otwarty jest odchylony w bok.
export const LockIcon = (props) => (
  <Icon {...props}>
    <path d="M3.5 7.5h9v6h-9z" />
    <path d="M5.5 7.5V5a2.5 2.5 0 015 0v2.5" />
  </Icon>
);

export const LockOpenIcon = (props) => (
  <Icon {...props}>
    <path d="M3.5 7.5h9v6h-9z" />
    <path d="M5.5 7.5V5a2.5 2.5 0 014.9-.6" />
  </Icon>
);

// Kolejność przypiętych kafelków przestawia się strzałkami, a nie
// przeciąganiem: panel bywa otwierany na telefonie, a drag&drop na ekranie
// dotykowym walczy o gest z przewijaniem strony.
export const ArrowUpIcon = (props) => (
  <Icon {...props}>
    <path d="M8 12.5V3.5M4.5 7L8 3.5 11.5 7" />
  </Icon>
);

export const ArrowDownIcon = (props) => (
  <Icon {...props}>
    <path d="M8 3.5v9M4.5 9L8 12.5 11.5 9" />
  </Icon>
);

export default Icon;
