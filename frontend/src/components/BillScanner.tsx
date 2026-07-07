import {
  Camera, FileSpreadsheet, FileText, FileType,
  Loader2, ScanLine, Upload, Ruler, Plus, Trash2,
  Send, Bot, User, Sparkles
} from "lucide-react";
import { useState, useRef, useMemo, useEffect } from "react";
import { AIService } from "../lib/aiService";
import { exportProfessionalPDF, exportProfessionalExcel, exportProfessionalWord } from "../lib/documentExport";
import { convertAllPointValues } from "../lib/inchConversion";
import type { HeaderTemplate, BillDetails } from "../types";
import { initialBillDetails } from "../data/initialBill";
import * as pdfjsLib from "pdfjs-dist";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.mjs", import.meta.url).toString();
import { safeParseJSON } from "../lib/jsonHelper";

// ── types ─────────────────────────────────────────────────────────────────────
type ScannedRow = {
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

type ChatMsg = {
  id: string;
  role: "user" | "ai";
  text: string;
};

// ── helpers ───────────────────────────────────────────────────────────────────
function parseSize(size: string): number {
  const clean = size.trim();
  const parts = clean.split(/[x*×]/i).map(p => parseFloat(p.trim())).filter(n => !isNaN(n));
  if (parts.length >= 2) return parts.reduce((a, b) => a * b, 1);
  return parseFloat(clean) || 1;
}

function calcAmount(quantity: number, rate: number): number {
  return Math.round(quantity * rate * 100) / 100;
}

function uid() { return Math.random().toString(36).slice(2, 9); }

function renumber(rows: ScannedRow[]): ScannedRow[] {
  return rows.map((r, i) => ({ ...r, sr: i + 1 }));
}

// ── component ─────────────────────────────────────────────────────────────────
type Props = {
  header: HeaderTemplate;
  onHeaderChange: (h: HeaderTemplate) => void;
  /** When provided, the scanner is controlled externally (modal mode). */
  onClose?: () => void;
};

export function BillScanner({ header, onHeaderChange, onClose }: Props) {
  const [isOpen, setIsOpen]       = useState(false);
  const [activeTab, setActiveTab] = useState<"scanner" | "ai">("scanner");

  // image
  const [selectedImage, setSelectedImage]             = useState<string | null>(null);
  const [isScanning, setIsScanning]                   = useState(false);
  const [scanStatus, setScanStatus]                   = useState("");
  const [rawExtractedText, setRawExtractedText]       = useState("");
  const [applyInchConversion, setApplyInchConversion] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // table rows
  const [rows, setRows] = useState<ScannedRow[]>([
    { id: uid(), sr: 1, particulars: "", size: "1", quantity: 1, rate: 0, amount: 0, bold: false, fontSize: 11, align: "left" }
  ]);

  // bill details
  const [billDetails, setBillDetails] = useState<BillDetails>(initialBillDetails);

  // AI chat
  const [chatMsgs, setChatMsgs]   = useState<ChatMsg[]>([{
    id: uid(), role: "ai",
    text: "Hi! I can control the bill table using natural language. Try:\n• \"add row for window glass 10x5 rate 200\"\n• \"change row 2 rate to 350\"\n• \"set client name to Sharma Building\"\n• \"delete row 3\"\n• \"add 18% GST\"\n• \"set advance to 75000\"\n• \"clear table\""
  }]);
  const [chatInput, setChatInput] = useState("");
  const [isAiThinking, setIsAiThinking] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // export
  const [isExporting, setIsExporting]   = useState(false);
  const [exportStatus, setExportStatus] = useState("");

  // derived
  const total   = useMemo(() => rows.reduce((s, r) => s + r.amount, 0), [rows]);
  const balance = total - billDetails.advance;

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMsgs]);

  // ── file select (Image or PDF) ──────────────────────────────────────────────
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setScanStatus("");
    
    if (file.type === "application/pdf") {
      setIsScanning(true);
      setScanStatus("Parsing PDF page…");
      try {
        const reader = new FileReader();
        reader.onload = async () => {
          try {
            const arrayBuffer = reader.result as ArrayBuffer;
            const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
            
            if (pdf.numPages === 0) {
              alert("The PDF has no pages.");
              setIsScanning(false);
              return;
            }
            
            const page = await pdf.getPage(1);
            const viewport = page.getViewport({ scale: 2.0 }); // 2x scale for crisp OCR rendering
            
            const canvas = document.createElement("canvas");
            const context = canvas.getContext("2d");
            if (!context) throw new Error("Could not create canvas context.");
            
            canvas.height = viewport.height;
            canvas.width = viewport.width;
            
            await page.render({ canvasContext: context, viewport, canvas }).promise;
            
            const dataUrl = canvas.toDataURL("image/png");
            setSelectedImage(dataUrl);
            setScanStatus("PDF page 1 loaded. Click Scan Bill.");
          } catch (err: any) {
            alert(`Error reading PDF: ${err.message || err}`);
            setScanStatus("Error loading PDF.");
          } finally {
            setIsScanning(false);
          }
        };
        reader.readAsArrayBuffer(file);
      } catch (err: any) {
        alert(`Error reading file: ${err.message || err}`);
        setIsScanning(false);
      }
    } else if (file.type.startsWith("image/")) {
      if (file.size > 10 * 1024 * 1024) { alert("Image must be < 10 MB"); return; }
      setSelectedImage(await AIService.fileToBase64(file));
      setScanStatus("Image ready. Click Scan Bill.");
    } else {
      alert("Please select a valid image (JPG, PNG) or PDF file.");
    }
    
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // ── scan ─────────────────────────────────────────────────────────────────────
  const scanBill = async () => {
    if (!selectedImage) { setScanStatus("Upload a file first."); return; }
    setIsScanning(true);
    setScanStatus("🔍 AI is reading the bill… (10–30 sec)");
    setRawExtractedText("");
    try {
      const ai  = new AIService("", "ollama");
      const raw = await ai.extractBillFromImage(selectedImage);
      setRawExtractedText(raw);
      const data = safeParseJSON(raw);
      if (!data.items?.length) { setScanStatus("⚠️ No items found. Try a clearer image."); return; }

      const newRows: ScannedRow[] = data.items.map((item: any, idx: number) => {
        let sizeStr = String(item.size ?? "");
        if (sizeStr === "—" || sizeStr === "null" || sizeStr === "undefined") {
          sizeStr = "";
        }
        if (sizeStr && applyInchConversion) {
          sizeStr = convertAllPointValues(sizeStr);
        }
        
        let qty = 1;
        if (item.quantity !== undefined && item.quantity !== null && item.quantity !== "") {
          qty = parseFloat(item.quantity) || 1;
        } else if (sizeStr) {
          qty = parseSize(sizeStr);
        }
        
        const rate   = parseFloat(item.rate)   || 0;
        const amount = parseFloat(item.amount) || calcAmount(qty, rate);
        return {
          id: uid(),
          sr: item.sr ?? idx + 1,
          particulars: String(item.particulars ?? item.name ?? ""),
          size: sizeStr,
          quantity: qty,
          rate,
          amount
        };
      });

      setRows(newRows);
      if (data.advance) setBillDetails(prev => ({ ...prev, advance: parseFloat(data.advance) || 0 }));
      setScanStatus(`✅ ${newRows.length} rows extracted. Edit in table or use AI tab.`);
      setChatMsgs(prev => [...prev, { id: uid(), role: "ai",
        text: `✅ Scanned ${newRows.length} rows! Switch to AI tab to modify with prompts, or edit the table directly.` }]);
    } catch (err) {
      setScanStatus(`❌ ${err instanceof Error ? err.message : "Scan failed"}`);
    } finally {
      setIsScanning(false);
    }
  };

  // ── AI command executor ───────────────────────────────────────────────────────
  const applyAICommand = (parsed: any): string => {
    const { action, data } = parsed;

    switch (action) {
      case "ADD_ROW": {
        setRows(prev => {
          const size = String(data.size || "1");
          const qty = data.quantity !== undefined ? parseFloat(data.quantity) || 0 : parseSize(size);
          const rate = parseFloat(data.rate) || 0;
          const newRow: ScannedRow = {
            id: uid(), sr: prev.length + 1,
            particulars: data.particulars || "",
            size, quantity: qty, rate,
            amount: data.amount !== undefined ? parseFloat(data.amount) || 0 : calcAmount(qty, rate)
          };
          return [...prev, newRow];
        });
        break;
      }
      case "ADD_MULTIPLE_ROWS": {
        setRows(prev => {
          const added = (data.rows || []).map((item: any, i: number) => {
            const size = String(item.size || "1");
            const qty = item.quantity !== undefined ? parseFloat(item.quantity) || 0 : parseSize(size);
            const rate = parseFloat(item.rate) || 0;
            return {
              id: uid(),
              sr: prev.length + i + 1,
              particulars: item.particulars || "",
              size,
              quantity: qty,
              rate,
              amount: item.amount !== undefined ? parseFloat(item.amount) || 0 : calcAmount(qty, rate)
            };
          });
          return renumber([...prev, ...added]);
        });
        break;
      }
      case "UPDATE_ROW": {
        setRows(prev => renumber(prev.map(r => {
          if (r.sr !== data.sr) return r;
          const updated = { ...r };
          if (data.particulars !== undefined) updated.particulars = String(data.particulars);
          if (data.size        !== undefined) {
            updated.size = String(data.size);
            updated.quantity = parseSize(updated.size);
          }
          if (data.quantity    !== undefined) updated.quantity = parseFloat(data.quantity) || 0;
          if (data.rate        !== undefined) updated.rate = parseFloat(data.rate) || 0;
          updated.amount = data.amount !== undefined ? parseFloat(data.amount) || 0 : calcAmount(updated.quantity, updated.rate);
          return updated;
        })));
        break;
      }
      case "DELETE_ROW": {
        setRows(prev => renumber(prev.filter(r => r.sr !== data.sr)));
        break;
      }
      case "UPDATE_DETAIL": {
        const { field, value } = data;
        let parsedValue: any = value;
        if (field === "advance") {
          parsedValue = parseFloat(value) || 0;
        } else if (field === "showNote" || field === "showSignature") {
          parsedValue = value === true || value === "true";
        }
        setBillDetails(prev => ({ ...prev, [field]: parsedValue }));
        break;
      }
      case "CLEAR_TABLE": {
        setRows([{ id: uid(), sr: 1, particulars: "", size: "1", quantity: 1, rate: 0, amount: 0 }]);
        break;
      }
      case "APPLY_GST": {
        const pct = parseFloat(data.percent) || 18;
        setRows(prev => {
          const gstAmt = Math.round(prev.reduce((s, r) => s + r.amount, 0) * pct) / 100;
          return renumber([...prev, { id: uid(), sr: prev.length + 1, particulars: `GST @ ${pct}%`, size: "1", quantity: 1, rate: gstAmt, amount: gstAmt }]);
        });
        break;
      }
      case "APPLY_DISCOUNT": {
        const pct = parseFloat(data.percent) || 10;
        setRows(prev => {
          const discAmt = -Math.round(prev.reduce((s, r) => s + r.amount, 0) * pct) / 100;
          return renumber([...prev, { id: uid(), sr: prev.length + 1, particulars: `Discount @ ${pct}%`, size: "1", quantity: 1, rate: discAmt, amount: discAmt }]);
        });
        break;
      }
      default:
        break;
    }
    return parsed.reply || "Done!";
  };

  // ── send chat ─────────────────────────────────────────────────────────────────
  const sendChat = async () => {
    const text = chatInput.trim();
    if (!text || isAiThinking) return;
    setChatMsgs(prev => [...prev, { id: uid(), role: "user", text }]);
    setChatInput("");
    setIsAiThinking(true);
    try {
      const ai = new AIService("", "ollama");
      const detailsForAI = {
        date: billDetails.date, clientName: billDetails.clientName,
        clientAddress: billDetails.clientAddress, subject: billDetails.subject,
        advance: billDetails.advance, note: billDetails.note
      };
      const rawResponse = await ai.scannerCommand(text, rows, detailsForAI);
      const parsed = safeParseJSON(rawResponse);
      const replyText = applyAICommand(parsed);
      setChatMsgs(prev => [...prev, { id: uid(), role: "ai", text: replyText }]);
      // switch to table tab so user can see changes
      setActiveTab("scanner");
    } catch (err) {
      setChatMsgs(prev => [...prev, { id: uid(), role: "ai",
        text: `❌ ${err instanceof Error ? err.message : "Something went wrong. Try again."}` }]);
    } finally {
      setIsAiThinking(false);
    }
  };

  // ── row table helpers ─────────────────────────────────────────────────────────
  const updateRow = (id: string, field: keyof ScannedRow, raw: string) => {
    setRows(prev => prev.map(r => {
      if (r.id !== id) return r;
      const next = { ...r, [field]: (field === "particulars" || field === "size") ? raw : (parseFloat(raw) || 0) };
      if (field === "size") {
        next.quantity = parseSize(next.size);
      }
      if (field === "size" || field === "quantity" || field === "rate") {
        next.amount = calcAmount(next.quantity, next.rate);
      }
      return next;
    }));
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

  const addRow = () => setRows(prev =>
    [...prev, { id: uid(), sr: prev.length + 1, particulars: "", size: "1", quantity: 1, rate: 0, amount: 0, bold: false, fontSize: 11, align: "left" }]
  );

  const deleteRow = (id: string) => {
    setRows(prev => renumber(prev.filter(r => r.id !== id)));
    if (selectedRowId === id) setSelectedRowId(null);
  };

  // ── export ────────────────────────────────────────────────────────────────────
  const toBillTable = () => [{
    id: "scanner-table", title: "Bill Items",
    columns: [
      { id: "sr",          label: "Sr. No",      kind: "number" as const },
      { id: "particulars", label: "Particulars", kind: "text"   as const },
      { id: "size",        label: "Size",        kind: "text"   as const },
      { id: "quantity",    label: "Quantity",    kind: "number" as const },
      { id: "rate",        label: "Rate",        kind: "number" as const },
      { id: "amount",      label: "Amount",      kind: "number" as const }
    ],
    rows: rows.map(r => ({
      id: r.id,
      cells: {
        sr: String(r.sr),
        particulars: r.particulars,
        size: r.size,
        quantity: String(r.quantity),
        rate: String(r.rate),
        amount: String(r.amount),
        bold: String(r.bold || false),
        fontSize: String(r.fontSize || 11),
        align: r.align || "left"
      }
    }))
  }];

  const doExport = async (type: "pdf" | "excel" | "word") => {
    setIsExporting(true); setExportStatus("");
    const filename = `bill-${billDetails.clientName || "draft"}`.replace(/\s+/g, "-");
    try {
      if (type === "pdf")   await exportProfessionalPDF(header, toBillTable(), billDetails, filename);
      if (type === "excel") await exportProfessionalExcel(header, toBillTable(), billDetails, filename);
      if (type === "word")  await exportProfessionalWord(header, toBillTable(), billDetails, filename);
      setExportStatus(`✅ ${type.toUpperCase()} downloaded!`);
    } catch (e) { setExportStatus(`❌ Export failed: ${e}`); }
    setIsExporting(false);
  };

  // controlled (modal) mode: always render panel, close via onClose
  const handleClose = () => {
    if (onClose) { onClose(); } else { setIsOpen(false); }
  };

  // ── toggle button ─────────────────────────────────────────────────────────────
  if (!onClose && !isOpen) return (
    <button className="billScannerToggle" onClick={() => setIsOpen(true)} title="Bill Scanner & AI">
      <ScanLine size={24} />
    </button>
  );

  // ── panel ─────────────────────────────────────────────────────────────────────
  return (
    <div className="billScannerPanel">

      {/* header bar */}
      <div className="scannerHeader">
        <div>
          <h3>📋 Bill Scanner</h3>
          <small>Scan → AI Edit → Export</small>
        </div>
        <button className="closeBtn" onClick={handleClose}>×</button>
      </div>

      {/* tab switcher */}
      <div className="scannerTabs">
        <button className={`scannerTab ${activeTab === "scanner" ? "active" : ""}`}
          onClick={() => setActiveTab("scanner")}>
          <ScanLine size={14} /> Scanner &amp; Table
        </button>
        <button className={`scannerTab ${activeTab === "ai" ? "active" : ""}`}
          onClick={() => setActiveTab("ai")}>
          <Sparkles size={14} /> AI Assistant
          {chatMsgs.filter(m => m.role === "user").length > 0 && (
            <span className="tabBadge">{chatMsgs.filter(m => m.role === "user").length}</span>
          )}
        </button>
      </div>

      {/* ════════════════════════════════════════════
          TAB 1 — SCANNER + TABLE
      ════════════════════════════════════════════ */}
      {activeTab === "scanner" && (
        <div className="scannerContent">

          {/* 1. Upload */}
          <div className="scannerSection">
            <h4>1️⃣ Upload Bill Image or PDF</h4>
            <input ref={fileInputRef} type="file" accept="image/*,application/pdf"
              style={{ display: "none" }} onChange={handleFileSelect} />
            {selectedImage ? (
              <div className="imagePreviewBox">
                <img src={selectedImage} alt="bill" />
                <button className="changeBtn" onClick={() => fileInputRef.current?.click()}>
                  <Upload size={14} /> Change
                </button>
              </div>
            ) : (
              <button className="uploadDropzone" onClick={() => fileInputRef.current?.click()}>
                <Camera size={28} />
                <span>Click to upload bill file</span>
                <small>JPG, PNG, PDF — max 10 MB</small>
              </button>
            )}
          </div>

          {/* 2. Scan */}
          <div className="scannerSection">
            <h4>2️⃣ Scan with AI</h4>
            <label className="inchToggleRow">
              <input type="checkbox" checked={applyInchConversion}
                onChange={e => setApplyInchConversion(e.target.checked)} />
              <Ruler size={13} />
              <span>Auto-convert inch points (.6→.50)</span>
            </label>
            <button className="scanBtn" onClick={scanBill} disabled={!selectedImage || isScanning}>
              {isScanning
                ? <><Loader2 size={15} className="spinning" /> Scanning…</>
                : <><ScanLine size={15} /> Scan Bill</>}
            </button>
            {scanStatus && <p className="statusText">{scanStatus}</p>}
            
            {rawExtractedText && (
              <div style={{ marginTop: 12, borderTop: "1px solid #e2e8f0", paddingTop: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#475569" }}>📄 Raw Extracted Text (Copy & Paste Reference)</span>
                  <button 
                    onClick={() => {
                      navigator.clipboard.writeText(rawExtractedText);
                      alert("Copied to clipboard!");
                    }}
                    style={{ padding: "2px 6px", fontSize: 10, background: "#f1f5f9", border: "1px solid #cbd5e1", borderRadius: 4, cursor: "pointer", fontWeight: 600 }}
                  >
                    Copy Text
                  </button>
                </div>
                <textarea
                  readOnly
                  value={rawExtractedText}
                  style={{ width: "100%", height: 100, fontFamily: "monospace", fontSize: 11, padding: 6, borderRadius: 6, border: "1px solid #cbd5e1", background: "#f8fafc", resize: "vertical", color: "#334155" }}
                />
              </div>
            )}
          </div>

          {/* 3. Bill Details */}
          <div className="scannerSection billDetailsSection">
            <h4>3️⃣ Bill Details</h4>
            <div className="detailsRow">
              <label>Date
                <input type="text" value={billDetails.date}
                  onChange={e => setBillDetails({ ...billDetails, date: e.target.value })}
                  placeholder="DD/MM/YYYY" />
              </label>
              {billDetails.showClientDetails !== false ? (
                <label>Client Name
                  <input type="text" value={billDetails.clientName}
                    onChange={e => setBillDetails({ ...billDetails, clientName: e.target.value })}
                    placeholder="Atharv Palace" />
                </label>
              ) : (
                <label>Subject
                  <input type="text" value={billDetails.subject}
                    onChange={e => setBillDetails({ ...billDetails, subject: e.target.value })} />
                </label>
              )}
            </div>
            {billDetails.showClientDetails !== false && (
              <div className="detailsRow">
                {billDetails.showClientAddress !== false ? (
                  <>
                    <label>Client Address
                      <textarea value={billDetails.clientAddress}
                        onChange={e => setBillDetails({ ...billDetails, clientAddress: e.target.value })}
                        placeholder="Vile Parle East"
                        rows={2}
                        className="cellTextarea"
                        style={{ minHeight: 45, resize: "vertical", padding: "6px 10px" }} />
                    </label>
                    <label>Subject
                      <input type="text" value={billDetails.subject}
                        onChange={e => setBillDetails({ ...billDetails, subject: e.target.value })} />
                    </label>
                  </>
                ) : (
                  <label style={{ width: "100%" }}>Subject
                    <input type="text" value={billDetails.subject}
                      onChange={e => setBillDetails({ ...billDetails, subject: e.target.value })} />
                  </label>
                )}
              </div>
            )}
            <div className="optionTogglesRow">
              <label className="toggleOption">
                <input type="checkbox" checked={billDetails.showClientDetails !== false}
                  onChange={e => setBillDetails({ ...billDetails, showClientDetails: e.target.checked })} />
                <span>Client Details (To)</span>
              </label>
              {billDetails.showClientDetails !== false && (
                <label className="toggleOption">
                  <input type="checkbox" checked={billDetails.showClientAddress !== false}
                    onChange={e => setBillDetails({ ...billDetails, showClientAddress: e.target.checked })} />
                  <span>Client Address</span>
                </label>
              )}
              <label className="toggleOption">
                <input type="checkbox" checked={billDetails.showNote}
                  onChange={e => setBillDetails({ ...billDetails, showNote: e.target.checked })} />
                <span>Note</span>
              </label>
              <label className="toggleOption">
                <input type="checkbox" checked={billDetails.showSignature}
                  onChange={e => setBillDetails({ ...billDetails, showSignature: e.target.checked })} />
                <span>Signature</span>
              </label>
            </div>
            {(billDetails.showNote || billDetails.showSignature) && (
              <div className="detailsRow" style={{ marginTop: 8 }}>
                {billDetails.showNote && (
                  <label>Note Text
                    <textarea value={billDetails.note}
                      onChange={e => setBillDetails({ ...billDetails, note: e.target.value })}
                      placeholder="GST 18% will be provided by the client."
                      rows={2}
                      className="cellTextarea"
                      style={{ minHeight: 45, resize: "vertical" }} />
                  </label>
                )}
                {billDetails.showSignature && (
                  <label>Proprietor Name
                    <input type="text" value={billDetails.proprietorName}
                      onChange={e => setBillDetails({ ...billDetails, proprietorName: e.target.value })}
                      placeholder="Mr. Dharmendra Vishwakarma" />
                  </label>
                )}
              </div>
            )}
          </div>

          {/* 4. Live Table */}
          <div className="scannerSection">
            <div className="sectionHeader">
              <h4>4️⃣ Items Table</h4>

              <div className="tableFormattingToolbar" style={{ margin: "0 auto 0 16px" }}>
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

              <button className="primaryButton compact" onClick={addRow}>
                <Plus size={13} /> Add Row
              </button>
            </div>

            <div className="liveTableWrap">
              <table className="liveTable">
                <thead>
                  <tr>
                    <th style={{ width: 32 }}>Sr</th>
                    <th>Particulars</th>
                    <th style={{ width: 86 }}>Size</th>
                    <th style={{ width: 70 }}>Qty</th>
                    <th style={{ width: 78 }}>Rate</th>
                    <th style={{ width: 88 }}>Amount ₹</th>
                    <th style={{ width: 28 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => (
                    <tr key={row.id} style={{ background: selectedRowId === row.id ? "#f8fafc" : undefined }}>
                      <td className="tdCenter" onFocus={() => setSelectedRowId(row.id)}>{row.sr}</td>
                      <td>
                        <textarea className="cellTextarea" value={row.particulars} rows={2}
                          onChange={e => updateRow(row.id, "particulars", e.target.value)}
                          placeholder="Item description…"
                          onFocus={() => setSelectedRowId(row.id)}
                          style={{
                            fontWeight: row.bold ? "bold" : "normal",
                            fontSize: row.fontSize ? `${row.fontSize}px` : "13px",
                            textAlign: row.align || "left"
                          }} />
                      </td>
                      <td>
                        <input className="cellInput" type="text" value={row.size}
                          onChange={e => updateRow(row.id, "size", e.target.value)}
                          placeholder="e.g. 10x5"
                          onFocus={() => setSelectedRowId(row.id)} />
                        {parseSize(row.size) > 0 && (
                          <small className="sizeCalc">= {parseSize(row.size)}</small>
                        )}
                      </td>
                      <td>
                        <input className="cellInput cellRight" type="number"
                          value={row.quantity || ""}
                          onChange={e => updateRow(row.id, "quantity", e.target.value)}
                          placeholder="0"
                          onFocus={() => setSelectedRowId(row.id)} />
                      </td>
                      <td>
                        <input className="cellInput cellRight" type="number"
                          value={row.rate || ""}
                          onChange={e => updateRow(row.id, "rate", e.target.value)}
                          placeholder="0"
                          onFocus={() => setSelectedRowId(row.id)} />
                      </td>
                      <td>
                        <input className="cellInput cellRight amountCell" type="number"
                          value={row.amount || ""}
                          onChange={e => setRows(prev => prev.map(r =>
                            r.id === row.id ? { ...r, amount: parseFloat(e.target.value) || 0 } : r
                          ))}
                          placeholder="0"
                          onFocus={() => setSelectedRowId(row.id)} />
                      </td>
                      <td>
                        <button className="miniButton danger" onClick={() => deleteRow(row.id)}
                          disabled={rows.length === 1}>
                          <Trash2 size={12} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="tfootTotal">
                    <td colSpan={5} className="tdRight"><strong>Total (SUM)</strong></td>
                    <td className="tdRight totalAmt"><strong>₹ {total.toLocaleString("en-IN")}</strong></td>
                    <td></td>
                  </tr>
                  <tr>
                    <td colSpan={5} className="tdRight">Advance</td>
                    <td className="tdRight">
                      <input className="cellInput cellRight" type="number"
                        value={billDetails.advance || ""}
                        onChange={e => setBillDetails({ ...billDetails, advance: parseFloat(e.target.value) || 0 })}
                        placeholder="0" />
                    </td>
                    <td></td>
                  </tr>
                  <tr className="tfootBalance">
                    <td colSpan={5} className="tdRight"><strong>Balance (Total − Advance)</strong></td>
                    <td className="tdRight balAmt"><strong>₹ {balance.toLocaleString("en-IN")}</strong></td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="formulaNote">
              💡 Amount = Quantity × Rate (auto). Balance = Total − Advance (auto).
              Use the <strong>AI tab</strong> to edit with natural language.
            </p>
          </div>

          {/* 5. Export */}
          <div className="scannerSection exportSection">
            <h4>5️⃣ Export</h4>
            {exportStatus && <p className="statusText">{exportStatus}</p>}
            <div className="exportButtons">
              <button className="exportBtn pdf"   disabled={isExporting} onClick={() => doExport("pdf")}>
                <FileText size={18} /><span>PDF</span>
              </button>
              <button className="exportBtn excel" disabled={isExporting} onClick={() => doExport("excel")}>
                <FileSpreadsheet size={18} /><span>Excel</span>
              </button>
              <button className="exportBtn word"  disabled={isExporting} onClick={() => doExport("word")}>
                <FileType size={18} /><span>Word</span>
              </button>
            </div>
          </div>

        </div>
      )}

      {/* ════════════════════════════════════════════
          TAB 2 — AI ASSISTANT
      ════════════════════════════════════════════ */}
      {activeTab === "ai" && (
        <div className="aiChatPanelInner">

          {/* context bar */}
          <div className="aiContextPill">
            <Sparkles size={13} />
            <span>
              {rows.length} rows &nbsp;·&nbsp;
              Total ₹{total.toLocaleString("en-IN")} &nbsp;·&nbsp;
              Balance ₹{balance.toLocaleString("en-IN")}
            </span>
          </div>

          {/* messages */}
          <div className="aiChatMessages aiChatMessagesScanner">
            {chatMsgs.map(msg => (
              <div key={msg.id} className={`aiMessage ${msg.role === "user" ? "user" : "assistant"}`}>
                <div className="aiMsgIcon">
                  {msg.role === "user" ? <User size={13} /> : <Bot size={13} />}
                </div>
                <div className="aiMessageContent" style={{ whiteSpace: "pre-wrap" }}>
                  {msg.text}
                </div>
              </div>
            ))}
            {isAiThinking && (
              <div className="aiMessage assistant">
                <div className="aiMsgIcon"><Bot size={13} /></div>
                <div className="aiMessageContent">
                  <Loader2 size={13} className="spinning" /> Thinking…
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* quick prompt chips */}
          <div className="quickPrompts">
            {[
              "add row for window glass 10x5 rate 200",
              "delete last row",
              "add 18% GST",
              "set advance to 50000",
              "apply 10% discount",
              "clear table",
            ].map(p => (
              <button key={p} className="quickPromptBtn"
                onClick={() => setChatInput(p)}>
                {p}
              </button>
            ))}
          </div>

          {/* input */}
          <div className="aiChatInputRow">
            <input
              type="text"
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") sendChat(); }}
              placeholder="Type a command… e.g. change row 2 rate to 350"
              disabled={isAiThinking}
            />
            <button className="sendBtn" onClick={sendChat}
              disabled={!chatInput.trim() || isAiThinking}>
              {isAiThinking
                ? <Loader2 size={16} className="spinning" />
                : <Send size={16} />}
            </button>
          </div>

        </div>
      )}

    </div>
  );
}
