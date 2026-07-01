import { FileSpreadsheet, FileText, FilePlus2, RotateCcw, Save, Scan } from "lucide-react";
import { useMemo, useState } from "react";
import { AIChat } from "./components/AIChat";
import { BillPreview } from "./components/BillPreview";
import { BillScanner } from "./components/BillScanner";
import { HeaderEditor } from "./components/HeaderEditor";
import { initialBillDetails, initialHeader, initialTables } from "./data/initialBill";
import { grandTotal, makeId, money } from "./lib/billMath";
import { exportProfessionalPDF, exportProfessionalExcel, exportProfessionalWord } from "./lib/documentExport";
import type { BillDetails, BillTable, HeaderTemplate } from "./types";

// Convert editor rows → BillTable for export (all 5 columns)
function toBillTable(rows: Array<{ id: string; sr: number; particulars: string; size: string; rate: number; amount: number }>): BillTable {
  return {
    id: "table-main",
    title: "Bill Items",
    columns: [
      { id: "sr",          label: "Sr. No",      kind: "number" },
      { id: "particulars", label: "Particulars", kind: "text"   },
      { id: "size",        label: "Size",        kind: "text"   },
      { id: "rate",        label: "Rate",        kind: "number" },
      { id: "amount",      label: "Amount",      kind: "number" }
    ],
    rows: rows.map(r => ({
      id: r.id,
      cells: {
        sr:          String(r.sr),
        particulars: r.particulars,
        size:        r.size,
        rate:        String(r.rate),
        amount:      String(r.amount)
      }
    }))
  };
}

// ── Inline table row type for center panel ──────────────────────────────────
type EditorRow = { id: string; sr: number; particulars: string; size: string; rate: number; amount: number };

function recalc(rows: EditorRow[]): EditorRow[] {
  return rows.map((r, i) => {
    const parsed = parseSize(r.size);
    // always recalculate amount from size × rate (0 if either is empty/zero)
    const amt = Math.round(parsed * r.rate * 100) / 100;
    return { ...r, sr: i + 1, amount: amt };
  });
}

function parseSize(size: string): number {
  const clean = size.trim();
  if (!clean) return 1; // empty size = 1 (so amount = rate directly)
  const parts = clean.split(/[x*×]/i).map(p => parseFloat(p.trim())).filter(n => !isNaN(n));
  if (parts.length >= 2) return parts.reduce((a, b) => a * b, 1);
  return parseFloat(clean) || 1;
}

function uid() { return Math.random().toString(36).slice(2, 9); }

const defaultRows = (): EditorRow[] => [
  { id: uid(), sr: 1, particulars: "", size: "", rate: 0, amount: 0 }
];

export function App() {
  const [header, setHeader] = useState<HeaderTemplate>(() => {
    const saved = localStorage.getItem("bill.header");
    return saved ? JSON.parse(saved) : initialHeader;
  });

  const [billDetails, setBillDetails] = useState<BillDetails>(() => {
    const saved = localStorage.getItem("bill.details");
    return saved ? JSON.parse(saved) : initialBillDetails;
  });

  const [rows, setRows] = useState<EditorRow[]>(() => {
    const saved = localStorage.getItem("bill.rows");
    return saved ? JSON.parse(saved) : defaultRows();
  });

  const [billTitle, setBillTitle] = useState("New Bill");
  const [scannerOpen, setScannerOpen] = useState(false);

  // Legacy tables state for AIChat compatibility
  const [tables, setTables] = useState<BillTable[]>(() => {
    const saved = localStorage.getItem("bill.tables");
    return saved ? JSON.parse(saved) : initialTables;
  });

  const total = useMemo(() => rows.reduce((s, r) => s + r.amount, 0), [rows]);
  const balance = total - billDetails.advance;

  const currentBillTables = useMemo(() => [toBillTable(rows)], [rows]);

  const save = () => {
    localStorage.setItem("bill.header", JSON.stringify(header));
    localStorage.setItem("bill.details", JSON.stringify(billDetails));
    localStorage.setItem("bill.rows", JSON.stringify(rows));
    localStorage.setItem("bill.tables", JSON.stringify(tables));
  };

  const reset = () => {
    if (!confirm("Reset everything to defaults?")) return;
    setHeader(initialHeader);
    setBillDetails(initialBillDetails);
    setRows(defaultRows());
    setTables(initialTables);
    setBillTitle("New Bill");
    localStorage.removeItem("bill.header");
    localStorage.removeItem("bill.details");
    localStorage.removeItem("bill.rows");
    localStorage.removeItem("bill.tables");
  };

  const addRow = () => {
    setRows(prev => [...prev, { id: uid(), sr: prev.length + 1, particulars: "", size: "", rate: 0, amount: 0 }]);
  };

  const updateRow = (id: string, field: keyof EditorRow, value: string | number) => {
    setRows(prev => {
      const updated = prev.map(r => r.id === id ? { ...r, [field]: value } : r);
      // only recalc amount from size×rate when size or rate changes, not when amount itself is edited
      if (field === "amount") return updated.map((r, i) => ({ ...r, sr: i + 1 }));
      return recalc(updated);
    });
  };

  const deleteRow = (id: string) => {
    setRows(prev => recalc(prev.filter(r => r.id !== id)));
  };

  const handleAIUpdate = (newHeader: HeaderTemplate, newTables: BillTable[]) => {
    setHeader(newHeader);
    setTables(newTables);
  };

  const handleExport = async (format: "pdf" | "excel" | "word") => {
    const detailsWithAdvance: BillDetails = { ...billDetails, advance: billDetails.advance };
    const exportTables = currentBillTables;
    if (format === "pdf") await exportProfessionalPDF(header, exportTables, detailsWithAdvance, billTitle);
    else if (format === "excel") await exportProfessionalExcel(header, exportTables, detailsWithAdvance, billTitle);
    else await exportProfessionalWord(header, exportTables, detailsWithAdvance, billTitle);
  };

  const updateDetail = <K extends keyof BillDetails>(key: K, value: BillDetails[K]) => {
    setBillDetails(prev => ({ ...prev, [key]: value }));
  };

  return (
    <div className="appShell">
      {/* ── Top Header Bar ──────────────────────────────────────────────────── */}
      <header className="topHeader">
        <div className="topHeaderBrand">
          <span className="brandIcon">BA</span>
          Bill AI
        </div>
        <div className="topHeaderTitle">
          <input
            value={billTitle}
            onChange={e => setBillTitle(e.target.value)}
            placeholder="Bill title..."
          />
        </div>
        <div className="topHeaderActions">
          <button className="hdrBtn" onClick={() => setScannerOpen(true)}>
            <Scan size={16} /> Scan Bill
          </button>
          <button className="hdrBtn" onClick={reset}>
            <RotateCcw size={15} /> Reset
          </button>
          <button className="hdrBtn primary" onClick={save}>
            <Save size={15} /> Save
          </button>
        </div>
      </header>

      {/* ── Left Panel ──────────────────────────────────────────────────────── */}
      <aside className="leftPanel">
        <HeaderEditor header={header} onChange={setHeader} />

        {/* Bill Details Form */}
        <div className="card billDetailsForm">
          <div className="cardHeader">
            <span className="cardTitle">Bill Details</span>
          </div>

          <label>
            Date
            <input type="text" value={billDetails.date} onChange={e => updateDetail("date", e.target.value)} />
          </label>
          <label>
            Client Name
            <input value={billDetails.clientName} onChange={e => updateDetail("clientName", e.target.value)} placeholder="Client / Party name" />
          </label>
          <label>
            Client Address
            <textarea value={billDetails.clientAddress} onChange={e => updateDetail("clientAddress", e.target.value)} placeholder="Client address" style={{ minHeight: 54 }} />
          </label>
          <label>
            Subject
            <input value={billDetails.subject} onChange={e => updateDetail("subject", e.target.value)} />
          </label>
          <label>
            Advance (₹)
            <input
              type="number"
              min={0}
              value={billDetails.advance || ""}
              onChange={e => updateDetail("advance", parseFloat(e.target.value) || 0)}
              placeholder="0"
            />
          </label>
        </div>

        {/* Toggles */}
        <div className="card">
          <div className="cardHeader">
            <span className="cardTitle">Optional Sections</span>
          </div>
          <label className="toggleRow">
            <input type="checkbox" checked={billDetails.showNote} onChange={e => updateDetail("showNote", e.target.checked)} />
            Show Note section
          </label>
          {billDetails.showNote && (
            <label>
              Note text
              <textarea value={billDetails.note} onChange={e => updateDetail("note", e.target.value)} style={{ minHeight: 54 }} />
            </label>
          )}
          <label className="toggleRow" style={{ marginBottom: 0 }}>
            <input type="checkbox" checked={billDetails.showSignature} onChange={e => updateDetail("showSignature", e.target.checked)} />
            Show Signature section
          </label>
        </div>
      </aside>

      {/* ── Center Panel ────────────────────────────────────────────────────── */}
      <main className="centerPanel">
        <div className="summaryStrip">
          <span>Items: {rows.length}</span>
          <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
            <span>Balance: <strong style={{ color: "#15803d" }}>{money(balance)}</strong></span>
            <span>Total: <strong>{money(total)}</strong></span>
          </div>
        </div>

        <div className="billTableCard">
          <div className="billTableToolbar">
            <span className="billTableTitle">Bill Items</span>
            <button className="primaryButton" style={{ minHeight: 34, padding: "0 12px", fontSize: 13 }} onClick={addRow}>
              <FilePlus2 size={15} /> Add Row
            </button>
          </div>

          <div className="tableWrap">
            <table className="billTable">
              <thead>
                <tr>
                  <th style={{ width: 44 }} className="thCenter">Sr.</th>
                  <th>Particulars</th>
                  <th style={{ width: 120 }}>Size</th>
                  <th style={{ width: 100 }} className="thRight">Rate (₹)</th>
                  <th style={{ width: 110 }} className="thRight">Amount (₹)</th>
                  <th style={{ width: 36 }}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.id}>
                    <td className="tdCenter">
                      <input className="billCell" style={{ width: 36, textAlign: "center" }} value={row.sr} readOnly tabIndex={-1} />
                    </td>
                    <td>
                      <input
                        className="billCell"
                        value={row.particulars}
                        onChange={e => updateRow(row.id, "particulars", e.target.value)}
                        placeholder="Description of work / material…"
                      />
                    </td>
                    <td>
                      <input
                        className="billCell"
                        value={row.size}
                        onChange={e => updateRow(row.id, "size", e.target.value)}
                        placeholder="e.g. 3x4 or 12"
                      />
                    </td>
                    <td className="tdRight">
                      <input
                        className="billCell"
                        style={{ textAlign: "right" }}
                        type="number"
                        min={0}
                        value={row.rate || ""}
                        onChange={e => updateRow(row.id, "rate", parseFloat(e.target.value) || 0)}
                        placeholder="0"
                      />
                    </td>
                    <td className="tdAmount">
                      <input
                        className="billCell"
                        style={{ textAlign: "right", background: "transparent" }}
                        type="number"
                        min={0}
                        value={row.amount || ""}
                        onChange={e => updateRow(row.id, "amount", parseFloat(e.target.value) || 0)}
                        placeholder="0"
                      />
                    </td>
                    <td>
                      <button
                        className="miniButton danger"
                        title="Remove row"
                        onClick={() => deleteRow(row.id)}
                        style={{ fontSize: 16, border: "none" }}
                      >×</button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="tfTotal">
                  <td colSpan={4} style={{ textAlign: "right", fontWeight: 700 }}>Total</td>
                  <td style={{ textAlign: "right", fontWeight: 700 }}>{money(total)}</td>
                  <td></td>
                </tr>
                <tr className="tfAdvance">
                  <td colSpan={4} style={{ textAlign: "right" }}>
                    Advance
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <input
                      className="advanceCellInput"
                      type="number"
                      min={0}
                      value={billDetails.advance || ""}
                      onChange={e => updateDetail("advance", parseFloat(e.target.value) || 0)}
                      placeholder="0"
                    />
                  </td>
                  <td></td>
                </tr>
                <tr className="tfBalance">
                  <td colSpan={4} style={{ textAlign: "right", fontWeight: 700 }}>Balance</td>
                  <td style={{ textAlign: "right", fontWeight: 700 }}>{money(balance)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>

          <button className="addRowBtn" onClick={addRow}>
            <FilePlus2 size={16} /> Add Row
          </button>
        </div>
      </main>

      {/* ── Right Panel ─────────────────────────────────────────────────────── */}
      <aside className="rightPanel">
        <p className="previewLabel">Live Preview</p>

        <div className="previewSheet" id="print-area">
          <BillPreview header={header} rows={rows} billDetails={billDetails} />
        </div>

        <div>
          <p className="previewLabel" style={{ marginBottom: 8 }}>Export</p>
          <div className="exportButtons">
            <button className="exportBtn pdf" onClick={() => handleExport("pdf")}>
              <FileText size={20} /> PDF
            </button>
            <button className="exportBtn excel" onClick={() => handleExport("excel")}>
              <FileSpreadsheet size={20} /> Excel
            </button>
            <button className="exportBtn word" onClick={() => handleExport("word")}>
              <FileText size={20} /> Word
            </button>
          </div>
        </div>
      </aside>

      {/* ── Floating Buttons & Panels ────────────────────────────────────────── */}
      {scannerOpen && (
        <div className="billScannerOverlay" onClick={e => { if (e.target === e.currentTarget) setScannerOpen(false); }}>
          <div className="billScannerModal">
            <BillScanner header={header} onHeaderChange={setHeader} onClose={() => setScannerOpen(false)} />
          </div>
        </div>
      )}
      {!scannerOpen && (
        <button className="billScannerToggle" onClick={() => setScannerOpen(true)} title="Scan Bill with AI">
          <Scan size={26} />
        </button>
      )}

      <AIChat header={header} tables={tables} onUpdate={handleAIUpdate} />
    </div>
  );
}
