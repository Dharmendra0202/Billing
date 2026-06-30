import { Calculator, Columns3, Plus, Rows3, Trash2 } from "lucide-react";
import type { BillTable } from "../types";
import { columnTotal, makeId, money } from "../lib/billMath";

type Props = {
  table: BillTable;
  tables: BillTable[];
  onChange: (table: BillTable) => void;
  onDelete: () => void;
};

export function BillTableEditor({ table, tables, onChange, onDelete }: Props) {
  const updateCell = (rowId: string, columnId: string, value: string) => {
    onChange({
      ...table,
      rows: table.rows.map((row) =>
        row.id === rowId ? { ...row, cells: { ...row.cells, [columnId]: value } } : row
      )
    });
  };

  const addRow = () => {
    const cells = Object.fromEntries(table.columns.map((column) => [column.id, column.kind === "number" ? "0" : ""]));
    onChange({ ...table, rows: [...table.rows, { id: makeId("row"), cells }] });
  };

  const addColumn = (kind: "text" | "number" = "text") => {
    const label = `Column ${table.columns.length + 1}`;
    const id = makeId("col");
    onChange({
      ...table,
      columns: [...table.columns, { id, label, kind }],
      rows: table.rows.map((row) => ({ ...row, cells: { ...row.cells, [id]: kind === "number" ? "0" : "" } }))
    });
  };

  const removeColumn = (columnId: string) => {
    if (table.columns.length === 1) return;
    onChange({
      ...table,
      columns: table.columns.filter((column) => column.id !== columnId),
      rows: table.rows.map((row) => {
        const { [columnId]: _removed, ...cells } = row.cells;
        return { ...row, cells };
      })
    });
  };

  const numberColumns = table.columns.filter((column) => column.kind === "number");

  return (
    <section className="tableEditor">
      <div className="tableToolbar">
        <input
          className="tableTitle"
          value={table.title}
          onChange={(event) => onChange({ ...table, title: event.target.value })}
        />
        <div className="toolbarActions">
          <button className="textButton" onClick={() => addColumn()}>
            <Columns3 size={16} /> Column
          </button>
          <button className="textButton" onClick={() => addColumn("number")}>
            <Calculator size={16} /> Formula
          </button>
          <button className="textButton" onClick={addRow}>
            <Rows3 size={16} /> Row
          </button>
          <button className="iconButton danger" onClick={onDelete} title="Delete table">
            <Trash2 size={17} />
          </button>
        </div>
      </div>

      <div className="formulaHelp">
        <Calculator size={16} />
        <span>
          Use formulas inside number cells: <code>=qty*rate</code>, <code>=SUM(amount)</code>,{" "}
          <code>=A.amount-Advance.amount</code>
        </span>
      </div>

      <div className="gridWrap">
        <table className="entryTable">
          <thead>
            <tr>
              {table.columns.map((column) => (
                <th key={column.id}>
                  <div className="columnHeader">
                    <input
                      value={column.label}
                      onChange={(event) =>
                        onChange({
                          ...table,
                          columns: table.columns.map((item) =>
                            item.id === column.id ? { ...item, label: event.target.value } : item
                          )
                        })
                      }
                    />
                    <select
                      value={column.kind}
                      onChange={(event) =>
                        onChange({
                          ...table,
                          columns: table.columns.map((item) =>
                            item.id === column.id ? { ...item, kind: event.target.value as "text" | "number" } : item
                          )
                        })
                      }
                    >
                      <option value="text">Text</option>
                      <option value="number">Number</option>
                    </select>
                    <button className="miniButton" onClick={() => removeColumn(column.id)} title="Remove column">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row) => (
              <tr key={row.id}>
                {table.columns.map((column) => (
                  <td key={column.id}>
                    <input
                      type="text"
                      inputMode={column.kind === "number" ? "decimal" : "text"}
                      value={row.cells[column.id] ?? ""}
                      onChange={(event) => updateCell(row.id, column.id, event.target.value)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="totalsStrip">
        {numberColumns.map((column) => (
          <span key={column.id}>
            {column.label}: <strong>{money(columnTotal(table, column.id, tables))}</strong>
          </span>
        ))}
        <button className="textButton" onClick={addRow}>
          <Plus size={16} /> Add row
        </button>
      </div>
    </section>
  );
}
