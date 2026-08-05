import { FileSpreadsheet, FileText, FilePlus2, RotateCcw, Save, Scan, Database, Plus, Trash2, Ruler, Calculator, CheckCircle2, Loader2, SeparatorHorizontal, FolderOpen, PanelLeft } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AIChat } from "./components/AIChat";
import { BillPreview } from "./components/BillPreview";
import { BillScanner } from "./components/BillScanner";
import { HeaderEditor } from "./components/HeaderEditor";
import { BillTableEditor } from "./components/BillTableEditor";
import { SupabaseSyncManager } from "./components/SupabaseSyncManager";
import { initialBillDetails, initialHeader } from "./data/initialBill";
import { money, parseSize, toTitleCase, convertInchesToFeet, convertInchesToFeetDisplay } from "./lib/billMath";
import { exportProfessionalPDF, exportProfessionalExcel, exportProfessionalWord } from "./lib/documentExport";
import { convertAllPointValues } from "./lib/inchConversion";
import { encodeBillMarker, extractBillFromPdf } from "./lib/billFile";
import { defaultColumnLabels, defaultColumnVisibility } from "./types";
import type { BillDetails, BillSection, BillTable, ColumnLabels, ColumnVisibility, EditorRow, HeaderTemplate, BillFormat, BillColumn, BillRow } from "./types";

// Convert a single section's editor rows → BillTable for export
function sectionToBillTable(section: BillSection, format: BillFormat = "standard"): BillTable {
  if (format === "custom") {
    const columns: BillColumn[] = section.columns && section.columns.length > 0
      ? section.columns
      : [
          { id: "sr",          label: "Sr. No",      kind: "number" },
          { id: "particulars", label: "Particulars", kind: "text"   },
          { id: "size",        label: "Size",        kind: "text"   },
          { id: "quantity",    label: "Quantity",    kind: "number" },
          { id: "rate",        label: "Rate",        kind: "number" },
          { id: "amount",      label: "Amount",      kind: "number" }
        ];

    const rows: BillRow[] = section.customRows && section.customRows.length > 0
      ? section.customRows
      : section.rows.map((r, i) => ({
          id: r.id,
          cells: {
            sr:          String(r.sr || i + 1),
            particulars: r.particulars || "",
            size:        r.size || "",
            quantity:    String(r.quantity || 0),
            rate:        String(r.rate || 0),
            amount:      String(r.amount || 0)
          }
        }));

    return {
      id: section.id,
      title: section.title,
      page: section.page,
      mode: section.mode,
      columns,
      rows
    };
  }

  return {
    id: section.id,
    title: section.title,
    page: section.page,
    mode: section.mode,
    columns: [
      { id: "sr",          label: "Sr. No",      kind: "number" },
      { id: "particulars", label: "Particulars", kind: "text"   },
      { id: "size",        label: "Size",        kind: "text"   },
      { id: "quantity",    label: "Quantity",    kind: "number" },
      { id: "rate",        label: "Rate",        kind: "number" },
      { id: "amount",      label: "Amount",      kind: "number" }
    ],
    rows: section.rows.map(r => ({
      id: r.id,
      cells: {
        sr:              String(r.sr),
        particulars:     r.particulars,
        size:            r.size,
        quantity:        String(r.quantity),
        rate:            String(r.rate),
        amount:          String(r.amount),
        labourRate:      String(r.labourRate || 0),
        labourAmount:    String(r.labourAmount || 0),
        materialRate:    String(r.materialRate || 0),
        materialAmount:  String(r.materialAmount || 0),
        bold:            String(r.bold || false),
        fontSize:        String(r.fontSize || 11),
        align:           r.align || "left",
        mode:            r.mode || ""
      }
    }))
  };
}

function recalc(rows: EditorRow[], format: BillFormat = "standard"): EditorRow[] {
  return rows.map((r, i) => {
    const amt = Math.round(r.quantity * r.rate * 100) / 100;
    const labourAmt = Math.round(r.quantity * (r.labourRate || 0) * 100) / 100;
    const materialAmt = Math.round(r.quantity * (r.materialRate || 0) * 100) / 100;
    return {
      ...r,
      sr: i + 1,
      amount: format === "labourMaterial" ? labourAmt : amt,
      labourAmount: labourAmt,
      materialAmount: materialAmt
    };
  });
}

function uid() { return Math.random().toString(36).slice(2, 9); }

const makeRow = (): EditorRow => ({
  id: uid(), sr: 1, particulars: "", size: "", quantity: 1, rate: 0, amount: 0,
  labourRate: 0, labourAmount: 0, materialRate: 0, materialAmount: 0,
  bold: false, fontSize: 11, align: "left"
});

const defaultSections = (): BillSection[] => [
  { id: uid(), title: "", rows: [makeRow()], mode: "template" }
];

// Load persisted sections, migrating from the older single-table `bill.rows` format if needed.
function loadInitialSections(): BillSection[] {
  const savedSections = localStorage.getItem("bill.sections");
  if (savedSections) {
    try {
      const parsed = JSON.parse(savedSections) as BillSection[];
      if (Array.isArray(parsed) && parsed.length) return parsed;
    } catch { /* ignore */ }
  }
  const savedRows = localStorage.getItem("bill.rows");
  if (savedRows) {
    try {
      const rows = JSON.parse(savedRows) as EditorRow[];
      if (Array.isArray(rows) && rows.length) return [{ id: uid(), title: "", rows }];
    } catch { /* ignore */ }
  }
  return defaultSections();
}

type SelectedCell = { sectionId: string; rowId: string } | null;

export function App() {
  const [header, setHeader] = useState<HeaderTemplate>(initialHeader);

  const [billDetails, setBillDetails] = useState<BillDetails>(initialBillDetails);

  const [billFormat, setBillFormat] = useState<BillFormat>("standard");

  const [sections, setSections] = useState<BillSection[]>(defaultSections);

  const [billTitle, setBillTitle] = useState("New Bill");
  const [leftTab, setLeftTab] = useState<"details" | "scanner">("details");
  const [isLeftDrawerOpen, setIsLeftDrawerOpen] = useState(false);
  const [dbPanelOpen, setDbPanelOpen] = useState(false);
  const [leftWidth, setLeftWidth] = useState(320);
  const [rightWidth, setRightWidth] = useState(400);
  const [isResizingLeft, setIsResizingLeft] = useState(false);
  const [isResizingRight, setIsResizingRight] = useState(false);
  const [selectedCell, setSelectedCell] = useState<SelectedCell>(null);
  const [fitToOnePage, setFitToOnePage] = useState(false);
  const [columnLabels, setColumnLabels] = useState<ColumnLabels>(() => {
    const saved = localStorage.getItem("bill.columns");
    if (saved) { try { return { ...defaultColumnLabels, ...JSON.parse(saved) }; } catch { /* ignore */ } }
    return defaultColumnLabels;
  });
  const [columnVisibility, setColumnVisibility] = useState<ColumnVisibility>(defaultColumnVisibility);

  // ── Autosave ────────────────────────────────────────────────────────────────
  // Persist every change immediately so a page refresh (or accidental reload)
  // never loses the work in progress. Restored automatically on next load.
  const updateColumnLabel = (key: keyof ColumnLabels, value: string) => {
    setColumnLabels(prev => ({ ...prev, [key]: value }));
  };

  // Visual feedback only (no persistent autosave — app always starts fresh).
  const [saveState, setSaveState] = useState<"saved" | "saving">("saved");
  useEffect(() => {
    setSaveState("saving");
    const t = setTimeout(() => setSaveState("saved"), 500);
    return () => clearTimeout(t);
  }, [header, billDetails, sections, billTitle, columnLabels]);

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

  // ── Derived totals ────────────────────────────────────────────────────────
  const sectionTotal = (section: BillSection) => {
    if (billFormat === "custom") {
      const table = sectionToBillTable(section, "custom");
      const amountCol = table.columns.find(c => c.label.toLowerCase().includes('amount') || c.kind === 'number');
      if (!amountCol) return 0;
      return table.rows.reduce((sum, r) => sum + (parseFloat(r.cells[amountCol.id]) || 0), 0);
    }
    if (billFormat === "labourMaterial") {
      return section.rows.reduce((s, r) => s + (r.materialAmount || 0), 0);
    }
    return section.rows.reduce((s, r) => s + r.amount, 0);
  };
  const sectionLabourTotal = (section: BillSection) => section.rows.reduce((s, r) => s + (r.labourAmount || 0), 0);
  const total = useMemo(
    () => {
      if (billFormat === "custom") {
        return sections.reduce((s, sec) => s + sectionTotal(sec), 0);
      }
      if (billFormat === "labourMaterial") {
        return sections.reduce((s, section) => s + section.rows.reduce((rs, r) => rs + (r.materialAmount || 0), 0), 0);
      }
      return sections.reduce((s, section) => s + section.rows.reduce((rs, r) => rs + r.amount, 0), 0);
    },
    [sections, billFormat]
  );
  const balance = total - billDetails.advance;
  const totalItems = useMemo(() => sections.reduce((n, s) => n + s.rows.length, 0), [sections]);

  const currentBillTables = useMemo(() => sections.map(s => sectionToBillTable(s, billFormat)), [sections, billFormat]);

  const save = () => {
    localStorage.setItem("bill.header", JSON.stringify(header));
    localStorage.setItem("bill.details", JSON.stringify(billDetails));
    localStorage.setItem("bill.sections", JSON.stringify(sections));
    localStorage.setItem("bill.title", billTitle);
    localStorage.setItem("bill.columns", JSON.stringify(columnLabels));
    // Remove the legacy single-table key so it doesn't shadow the new format.
    localStorage.removeItem("bill.rows");
  };

  const reset = () => {
    if (!confirm("Reset everything to defaults?")) return;
    setHeader(initialHeader);
    setBillDetails(initialBillDetails);
    setSections(defaultSections());
    setSelectedCell(null);
    setBillTitle("New Bill");
    setColumnLabels(defaultColumnLabels);
    localStorage.removeItem("bill.columns");
    localStorage.removeItem("bill.header");
    localStorage.removeItem("bill.details");
    localStorage.removeItem("bill.rows");
    localStorage.removeItem("bill.sections");
    localStorage.removeItem("bill.title");
  };

  // ── Section (table) operations ──────────────────────────────────────────────
  const updateSectionRows = (sectionId: string, updater: (rows: EditorRow[]) => EditorRow[]) => {
    setSections(prev => prev.map(s => (s.id === sectionId ? { ...s, rows: updater(s.rows) } : s)));
  };

  const addTable = () => {
    setSections(prev => {
      // A new table joins the same page as the current last table by default.
      const lastPage = prev.length ? (prev[prev.length - 1].page ?? 1) : 1;
      return [...prev, { id: uid(), title: `Table ${prev.length + 1}`, rows: [makeRow()], mode: "template", page: lastPage }];
    });
  };

  // Switch a table between "template" (inch conversion) and "manual" (plain math),
  // re-computing existing quantities from their Size cells under the new mode.
  const toggleTableMode = (sectionId: string) => {
    setSections(prev => prev.map(s => {
      if (s.id !== sectionId) return s;
      const nextMode: "template" | "manual" = (s.mode ?? "template") === "manual" ? "template" : "manual";
      const applyInch = nextMode !== "manual";
      const rows = recalc(
        s.rows.map(r => ({
          ...r,
          quantity: r.size.trim() ? parseSize(r.size, applyInch) : r.quantity
        })),
        billFormat
      );
      return { ...s, mode: nextMode, rows };
    }));
  };

  const deleteTable = (sectionId: string) => {
    setSections(prev => {
      if (prev.length <= 1) return prev; // keep at least one table
      return prev.filter(s => s.id !== sectionId);
    });
    setSelectedCell(prev => (prev?.sectionId === sectionId ? null : prev));
  };

  const updateTableTitle = (sectionId: string, title: string) => {
    setSections(prev => prev.map(s => (s.id === sectionId ? { ...s, title } : s)));
  };

  // Set which page a table prints on (min 1). Tables with the same number group
  // on one page; a higher number than the previous table starts a new page.
  const setTablePage = (sectionId: string, page: number) => {
    const clamped = Math.max(1, Math.floor(page) || 1);
    setSections(prev => prev.map(s => (s.id === sectionId ? { ...s, page: clamped } : s)));
  };

  const addRow = (sectionId: string) => {
    updateSectionRows(sectionId, rows => recalc([...rows, makeRow()], billFormat));
  };

  // Insert a fresh row immediately below the given row (in-between insert).
  const insertRowBelow = (sectionId: string, rowId: string) => {
    updateSectionRows(sectionId, rows => {
      const index = rows.findIndex(r => r.id === rowId);
      if (index === -1) return recalc([...rows, makeRow()], billFormat);
      const next = [...rows];
      next.splice(index + 1, 0, makeRow());
      return recalc(next, billFormat);
    });
  };

  const deleteRow = (sectionId: string, rowId: string) => {
    updateSectionRows(sectionId, rows => recalc(rows.filter(r => r.id !== rowId), billFormat));
    setSelectedCell(prev => (prev?.rowId === rowId ? null : prev));
  };

  const updateRow = (sectionId: string, rowId: string, field: keyof EditorRow, value: string | number) => {
    const section = sections.find(s => s.id === sectionId);
    const tableMode = section?.mode ?? "template";
    updateSectionRows(sectionId, rows => {
      const updated = rows.map(r => {
        if (r.id !== rowId) return r;
        const next = { ...r, [field]: value } as EditorRow;
        if (field === "size") {
          // Per-row mode overrides the table's mode.
          const rowMode = next.mode ?? tableMode;
          const applyInch = rowMode === "template";
          // If the size contains unit text (RFT, NOS, PCS, LS, etc.), don't
          // auto-calculate quantity — let the user type it manually.
          const hasUnit = /[a-zA-Z]/.test(next.size.replace(/[x×]/gi, ""));
          if (!hasUnit && next.size.trim()) {
            // Keep full precision for accurate calculation.
            // Display rounding happens only in the UI/PDF, not in the stored value.
            next.quantity = parseSize(next.size, applyInch, rowMode);
          }
          // If size is empty, reset quantity to 1 (default).
          if (!next.size.trim()) {
            next.quantity = 1;
          }
        }
        return next;
      });
      if (field === "amount") return updated.map((r, i) => ({ ...r, sr: i + 1 }));
      return recalc(updated, billFormat);
    });
  };

  // ── Row formatting (operates on the currently selected cell) ────────────────
  const selectedRow = useMemo(() => {
    if (!selectedCell) return null;
    return sections.find(s => s.id === selectedCell.sectionId)?.rows.find(r => r.id === selectedCell.rowId) ?? null;
  }, [selectedCell, sections]);

  const toggleBold = () => {
    if (!selectedCell) return;
    updateSectionRows(selectedCell.sectionId, rows =>
      rows.map(r => (r.id === selectedCell.rowId ? { ...r, bold: !r.bold } : r))
    );
  };

  const adjustFontSize = (delta: number) => {
    if (!selectedCell) return;
    updateSectionRows(selectedCell.sectionId, rows =>
      rows.map(r => {
        if (r.id !== selectedCell.rowId) return r;
        const currentSize = r.fontSize || 11;
        const newSize = Math.max(8, Math.min(24, currentSize + delta));
        return { ...r, fontSize: newSize };
      })
    );
  };

  const changeAlignment = (alignment: "left" | "center" | "right") => {
    if (!selectedCell) return;
    updateSectionRows(selectedCell.sectionId, rows =>
      rows.map(r => (r.id === selectedCell.rowId ? { ...r, align: alignment } : r))
    );
  };

  // ── Bridges for Scanner / AIChat which operate on a flat rows array ─────────
  // They target the FIRST section (the main table).
  const firstSection = sections[0];
  const firstRows = firstSection?.rows ?? [];

  const setFirstSectionRows: React.Dispatch<React.SetStateAction<EditorRow[]>> = (updater) => {
    setSections(prev => {
      const base = prev.length ? prev : defaultSections();
      const current = base[0].rows;
      const nextRows = typeof updater === "function"
        ? (updater as (rows: EditorRow[]) => EditorRow[])(current)
        : updater;
      return base.map((s, i) => (i === 0 ? { ...s, rows: nextRows } : s));
    });
  };

  const handleExport = async (format: "pdf" | "excel" | "word") => {
    const detailsWithAdvance: BillDetails = { ...billDetails, advance: billDetails.advance };
    const exportTables = currentBillTables;
    if (format === "pdf") {
      // Embed the full editable bill inside the PDF so it can be re-uploaded and edited.
      const embed = encodeBillMarker({ v: 1, header, billDetails, sections, billTitle, columnLabels, billFormat, columnVisibility });
      await exportProfessionalPDF(header, exportTables, detailsWithAdvance, billTitle, { fitToOnePage, embed, format: billFormat }, columnLabels);
    }
    else if (format === "excel") await exportProfessionalExcel(header, exportTables, detailsWithAdvance, billTitle, columnLabels, { format: billFormat });
    else await exportProfessionalWord(header, exportTables, detailsWithAdvance, billTitle, columnLabels, { format: billFormat });
  };

  // Open a bill PDF that was exported from this app and restore it for editing.
  const openPdfInputRef = useRef<HTMLInputElement>(null);
  const handleOpenPdf = async (file: File) => {
    try {
      const buf = await file.arrayBuffer();
      const data = extractBillFromPdf(buf);
      if (!data || !Array.isArray(data.sections) || data.sections.length === 0) {
        alert(
          "This PDF can't be opened for editing.\n\nOnly PDFs downloaded from Bill AI carry the editable data. " +
          "If this file was created elsewhere or re-saved in another PDF editor, use the AI Scanner instead."
        );
        return;
      }
      setHeader(data.header ?? initialHeader);
      setBillDetails({ ...initialBillDetails, ...(data.billDetails ?? {}) });
      setSections(data.sections as BillSection[]);
      setBillTitle(typeof data.billTitle === "string" ? data.billTitle : "Untitled Bill");
      setColumnLabels({ ...defaultColumnLabels, ...(data.columnLabels ?? {}) });
      if (data.billFormat === "labourMaterial" || data.billFormat === "standard") {
        setBillFormat(data.billFormat);
      }
      setColumnVisibility({ ...defaultColumnVisibility, ...(data.columnVisibility ?? {}) });
      setSelectedCell(null);
    } catch {
      alert("Could not read this PDF. Please make sure it's a bill PDF exported from this app.");
    }
  };

  const updateDetail = <K extends keyof BillDetails>(key: K, value: BillDetails[K]) => {
    setBillDetails(prev => ({ ...prev, [key]: value }));
  };

  return (
    <div className="appShell" style={{ gridTemplateColumns: isLeftDrawerOpen ? `${leftWidth}px 6px 1fr 6px ${rightWidth}px` : `0px 0px 1fr 6px ${rightWidth}px` }}>
      {/* ── Top Header Bar ──────────────────────────────────────────────────── */}
      <header className="topHeader">
        <button
          className={`hdrBtn drawerToggleBtn ${isLeftDrawerOpen ? "active" : ""}`}
          onClick={() => setIsLeftDrawerOpen(!isLeftDrawerOpen)}
          title={isLeftDrawerOpen ? "Close Header & Details Drawer" : "Open Header & Details Drawer"}
        >
          <PanelLeft size={16} />
          <span>{isLeftDrawerOpen ? "Close Drawer" : "Header & Details"}</span>
        </button>
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
          <select
            className="formatSelect"
            value={billFormat}
            onChange={e => setBillFormat(e.target.value as BillFormat)}
            title="Switch bill format"
          >
            <option value="standard">Standard (Rate × Qty)</option>
            <option value="labourMaterial">Labour + Material</option>
            <option value="custom">Custom (Flexible Table)</option>
          </select>
        </div>
        <div className="topHeaderActions">
          <span className={`saveStatus ${saveState}`} title="Your work is auto-saved in this browser on every change">
            {saveState === "saving"
              ? <><Loader2 size={13} className="saveStatusSpin" /> Saving…</>
              : <><CheckCircle2 size={13} /> Saved</>}
          </span>
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

      {/* ── Left Panel Drawer ────────────────────────────────────────────────── */}
      <aside className="leftPanel" style={{ display: isLeftDrawerOpen ? "flex" : "none" }}>
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
                <input type="date" value={billDetails.date} onChange={e => updateDetail("date", e.target.value)} />
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
                <input type="checkbox" checked={billDetails.showHeader !== false} onChange={e => updateDetail("showHeader", e.target.checked)} />
                Show Business Header / Letterhead
              </label>
              <label className="toggleRow">
                <input type="checkbox" checked={billDetails.showDate !== false} onChange={e => updateDetail("showDate", e.target.checked)} />
                Show Date
              </label>
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
                <input type="checkbox" checked={billDetails.showAdvance !== false} onChange={e => updateDetail("showAdvance", e.target.checked)} />
                Show Advance (Total always shows)
              </label>
              <label className="toggleRow">
                <input type="checkbox" checked={billDetails.showBalance !== false} onChange={e => updateDetail("showBalance", e.target.checked)} />
                Show Balance
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
              <hr style={{ border: "none", borderTop: "1px solid #e2e8f0", margin: "10px 0" }} />
              <span className="cardTitle" style={{ fontSize: 12, marginBottom: 6, display: "block" }}>Totals Section</span>
              <label className="toggleRow">
                <input type="checkbox" checked={billDetails.showGrandTotal !== false} onChange={e => updateDetail("showGrandTotal", e.target.checked)} />
                Show Grand Total
              </label>
              <label className="toggleRow">
                <input type="checkbox" checked={billDetails.showAdvance !== false} onChange={e => updateDetail("showAdvance", e.target.checked)} />
                Show Advance
              </label>
              <label className="toggleRow">
                <input type="checkbox" checked={billDetails.showBalance !== false} onChange={e => updateDetail("showBalance", e.target.checked)} />
                Show Balance
              </label>
            </div>

            {/* Column Visibility */}
            <div className="card">
              <div className="cardHeader">
                <span className="cardTitle">Columns (show/hide)</span>
              </div>
              <label className="toggleRow">
                <input type="checkbox" checked={columnVisibility.size} onChange={e => setColumnVisibility(v => ({ ...v, size: e.target.checked }))} />
                {columnLabels.size}
              </label>
              <label className="toggleRow">
                <input type="checkbox" checked={columnVisibility.quantity} onChange={e => setColumnVisibility(v => ({ ...v, quantity: e.target.checked }))} />
                {columnLabels.quantity}
              </label>
              {billFormat === "standard" && (
                <label className="toggleRow">
                  <input type="checkbox" checked={columnVisibility.rate} onChange={e => setColumnVisibility(v => ({ ...v, rate: e.target.checked }))} />
                  {columnLabels.rate}
                </label>
              )}
              <label className="toggleRow">
                <input type="checkbox" checked={columnVisibility.amount} onChange={e => setColumnVisibility(v => ({ ...v, amount: e.target.checked }))} />
                {columnLabels.amount}
              </label>
            </div>

            {/* Cloud Db & Open PDF section */}
            <div className="card">
              <div className="cardHeader">
                <span className="cardTitle">Open / Import</span>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className="hdrBtn" onClick={() => setDbPanelOpen(true)} title="Cloud Database" style={{ flex: 1 }}>
                  <Database size={16} /> Cloud Db
                </button>
                <input
                  ref={openPdfInputRef}
                  type="file"
                  accept="application/pdf,.pdf"
                  style={{ display: "none" }}
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleOpenPdf(f); e.currentTarget.value = ""; }}
                />
                <button className="hdrBtn" onClick={() => openPdfInputRef.current?.click()} title="Open a bill PDF exported from this app and edit it" style={{ flex: 1 }}>
                  <FolderOpen size={16} /> Open PDF
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="leftPanelScannerWrap">
            <BillScanner 
              header={header} 
              onHeaderChange={setHeader} 
              rows={firstRows}
              onRowsChange={setFirstSectionRows}
              billDetails={billDetails}
              onBillDetailsChange={setBillDetails}
              onClose={() => setLeftTab("details")} 
            />
          </div>
        )}
      </aside>

      <div className={`resizerHandle ${isResizingLeft ? "resizing" : ""}`} onMouseDown={startResizingLeft} style={{ display: isLeftDrawerOpen ? "block" : "none" }} />

      {/* ── Center Panel ────────────────────────────────────────────────────── */}
      <main className="centerPanel">
        <div className="summaryStrip">
          <span>Tables: {sections.length} · Items: {totalItems}</span>
          <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
            <span>Balance: <strong style={{ color: "#15803d" }}>{money(balance)}</strong></span>
            <span>Total: <strong>{money(total)}</strong></span>
          </div>
        </div>

        {/* Global formatting toolbar (acts on the selected row) */}
        <div className="billTableToolbar centerToolbar">
          <span className="billTableTitle">
            {selectedRow ? "Formatting selected row" : "Select a row to format"}
          </span>
          <div className="tableFormattingToolbar">
            <button 
              className={`formattingBtn ${selectedRow?.bold ? 'active' : ''}`}
              onClick={toggleBold}
              disabled={!selectedRow}
              title="Bold"
            >
              <strong>B</strong>
            </button>
            <div className="fontSizeControls">
              <button onClick={() => adjustFontSize(-1)} disabled={!selectedRow} title="Decrease Font Size">-</button>
              <span className="fontSizeDisplay">{selectedRow?.fontSize || 11}px</span>
              <button onClick={() => adjustFontSize(1)} disabled={!selectedRow} title="Increase Font Size">+</button>
            </div>
            <div className="alignmentControls">
              {(["left", "center", "right"] as const).map(alignVal => (
                <button
                  key={alignVal}
                  className={`formattingBtn ${selectedRow?.align === alignVal ? 'active' : ''}`}
                  onClick={() => changeAlignment(alignVal)}
                  disabled={!selectedRow}
                  title={`Align ${alignVal}`}
                >
                  {alignVal === "left" ? "L" : alignVal === "center" ? "C" : "R"}
                </button>
              ))}
            </div>
          </div>
          <button className="primaryButton" style={{ minHeight: 34, padding: "0 12px", fontSize: 13 }} onClick={addTable}>
            <Plus size={15} /> Add Table
          </button>
        </div>

        {/* One card per section (table) */}
        {sections.map((section, sectionIndex) => {
          const isManual = (section.mode ?? "template") === "manual";
          if (billFormat === "custom") {
            return (
              <BillTableEditor
                key={section.id}
                table={sectionToBillTable(section, "custom")}
                tables={currentBillTables}
                onChange={(updatedTable) => {
                  setSections(prev => prev.map(s => s.id === updatedTable.id ? {
                    ...s,
                    title: updatedTable.title,
                    page: updatedTable.page,
                    mode: updatedTable.mode,
                    columns: updatedTable.columns,
                    customRows: updatedTable.rows
                  } : s));
                }}
                onDelete={() => deleteTable(section.id)}
                onAddTable={addTable}
              />
            );
          }
          return (
          <div className="billTableCard" key={section.id}>
            <div className="billTableToolbar sectionToolbar">
              <input
                className="sectionTitleInput"
                value={section.title}
                onChange={e => updateTableTitle(section.id, e.target.value)}
                placeholder={sectionIndex === 0 ? "Table label (optional) — e.g. Master Bedroom" : "Table label — e.g. Bedroom"}
              />
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div
                  className="pageStepper"
                  title="Which page this table prints on. Give tables the same number to keep them together on one page; increase the number to start a new page."
                >
                  <SeparatorHorizontal size={13} />
                  <span className="pageStepperLabel">Page</span>
                  <button
                    className="pageStepperBtn"
                    onClick={() => setTablePage(section.id, (section.page ?? 1) - 1)}
                    disabled={(section.page ?? 1) <= 1}
                    title="Previous page"
                  >−</button>
                  <input
                    className="pageStepperInput"
                    type="number"
                    min={1}
                    value={section.page ?? 1}
                    onChange={e => setTablePage(section.id, parseInt(e.target.value, 10))}
                    title="Type the page number for this table"
                  />
                  <button
                    className="pageStepperBtn"
                    onClick={() => setTablePage(section.id, (section.page ?? 1) + 1)}
                    title="Next page"
                  >+</button>
                </div>
                <button
                  className={`modeToggleBtn ${isManual ? "manual" : "template"}`}
                  onClick={() => toggleTableMode(section.id)}
                  title={isManual
                    ? "Manual mode: sizes are plain numbers / math (no inch conversion). Click to switch to Template mode."
                    : "Template mode: inch chart applies (e.g. .6 → .50). Click to switch to Manual mode."}
                >
                  {isManual ? <Calculator size={13} /> : <Ruler size={13} />}
                  {isManual ? "Manual" : "Template"}
                </button>
                <span className="sectionSubtotal">{money(sectionTotal(section))}</span>
                <button className="primaryButton" style={{ minHeight: 32, padding: "0 10px", fontSize: 13 }} onClick={() => addRow(section.id)}>
                  <FilePlus2 size={15} /> Add Row
                </button>
                <button
                  className="miniButton danger"
                  onClick={() => deleteTable(section.id)}
                  disabled={sections.length <= 1}
                  title={sections.length <= 1 ? "At least one table is required" : "Delete this table"}
                  style={{ border: "none" }}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>

            <div className="tableWrap">
              <table className={`billTable ${billFormat === "labourMaterial" ? "labourMaterialTable" : ""}`}>
                <thead>
                  <tr>
                    <th style={{ width: 44 }}><input className="colHeaderInput" style={{ textAlign: "center" }} value={columnLabels.sr} onChange={e => updateColumnLabel("sr", e.target.value)} title="Click to rename this column" /></th>
                    <th><input className="colHeaderInput" value={columnLabels.particulars} onChange={e => updateColumnLabel("particulars", e.target.value)} title="Click to rename this column" /></th>
                    {columnVisibility.size && <th style={{ width: billFormat === "labourMaterial" ? 90 : 120 }}><input className="colHeaderInput" value={columnLabels.size} onChange={e => updateColumnLabel("size", e.target.value)} title="Click to rename this column" /></th>}
                    {columnVisibility.quantity && <th style={{ width: billFormat === "labourMaterial" ? 75 : 100 }}><input className="colHeaderInput" style={{ textAlign: "right" }} value={columnLabels.quantity} onChange={e => updateColumnLabel("quantity", e.target.value)} title="Click to rename this column" /></th>}
                    {billFormat === "standard" ? (
                      <>
                        {columnVisibility.rate && <th style={{ width: 100 }}><input className="colHeaderInput" style={{ textAlign: "center" }} value={columnLabels.rate} onChange={e => updateColumnLabel("rate", e.target.value)} title="Click to rename this column" /></th>}
                        {columnVisibility.amount && <th style={{ width: 110 }}><input className="colHeaderInput" style={{ textAlign: "center" }} value={columnLabels.amount} onChange={e => updateColumnLabel("amount", e.target.value)} title="Click to rename this column" /></th>}
                      </>
                    ) : (
                      <>
                        <th style={{ width: 85 }} className="thCenter"><span style={{ fontSize: 11, lineHeight: 1.25, display: "block" }}>Only Labour<br/>Charges</span></th>
                        <th style={{ width: 75 }} className="thCenter"><span style={{ fontSize: 11 }}>Amount</span></th>
                        <th style={{ width: 105 }} className="thCenter"><span style={{ fontSize: 11, lineHeight: 1.25, display: "block" }}>Materials with<br/>Labour Charges</span></th>
                        <th style={{ width: 75 }} className="thCenter"><span style={{ fontSize: 11 }}>Amount</span></th>
                      </>
                    )}
                    <th style={{ width: 60 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {section.rows.map(row => {
                    const isSelected = selectedCell?.sectionId === section.id && selectedCell?.rowId === row.id;
                    const select = () => setSelectedCell({ sectionId: section.id, rowId: row.id });
                    return (
                      <tr key={row.id} style={{ background: isSelected ? "#f8fafc" : undefined }}>
                        <td className="tdCenter">
                          <input className="billCell" style={{ width: 36, textAlign: "center" }} value={row.sr} readOnly tabIndex={-1} onFocus={select} />
                        </td>
                        <td>
                          <input
                            className="billCell"
                            value={row.particulars}
                            onChange={e => updateRow(section.id, row.id, "particulars", e.target.value)}
                            onBlur={e => {
                              const tc = toTitleCase(e.target.value);
                              if (tc !== row.particulars) updateRow(section.id, row.id, "particulars", tc);
                            }}
                            placeholder="Description of work / material…"
                            onFocus={select}
                            style={{
                              fontWeight: row.bold ? "bold" : "normal",
                              fontSize: row.fontSize ? `${row.fontSize}px` : "13px",
                              textAlign: row.align || "left"
                            }}
                          />
                        </td>
                        {columnVisibility.size && (
                        <td>
                          <input
                            className="billCell"
                            value={row.size}
                            onChange={e => updateRow(section.id, row.id, "size", e.target.value)}
                            placeholder="e.g. 3x4 or 12"
                            onFocus={select}
                          />
                          {(() => {
                            const rowMode = row.mode ?? (isManual ? "manual" : "template");
                            const rowIsManual = rowMode === "manual";
                            const rowIsInches = rowMode === "inches";
                            const converted = rowIsManual ? row.size : rowIsInches ? convertInchesToFeetDisplay(row.size) : convertAllPointValues(row.size);
                            const parsed = parseSize(row.size, rowMode === "template", rowMode);
                            const changed = !rowIsManual && converted !== row.size;
                            return (
                              <div className="sizeRowControls">
                                <button
                                  className={`rowModeBtn ${rowIsManual ? "manual" : rowMode === "inches" ? "inches" : "template"}`}
                                  onClick={() => {
                                    const currentMode = row.mode ?? (isManual ? "manual" : "template");
                                    // Cycle: template → manual → inches → template
                                    const nextMode = currentMode === "template" ? "manual" : currentMode === "manual" ? "inches" : "template";
                                    updateRow(section.id, row.id, "mode", nextMode);
                                  }}
                                  title={rowIsManual
                                    ? "This row: Manual (plain math). Click → Inches (÷12)."
                                    : rowMode === "inches"
                                    ? "This row: Inches (81\" → 6.75). Click → Template (inch chart)."
                                    : "This row: Template (inch chart). Click → Manual (plain math)."}
                                >
                                  {rowIsManual ? "M" : rowMode === "inches" ? "I" : "T"}
                                </button>
                                {row.size.trim() && (
                                  <small className="sizeHint">
                                    {changed && <span style={{ color: "#1a56db" }}>→ {converted} </span>}
                                    {/[+\-*/x*×]/i.test(row.size) && <span>= {parsed}</span>}
                                  </small>
                                )}
                              </div>
                            );
                          })()}
                        </td>
                        )}
                        {columnVisibility.quantity && (
                        <td className="tdRight">
                          <input
                            className="billCell"
                            style={{ textAlign: "right" }}
                            type="number"
                            min={0}
                            value={row.quantity ? Math.round(row.quantity * 100) / 100 : ""}
                            onChange={e => updateRow(section.id, row.id, "quantity", parseFloat(e.target.value) || 0)}
                            placeholder="0"
                            onFocus={select}
                          />
                        </td>
                        )}
                        {billFormat === "standard" ? (
                          <>
                            {columnVisibility.rate && (
                            <td className="tdCenter">
                              <input
                                className="billCell"
                                style={{ textAlign: "center" }}
                                type="number"
                                min={0}
                                value={row.rate || ""}
                                onChange={e => updateRow(section.id, row.id, "rate", parseFloat(e.target.value) || 0)}
                                placeholder="0"
                                onFocus={select}
                              />
                            </td>
                            )}
                            {columnVisibility.amount && (
                            <td className="tdAmount">
                              <input
                                className="billCell"
                                style={{ textAlign: "center", background: "transparent" }}
                                type="number"
                                min={0}
                                value={row.amount || ""}
                                onChange={e => updateRow(section.id, row.id, "amount", parseFloat(e.target.value) || 0)}
                                placeholder="0"
                                onFocus={select}
                              />
                            </td>
                            )}
                          </>
                        ) : (
                          <>
                            <td className="tdCenter">
                              <input
                                className="billCell"
                                style={{ textAlign: "center" }}
                                type="number"
                                min={0}
                                value={row.labourRate || ""}
                                onChange={e => updateRow(section.id, row.id, "labourRate", parseFloat(e.target.value) || 0)}
                                placeholder="0"
                                onFocus={select}
                              />
                            </td>
                            <td className="tdAmount">
                              <input
                                className="billCell"
                                style={{ textAlign: "center", background: "transparent" }}
                                type="number"
                                min={0}
                                value={row.labourAmount || ""}
                                readOnly
                                tabIndex={-1}
                                onFocus={select}
                              />
                            </td>
                            <td className="tdCenter">
                              <input
                                className="billCell"
                                style={{ textAlign: "center" }}
                                type="number"
                                min={0}
                                value={row.materialRate || ""}
                                onChange={e => updateRow(section.id, row.id, "materialRate", parseFloat(e.target.value) || 0)}
                                placeholder="0"
                                onFocus={select}
                              />
                            </td>
                            <td className="tdAmount">
                              <input
                                className="billCell"
                                style={{ textAlign: "center", background: "transparent" }}
                                type="number"
                                min={0}
                                value={row.materialAmount || ""}
                                readOnly
                                tabIndex={-1}
                                onFocus={select}
                              />
                            </td>
                          </>
                        )}
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                            <button
                              className="miniButton"
                              title="Insert row below"
                              onClick={() => insertRowBelow(section.id, row.id)}
                              style={{ fontSize: 15, border: "none", color: "#2563eb" }}
                            >+</button>
                            <button
                              className="miniButton danger"
                              title="Remove row"
                              onClick={() => deleteRow(section.id, row.id)}
                              style={{ fontSize: 16, border: "none" }}
                            >×</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="tableFooterArea">
              <div className="tableFooterLeft">
                <div className="sectionTotalLine">
                  <span className="summaryLabel">{section.title ? `${section.title} total:` : "Table total:"}</span>
                  <span className="summaryValue">{money(sectionTotal(section))}</span>
                </div>
                {billFormat === "labourMaterial" && (
                  <div className="sectionTotalLine" style={{ marginTop: 2 }}>
                    <span className="summaryLabel">Labour total:</span>
                    <span className="summaryValue">{money(sectionLabourTotal(section))}</span>
                  </div>
                )}
              </div>
              <div className="tableFooterRight">
                <button className="addRowBtn" onClick={() => addRow(section.id)}>
                  <FilePlus2 size={16} /> Add Row
                </button>
              </div>
            </div>
          </div>
          );
        })}

        {/* Add another table */}
        <button className="addTableBtn" onClick={addTable}>
          <Plus size={16} /> Add Another Table
        </button>

        {/* Overall billing summary */}
        <div className="billTableCard" style={{ marginTop: 28 }}>
          <div className="tableFooterArea">
            <div className="tableFooterLeft">
              <div className="billingSummaryCard">
                <div className="summaryRow">
                  <span className="summaryLabel">{sections.length > 1 ? "Grand Total:" : "Total:"}</span>
                  <span className="summaryValue">{money(total)}</span>
                </div>
                {billDetails.showAdvance !== false && (
                  <div className="summaryRow">
                    <span className="summaryLabel">Advance:</span>
                    <input
                      className="advanceCellInput"
                      type="number"
                      min={0}
                      value={billDetails.advance || ""}
                      onChange={e => updateDetail("advance", parseFloat(e.target.value) || 0)}
                      placeholder="0"
                    />
                  </div>
                )}
                {billDetails.showBalance !== false && (
                  <div className="summaryRow balanceRow">
                    <span className="summaryLabel">Balance:</span>
                    <span className="summaryValue">{money(balance)}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>

      <div className={`resizerHandle ${isResizingRight ? "resizing" : ""}`} onMouseDown={startResizingRight} />

      {/* ── Right Panel ─────────────────────────────────────────────────────── */}
      <aside className="rightPanel">
        <p className="previewLabel">Live Preview</p>

        <div className="previewSheet" id="print-area">
          <BillPreview header={header} sections={sections} billDetails={billDetails} columnLabels={columnLabels} billFormat={billFormat} />
        </div>

        <div>
          <p className="previewLabel" style={{ marginBottom: 8 }}>Export</p>
          <label className="fitToPageToggle" title="Shrinks each page's tables just enough to fit on their page. Works together with the per-table page numbers: group tables with page numbers, then tick this to auto-fit each page.">
            <input
              type="checkbox"
              checked={fitToOnePage}
              onChange={e => setFitToOnePage(e.target.checked)}
            />
            Shrink each page's tables to fit (PDF)
          </label>
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
              rows={sections}
              billDetails={billDetails}
              billTitle={billTitle}
              onLoadBill={(bill) => {
                setBillTitle(bill.bill_title || "Untitled Bill");
                setHeader(bill.header);
                // Support both the new `sections` format and the legacy flat `rows` format.
                if (Array.isArray(bill.sections) && bill.sections.length) {
                  setSections(bill.sections);
                } else if (Array.isArray(bill.rows) && bill.rows.length) {
                  // rows could be a flat EditorRow[] (legacy) — wrap into one section.
                  const looksLikeSections = bill.rows[0] && Array.isArray((bill.rows[0] as any).rows);
                  if (looksLikeSections) {
                    setSections(bill.rows as BillSection[]);
                  } else {
                    setSections([{ id: uid(), title: "", rows: bill.rows as EditorRow[] }]);
                  }
                } else {
                  setSections(defaultSections());
                }
                setSelectedCell(null);
                setBillDetails({
                  clientName: bill.client_name || "",
                  clientAddress: bill.client_address || "",
                  date: bill.date || "",
                  subject: bill.subject || "",
                  advance: Number(bill.advance) || 0,
                  note: bill.note || "",
                  showNote: bill.showNote !== false,
                  showSignature: bill.showSignature !== false,
                  proprietorName: bill.proprietorName || "",
                  showHeader: bill.showHeader !== false,
                  showDate: bill.showDate !== false,
                  showClientDetails: bill.showClientDetails !== false,
                  showClientAddress: bill.showClientAddress !== false,
                  showGST: bill.showGST !== false,
                  showAdvance: bill.showAdvance !== false,
                  showBalance: bill.showBalance !== false
                });
                setColumnLabels({ ...defaultColumnLabels, ...((bill as any).columnLabels ?? {}) });
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
        rows={firstRows.map(r => ({
          id: r.id,
          cells: { sr: String(r.sr), particulars: r.particulars, size: r.size, quantity: String(r.quantity), rate: String(r.rate), amount: String(r.amount) }
        }))}
        billDetails={billDetails}
        onHeaderChange={setHeader}
        onColsChange={() => {}}
        onRowsChange={(updaterOrRows) => {
          if (typeof updaterOrRows === "function") {
            setFirstSectionRows(prev => {
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
            setFirstSectionRows(updaterOrRows.map((r: any) => ({
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
