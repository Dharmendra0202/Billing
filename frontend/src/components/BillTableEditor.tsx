import { useState } from "react";
import { Calculator, Columns3, Plus, Rows3, Trash2, Ruler, Bold } from "lucide-react";
import type { BillTable } from "../types";
import { columnTotal, makeId, money, parseSize } from "../lib/billMath";
import { convertSizeDisplay } from "./BillPreview";

type Props = {
  table: BillTable;
  tables: BillTable[];
  onChange: (table: BillTable) => void;
  onDelete: () => void;
  onAddTable?: () => void;
};

function recalcRowCells(
  cells: Record<string, string>,
  columns: BillTable["columns"],
  applyInch: boolean
): Record<string, string> {
  const newCells = { ...cells };
  const sizeCol = columns.find(c => c.label.toLowerCase().includes("size") || c.id === "size");
  const qtyCol = columns.find(c => c.label.toLowerCase().includes("qty") || c.label.toLowerCase().includes("quantity") || c.id === "quantity");
  const rateCol = columns.find(c => c.label.toLowerCase().includes("rate") || c.id === "rate");
  const amtCol = columns.find(c => c.label.toLowerCase().includes("amount") || c.id === "amount");

  if (sizeCol && newCells[sizeCol.id]) {
    const parsedQty = parseSize(newCells[sizeCol.id], applyInch);
    if (qtyCol) {
      newCells[qtyCol.id] = String(parsedQty);
    }
  }

  if (qtyCol && rateCol && amtCol) {
    const q = parseFloat(newCells[qtyCol.id] || "0") || 0;
    const r = parseFloat(newCells[rateCol.id] || "0") || 0;
    newCells[amtCol.id] = String(Math.round(q * r * 100) / 100);
  }

  return newCells;
}

// Check if a column is the Sr. No column
function isSrColumn(col: { id: string; label: string }): boolean {
  const id = col.id.toLowerCase();
  const label = col.label.toLowerCase();
  return id === "sr" || label.includes("sr") || label.includes("s.no") || label.includes("s. no") || label === "no" || label === "no.";
}

// Auto-number Sr. No cells in all rows
function autoNumberSr(rows: BillTable["rows"], columns: BillTable["columns"]): BillTable["rows"] {
  const srCol = columns.find(c => isSrColumn(c));
  if (!srCol) return rows;
  return rows.map((row, idx) => ({
    ...row,
    cells: { ...row.cells, [srCol.id]: String(idx + 1) }
  }));
}

export function BillTableEditor({ table, tables, onChange, onDelete, onAddTable }: Props) {
  const isManual = (table.mode ?? "template") === "manual";
  const applyInch = !isManual;
  const [selectedRowId, setSelectedRowId] = useState<string | null>(table.rows[0]?.id ?? null);
  const selectedRow = table.rows.find(r => r.id === selectedRowId);

  const updateCell = (rowId: string, columnId: string, value: string) => {
    const updatedRows = table.rows.map((row) => {
      if (row.id !== rowId) return row;
      const baseCells = { ...row.cells, [columnId]: value };
      const finalCells = recalcRowCells(baseCells, table.columns, applyInch);
      return { ...row, cells: finalCells };
    });
    onChange({
      ...table,
      rows: autoNumberSr(updatedRows, table.columns)
    });
  };

  const toggleMode = () => {
    const nextManual = !isManual;
    const nextApplyInch = !nextManual;
    onChange({
      ...table,
      mode: nextManual ? "manual" : "template",
      rows: table.rows.map((row) => ({
        ...row,
        cells: recalcRowCells(row.cells, table.columns, nextApplyInch)
      }))
    });
  };

  const toggleBold = () => {
    if (!selectedRowId) return;
    onChange({
      ...table,
      rows: table.rows.map(r => {
        if (r.id !== selectedRowId) return r;
        const currentBold = r.cells.bold === "true";
        return { ...r, cells: { ...r.cells, bold: currentBold ? "false" : "true" } };
      })
    });
  };

  const changeFontSize = (delta: number) => {
    if (!selectedRowId) return;
    onChange({
      ...table,
      rows: table.rows.map(r => {
        if (r.id !== selectedRowId) return r;
        const currentFs = parseInt(r.cells.fontSize || "13") || 13;
        const nextFs = Math.max(9, Math.min(24, currentFs + delta));
        return { ...r, cells: { ...r.cells, fontSize: String(nextFs) } };
      })
    });
  };

  const changeAlign = (align: "left" | "center" | "right") => {
    if (!selectedRowId) return;
    onChange({
      ...table,
      rows: table.rows.map(r => {
        if (r.id !== selectedRowId) return r;
        return { ...r, cells: { ...r.cells, align } };
      })
    });
  };

  const addRow = () => {
    const cells = Object.fromEntries(table.columns.map((column) => [column.id, column.kind === "number" ? "0" : ""]));
    const newId = makeId("row");
    const newRows = [...table.rows, { id: newId, cells }];
    onChange({ ...table, rows: autoNumberSr(newRows, table.columns) });
    setSelectedRowId(newId);
  };

  const deleteRow = (rowId: string) => {
    if (table.rows.length === 1) return;
    const filtered = table.rows.filter(r => r.id !== rowId);
    onChange({
      ...table,
      rows: autoNumberSr(filtered, table.columns)
    });
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

  const changePage = (delta: number) => {
    const currentPage = table.page ?? 1;
    const next = Math.max(1, currentPage + delta);
    onChange({ ...table, page: next });
  };

  const numberColumns = table.columns.filter((column) => column.kind === "number");
  const isRowBold = selectedRow?.cells.bold === "true";
  const rowFs = parseInt(selectedRow?.cells.fontSize || "13") || 13;
  const rowAlign = selectedRow?.cells.align || "left";

  return (
    <section className="tableEditor" style={{ marginBottom: 20 }}>
      {/* ── Per-Row Formatting Bar ────────────────────────────────────────── */}
      <div className="formattingToolbar" style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: "#f8fafc", borderRadius: 6, marginBottom: 12, border: "1px solid #e2e8f0" }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "#64748b" }}>
          {selectedRowId ? "Select a row to format" : "Select a row"}
        </span>
        <button
          className={`miniBtn ${isRowBold ? "active" : ""}`}
          onClick={toggleBold}
          disabled={!selectedRowId}
          title="Toggle Bold"
          style={{ fontWeight: "bold", padding: "2px 8px" }}
        >
          <Bold size={13} />
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 2, background: "#fff", border: "1px solid #cbd5e1", borderRadius: 4, padding: "1px 4px" }}>
          <button style={{ border: "none", background: "none", cursor: "pointer" }} onClick={() => changeFontSize(-1)} disabled={!selectedRowId}>-</button>
          <span style={{ fontSize: 11, minWidth: 28, textAlign: "center" }}>{rowFs}px</span>
          <button style={{ border: "none", background: "none", cursor: "pointer" }} onClick={() => changeFontSize(1)} disabled={!selectedRowId}>+</button>
        </div>
        <div style={{ display: "flex", gap: 2 }}>
          {(["left", "center", "right"] as const).map(alignVal => (
            <button
              key={alignVal}
              className={`miniBtn ${rowAlign === alignVal ? "active" : ""}`}
              onClick={() => changeAlign(alignVal)}
              disabled={!selectedRowId}
              style={{ padding: "2px 6px", fontSize: 11 }}
            >
              {alignVal === "left" ? "L" : alignVal === "center" ? "C" : "R"}
            </button>
          ))}
        </div>
        {onAddTable && (
          <button className="primaryButton" style={{ marginLeft: "auto", minHeight: 30, padding: "0 10px", fontSize: 12 }} onClick={onAddTable}>
            <Plus size={14} /> Add Table
          </button>
        )}
      </div>

      <div className="tableToolbar">
        <input
          className="tableTitle"
          value={table.title}
          onChange={(event) => onChange({ ...table, title: event.target.value })}
          placeholder="Table label (optional) — e.g. Master Bedroom"
        />
        <div className="toolbarActions">
          <div className="pageStepper" title="Page printing page number">
            <button onClick={() => changePage(-1)}>-</button>
            <span>Page {table.page ?? 1}</span>
            <button onClick={() => changePage(1)}>+</button>
          </div>
          <button
            className={`modeToggleBtn ${isManual ? "manual" : "template"}`}
            onClick={toggleMode}
            title={isManual
              ? "Manual mode: sizes are plain numbers / math (no inch conversion). Click to switch to Template mode."
              : "Template mode: inch chart applies (e.g. .6 → .50). Click to switch to Manual mode."}
          >
            {isManual ? <Calculator size={13} /> : <Ruler size={13} />}
            {isManual ? "Manual" : "Template"}
          </button>
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
                    <button className="miniButton" onClick={() => removeColumn(column.id)} title="Remove column">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </th>
              ))}
              <th style={{ width: 36 }}></th>
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, rowIndex) => {
              const isRowSelected = row.id === selectedRowId;
              const isBold = row.cells.bold === "true";
              const fontSize = row.cells.fontSize ? `${row.cells.fontSize}px` : "13px";
              const textAlign = (row.cells.align as any) || "left";

              return (
                <tr key={row.id} style={{ background: isRowSelected ? "#f1f5f9" : undefined }}>
                  {table.columns.map((column) => {
                    const isSizeCol = column.label.toLowerCase().includes("size") || column.id === "size";
                    const isPartCol = column.label.toLowerCase().includes("particular") || column.id === "particulars";
                    const isSr = isSrColumn(column);
                    const cellVal = row.cells[column.id] ?? "";

                    if (isSr) {
                      return (
                        <td key={column.id}>
                          <input
                            type="text"
                            value={rowIndex + 1}
                            readOnly
                            tabIndex={-1}
                            onFocus={() => setSelectedRowId(row.id)}
                            style={{ width: 36, textAlign: "center", background: "transparent", cursor: "default" }}
                          />
                        </td>
                      );
                    }

                    return (
                      <td key={column.id}>
                        <input
                          type="text"
                          inputMode={column.kind === "number" ? "decimal" : "text"}
                          value={cellVal}
                          onFocus={() => setSelectedRowId(row.id)}
                          onChange={(event) => updateCell(row.id, column.id, event.target.value)}
                          style={{
                            fontWeight: isPartCol && isBold ? "bold" : "normal",
                            fontSize: isPartCol ? fontSize : "13px",
                            textAlign: isPartCol ? textAlign : (column.kind === "number" ? "right" : "left")
                          }}
                        />
                        {isSizeCol && !isManual && cellVal.trim() !== "" && (() => {
                          const { original, converted, value: calculatedVal } = convertSizeDisplay(cellVal, true);
                          if (!converted && calculatedVal === 1) return null;
                          return (
                            <div style={{ fontSize: 11, color: "#2563eb", fontStyle: "italic", marginTop: 2 }}>
                              → {converted || original} = {calculatedVal}
                            </div>
                          );
                        })()}
                      </td>
                    );
                  })}
                  <td style={{ width: 36, textAlign: "center" }}>
                    <button className="miniButton danger" onClick={() => deleteRow(row.id)} title="Delete row">
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              );
            })}
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
