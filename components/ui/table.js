import classNames from "classnames";

// Tabela w duchu tablicy odjazdów: nagłówki wersalikami, włosowe linie,
// liczby monospace wyrównane do prawej. Dotąd `Th`/`Td` żyły lokalnie
// w pages/zadania/zarzadzaj.js, a pozostałe pięć tabel składało klasy od zera.

/** Owijka z przewijaniem w poziomie — tabela nigdy nie rozpycha strony. */
export const TableWrap = ({ className, children }) => (
  <div className={classNames("overflow-x-auto", className)}>{children}</div>
);

export const Table = ({ className, children, ...rest }) => (
  <table className={classNames("w-full text-sm", className)} {...rest}>
    {children}
  </table>
);

export const Th = ({ align = "left", className, children, ...rest }) => (
  <th
    scope="col"
    className={classNames(
      "py-2 pr-3 text-xs font-semibold uppercase tracking-signage text-muted border-b border-line whitespace-nowrap",
      align === "right" ? "text-right" : "text-left",
      className
    )}
    {...rest}
  >
    {children}
  </th>
);

export const Td = ({ className, children, ...rest }) => (
  <td className={classNames("py-2 pr-3 align-top", className)} {...rest}>
    {children}
  </td>
);

/** Komórka liczbowa: monospace, cyfry tabelaryczne, do prawej, bez łamania. */
export const Num = ({ className, children, ...rest }) => (
  <Td className={classNames("font-mono tabular-nums text-right whitespace-nowrap", className)} {...rest}>
    {children}
  </Td>
);

export const Tr = ({ className, children, ...rest }) => (
  <tr className={classNames("border-b border-line-subtle", className)} {...rest}>
    {children}
  </tr>
);

export default Table;
