import { FileSpreadsheet, FileText, FilePlus2, RotateCcw, Save, Scan, Database } from "lucide-react";
import { useMemo, useState } from "react";
import { AIChat } from "./components/AIChat";
import { BillPreview } from "./components/BillPreview";
import { BillScanner } from "./components/BillScanner";
import { HeaderEditor } from "./components/HeaderEditor";
import { SupabaseSyncManager } from "./components/SupabaseSyncManager";
import { initialBillDetails, initialHeader, initialTables } from "./data/initialBill";
import { money, parseSize } from "./lib/billMath";
import { exportProfessionalPDF, exportProfessionalExcel, exportProfessionalWord } from "./lib/documentExport";
import { convertAllPointValues } from "./lib/inchConversion";
import type { BillDetails, BillTable, HeaderTemplate } from "./types";

// Convert editor rows → BillTable for export (all 6 columns)
function toBillTable(rows: EditorRow[]): BillTable {
  return {
    id: "table-main",
    title: "Bill Items",
    columns: [
      { id: "sr",          label: "Sr. No",      kind: "number" },
      { id: "particulars", label: "Particulars", kind: "text"   },
      { id: "size",        label: "Size",        kind: "text"   },
      { id: "quantity",    label: "Quantity",    kind: "number" },
      { id: "rate",        label: "Rate",        kind: "number" },
      { id: "amount",      label: "Amount",      kind: "number" }
    ],
    rows: rows.map(r => ({
      id: r.id,
      cells: {
        sr:          String(r.sr),
        particulars: r.particulars,
        size:        r.size,
        quantity:    String(r.quantity),
        rate:        String(r.rate),
        amount:      String(r.amount),
        bold:        String(r.bold || false),
        fontSize:    String(r.fontSize || 11),
        align:       r.align || "left"
      }
    }))
  };
}

// ── Inline table row type for center panel ──────────────────────────────────
type EditorRow = {
  id: string;
  sr: number;
  particulars: string;
  size: string;
  quantity: number;
  rate: number;
  amount: number;
  bold?: boolean;
  fontSize?: number;
  align?: "left" | "center" | "right";
};

function recalc(rows: EditorRow[]): EditorRow[] {
  return rows.map((r, i) => {
    const amt = Math.round(r.quantity * r.rate * 100) / 100;
    return { ...r, sr: i + 1, amount: amt };
  });
}



function uid() { return Math.random().toString(36).slice(2, 9); }

const defaultRows = (): EditorRow[] => [
  { id: uid(), sr: 1, particulars: "", size: "", quantity: 1, rate: 0, amount: 0, bold: false, fontSize: 11, align: "left" }
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
  const [leftTab, setLeftTab] = useState<"details" | "scanner">("details");
  const [dbPanelOpen, setDbPanelOpen] = useState(false);
  const [leftWidth, setLeftWidth] = useState(320);
  const [rightWidth, setRightWidth] = useState(400);
  const [isResizingLeft, setIsResizingLeft] = useState(false);
  const [isResizingRight, setIsResizingRight] = useState(false);

  const startResizingLeft = (mouseDownEvent: React.MouseEvent) => {
    mouseDownEvent.preventDefault();
    setIsResizingLeft(true);
    const startX = mouseDownEvent.clientX;
    const startWidth = leftWidth;

    const handleMouseMove = (mouseMoveEvent: MouseEvent) => {
      const deltaX = mouseMoveEvent.clientX - startX;
      const newWidth = Math.max(240, Math.min(500, startWidth + deltaX));
      setLeftWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizingLeft(false);
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  const startResizingRight = (mouseDownEvent: React.MouseEvent) => {
    mouseDownEvent.preventDefault();
    setIsResizingRight(true);
    const startX = mouseDownEvent.clientX;
    const startWidth = rightWidth;

    const handleMouseMove = (mouseMoveEvent: MouseEvent) => {
      const deltaX = startX - mouseMoveEvent.clientX;
      const newWidth = Math.max(300, Math.min(600, startWidth + deltaX));
      setRightWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizingRight(false);
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

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
    setRows(prev => [...prev, { id: uid(), sr: prev.length + 1, particulars: "", size: "", quantity: 1, rate: 0, amount: 0, bold: false, fontSize: 11, align: "left" }]);
  };

  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);

  const toggleBold = () => {
    if (!selectedRowId) return;
    setRows(prev => prev.map(r => r.id === selectedRowId ? { ...r, bold: !r.bold } : r));
  };

  const adjustFontSize = (delta: number) => {
    if (!selectedRowId) return;
    setRows(prev => prev.map(r => {
      if (r.id !== selectedRowId) return r;
      const currentSize = r.fontSize || 11;
      const newSize = Math.max(8, Math.min(24, currentSize + delta));
      return { ...r, fontSize: newSize };
    }));
  };

  const changeAlignment = (alignment: "left" | "center" | "right") => {
    if (!selectedRowId) return;
    setRows(prev => prev.map(r => r.id === selectedRowId ? { ...r, align: alignment } : r));
  };

  const updateRow = (id: string, field: keyof EditorRow, value: string | number) => {
    setRows(prev => {
      const updated = prev.map(r => {
        if (r.id !== id) return r;
        const next = { ...r, [field]: value };
        if (field === "size") {
          next.quantity = parseSize(next.size);
        }
        return next;
      });
      if (field === "amount") return updated.map((r, i) => ({ ...r, sr: i + 1 }));
      return recalc(updated);
    });
  };

  const deleteRow = (id: string) => {
    setRows(prev => recalc(prev.filter(r => r.id !== id)));
    if (selectedRowId === id) setSelectedRowId(null);
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
    <div className="appShell" style={{ gridTemplateColumns: `${leftWidth}px 6px 1fr 6px ${rightWidth}px` }}>
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
          <button className="hdrBtn" onClick={() => setDbPanelOpen(true)} title="Cloud Database">
            <Database size={16} /> Cloud Db
          </button>
          <button className="hdrBtn" onClick={() => setLeftTab("scanner")}>
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

        <div className="leftPanelTabs">
          <button 
            className={`leftPanelTab ${leftTab === "details" ? "active" : ""}`}
            onClick={() => setLeftTab("details")}
          >
            Bill Details
          </button>
          <button 
            className={`leftPanelTab ${leftTab === "scanner" ? "active" : ""}`}
            onClick={() => setLeftTab("scanner")}
          >
            Scanner
          </button>
        </div>

        {leftTab === "details" ? (
          <div className="leftPanelContent">
            {/* Bill Details Form */}
            <div className="card billDetailsForm">
              <div className="cardHeader">
                <span className="cardTitle">Bill Details</span>
              </div>

              <label>
                Date
                <input type="text" value={billDetails.date} onChange={e => updateDetail("date", e.target.value)} />
              </label>
              
              {billDetails.showClientDetails !== false && (
                <>
                  <label>
                    Client Name (To)
                    <input value={billDetails.clientName} onChange={e => updateDetail("clientName", e.target.value)} placeholder="Client / Party name" />
                  </label>
                  {(billDetails.showClientAddress !== false) && (
                    <label>
                      Client Address
                      <textarea value={billDetails.clientAddress} onChange={e => updateDetail("clientAddress", e.target.value)} placeholder="Client address" style={{ minHeight: 54 }} />
                    </label>
                  )}
                </>
              )}

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
                <input type="checkbox" checked={billDetails.showClientDetails !== false} onChange={e => updateDetail("showClientDetails", e.target.checked)} />
                Show Client Details (To)
              </label>
              {billDetails.showClientDetails !== false && (
                <label className="toggleRow" style={{ marginLeft: 16 }}>
                  <input type="checkbox" checked={billDetails.showClientAddress !== false} onChange={e => updateDetail("showClientAddress", e.target.checked)} />
                  Show Client Address
                </label>
              )}
              <label className="toggleRow">
                <input type="checkbox" checked={billDetails.showGST !== false} onChange={e => updateDetail("showGST", e.target.checked)} />
                Show GST Number
              </label>
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
              <label className="toggleRow" style={{ marginBottom: billDetails.showSignature ? 8 : 0 }}>
                <input type="checkbox" checked={billDetails.showSignature} onChange={e => updateDetail("showSignature", e.target.checked)} />
                Show Signature section
              </label>
              {billDetails.showSignature && (
                <label style={{ marginBottom: 0 }}>
                  Proprietor Name
                  <input value={billDetails.proprietorName} onChange={e => updateDetail("proprietorName", e.target.value)} placeholder="Proprietor Name" />
                </label>
              )}
            </div>
          </div>
        ) : (
          <div className="leftPanelScannerWrap">
            <BillScanner 
              header={header} 
              onHeaderChange={setHeader} 
              rows={rows}
              onRowsChange={setRows}
              billDetails={billDetails}
              onBillDetailsChange={setBillDetails}
              onClose={() => setLeftTab("details")} 
            />
          </div>
        )}
      </aside>

      <div className={`resizerHandle ${isResizingLeft ? "resizing" : ""}`} onMouseDown={startResizingLeft} />

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

            <div className="tableFormattingToolbar">
              <button 
                className={`formattingBtn ${selectedRowId && rows.find(r => r.id === selectedRowId)?.bold ? 'active' : ''}`}
                onClick={toggleBold}
                disabled={!selectedRowId}
                title="Bold (Ctrl+B)"
              >
                <strong>B</strong>
              </button>
              
              <div className="fontSizeControls">
                <button onClick={() => adjustFontSize(-1)} disabled={!selectedRowId} title="Decrease Font Size">-</button>
                <span className="fontSizeDisplay">
                  {selectedRowId ? (rows.find(r => r.id === selectedRowId)?.fontSize || 11) : 11}px
                </span>
                <button onClick={() => adjustFontSize(1)} disabled={!selectedRowId} title="Increase Font Size">+</button>
              </div>
              
              <div className="alignmentControls">
                {(["left", "center", "right"] as const).map(alignVal => (
                  <button
                    key={alignVal}
                    className={`formattingBtn ${selectedRowId && rows.find(r => r.id === selectedRowId)?.align === alignVal ? 'active' : ''}`}
                    onClick={() => changeAlignment(alignVal)}
                    disabled={!selectedRowId}
                    title={`Align ${alignVal}`}
                  >
                    {alignVal === "left" ? "L" : alignVal === "center" ? "C" : "R"}
                  </button>
                ))}
              </div>
            </div>

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
                  <th style={{ width: 100 }} className="thRight">Quantity</th>
                  <th style={{ width: 100 }} className="thCenter">Rate</th>
                  <th style={{ width: 110 }} className="thCenter">Amount</th>
                  <th style={{ width: 36 }}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.id} style={{ background: selectedRowId === row.id ? "#f8fafc" : undefined }}>
                    <td className="tdCenter">
                      <input className="billCell" style={{ width: 36, textAlign: "center" }} value={row.sr} readOnly tabIndex={-1} onFocus={() => setSelectedRowId(row.id)} />
                    </td>
                    <td>
                      <input
                        className="billCell"
                        value={row.particulars}
                        onChange={e => updateRow(row.id, "particulars", e.target.value)}
                        placeholder="Description of work / material…"
                        onFocus={() => setSelectedRowId(row.id)}
                        style={{
                          fontWeight: row.bold ? "bold" : "normal",
                          fontSize: row.fontSize ? `${row.fontSize}px` : "13px",
                          textAlign: row.align || "left"
                        }}
                      />
                    </td>
                    <td>
                      <input
                        className="billCell"
                        value={row.size}
                        onChange={e => updateRow(row.id, "size", e.target.value)}
                        placeholder="e.g. 3x4 or 12"
                        onFocus={() => setSelectedRowId(row.id)}
                      />
                      {row.size.trim() && (() => {
                        const converted = convertAllPointValues(row.size);
                        const parsed = parseSize(row.size);
                        const changed = converted !== row.size;
                        return (
                          <small className="sizeHint">
                            {changed && <span style={{ color: "#1a56db" }}>→ {converted} </span>}
                            {/[+\-*/x*×]/i.test(row.size) && <span>= {parsed}</span>}
                          </small>
                        );
                      })()}
                    </td>
                    <td className="tdRight">
                      <input
                        className="billCell"
                        style={{ textAlign: "right" }}
                        type="number"
                        min={0}
                        value={row.quantity || ""}
                        onChange={e => updateRow(row.id, "quantity", parseFloat(e.target.value) || 0)}
                        placeholder="0"
                        onFocus={() => setSelectedRowId(row.id)}
                      />
                    </td>
                    <td className="tdCenter">
                      <input
                        className="billCell"
                        style={{ textAlign: "center" }}
                        type="number"
                        min={0}
                        value={row.rate || ""}
                        onChange={e => updateRow(row.id, "rate", parseFloat(e.target.value) || 0)}
                        placeholder="0"
                        onFocus={() => setSelectedRowId(row.id)}
                      />
                    </td>
                    <td className="tdAmount">
                      <input
                        className="billCell"
                        style={{ textAlign: "center", background: "transparent" }}
                        type="number"
                        min={0}
                        value={row.amount || ""}
                        onChange={e => updateRow(row.id, "amount", parseFloat(e.target.value) || 0)}
                        placeholder="0"
                        onFocus={() => setSelectedRowId(row.id)}
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
                  <td colSpan={5} style={{ textAlign: "right", fontWeight: 700 }}>Total</td>
                  <td style={{ textAlign: "right", fontWeight: 700 }}>{money(total)}</td>
                  <td></td>
                </tr>
                <tr className="tfAdvance">
                  <td colSpan={5} style={{ textAlign: "right" }}>
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
                  <td colSpan={5} style={{ textAlign: "right", fontWeight: 700 }}>Balance</td>
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

      <div className={`resizerHandle ${isResizingRight ? "resizing" : ""}`} onMouseDown={startResizingRight} />

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
      {dbPanelOpen && (
        <div className="billScannerOverlay" onClick={e => { if (e.target === e.currentTarget) setDbPanelOpen(false); }}>
          <div className="billScannerModal" style={{ maxWidth: 450 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, borderBottom: "1px solid #e2e8f0", paddingBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Database size={20} style={{ color: "#1e40af" }} />
                <h3 style={{ margin: 0, fontSize: 16, color: "#1e293b" }}>Cloud Database Sync</h3>
              </div>
              <button 
                onClick={() => setDbPanelOpen(false)} 
                style={{ background: "transparent", border: "none", fontSize: 20, cursor: "pointer", color: "#64748b" }}
              >
                &times;
              </button>
            </div>
            <SupabaseSyncManager
              header={header}
              rows={rows}
              billDetails={billDetails}
              billTitle={billTitle}
              onLoadBill={(bill) => {
                setBillTitle(bill.bill_title || "Untitled Bill");
                setHeader(bill.header);
                setRows(bill.rows);
                setBillDetails({
                  clientName: bill.client_name || "",
                  clientAddress: bill.client_address || "",
                  date: bill.date || "",
                  subject: bill.subject || "",
                  advance: Number(bill.advance) || 0,
                  note: bill.note || "",
                  showNote: bill.showNote !== false,
                  showSignature: bill.showSignature !== false,
                  proprietorName: bill.proprietorName || ""
                });
                setDbPanelOpen(false);
              }}
            />
          </div>
        </div>
      )}

      {leftTab !== "scanner" && (
        <button className="billScannerToggle" onClick={() => setLeftTab("scanner")} title="Scan Bill with AI">
          <Scan size={26} />
        </button>
      )}

      <AIChat
        header={header}
        cols={[
          { id: "sr", label: "Sr. No", kind: "number", locked: true },
          { id: "particulars", label: "Particulars", kind: "text", locked: true },
          { id: "size", label: "Size", kind: "text", isSize: true },
          { id: "quantity", label: "Quantity", kind: "number", isQuantity: true },
          { id: "rate", label: "Rate", kind: "number", isRate: true },
          { id: "amount", label: "Amount (₹)", kind: "formula", locked: true, isAmount: true }
        ]}
        rows={rows.map(r => ({
          id: r.id,
          cells: { sr: String(r.sr), particulars: r.particulars, size: r.size, quantity: String(r.quantity), rate: String(r.rate), amount: String(r.amount) }
        }))}
        billDetails={billDetails}
        onHeaderChange={setHeader}
        onColsChange={() => {}}
        onRowsChange={(updaterOrRows) => {
          if (typeof updaterOrRows === "function") {
            setRows(prev => {
              const prevMapped = prev.map(r => ({
                id: r.id,
                cells: { sr: String(r.sr), particulars: r.particulars, size: r.size, quantity: String(r.quantity), rate: String(r.rate), amount: String(r.amount) }
              }));
              const nextMapped = (updaterOrRows as any)(prevMapped);
              return nextMapped.map((r: any) => ({
                id: r.id,
                sr: parseInt(r.cells.sr) || 1,
                particulars: r.cells.particulars || "",
                size: r.cells.size || "",
                quantity: parseFloat(r.cells.quantity) || 0,
                rate: parseFloat(r.cells.rate) || 0,
                amount: parseFloat(r.cells.amount) || 0
              }));
            });
          } else {
            setRows(updaterOrRows.map((r: any) => ({
              id: r.id,
              sr: parseInt(r.cells.sr) || 1,
              particulars: r.cells.particulars || "",
              size: r.cells.size || "",
              quantity: parseFloat(r.cells.quantity) || 0,
              rate: parseFloat(r.cells.rate) || 0,
              amount: parseFloat(r.cells.amount) || 0
            })));
          }
        }}
        onBillDetailsChange={setBillDetails}
      />
    </div>
  );
}
