import type { BillTable, HeaderTemplate } from "../types";
import { columnTotal, displayValue, grandTotal, money } from "../lib/billMath";

type Props = {
  header: HeaderTemplate;
  tables: BillTable[];
};

export function BillPreview({ header, tables }: Props) {
  return (
    <section className="previewSheet" id="print-area">
      <header className="billHeader">
        {header.logoUrl && <img src={header.logoUrl} alt="" />}
        <div>
          <h1>{header.businessName || "Business Name"}</h1>
          <p>{header.address || "Business address"}</p>
          <p>
            {header.phone && <>Mobile No. {header.phone}</>}
            {header.gstNumber && <> | GST: {header.gstNumber}</>}
          </p>
        </div>
      </header>

      <div className="previewMeta">
        <span>Bill Date: {new Date().toLocaleDateString("en-IN")}</span>
        <span>Bill No: Draft</span>
      </div>

      {tables.map((table) => (
        <div className="previewBlock" key={table.id}>
          <h3>{table.title}</h3>
          <table className="previewTable">
            <thead>
              <tr>
                {table.columns.map((column) => (
                  <th key={column.id}>{column.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row) => (
                <tr key={row.id}>
                  {table.columns.map((column) => (
                    <td key={column.id} className={column.kind === "number" ? "numeric" : ""}>
                      {column.kind === "number"
                        ? money(Number(displayValue(table, row.id, column.id, tables) || 0))
                        : displayValue(table, row.id, column.id, tables)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                {table.columns.map((column, index) => (
                  <td key={column.id} className={column.kind === "number" ? "numeric" : ""}>
                    {column.kind === "number"
                      ? money(columnTotal(table, column.id, tables))
                      : index === 0
                        ? "Total"
                        : ""}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      ))}

      <footer className="grandTotal">
        <span>Total Bill</span>
        <strong>{money(grandTotal(tables))}</strong>
      </footer>
    </section>
  );
}
