import {
  Camera, FileSpreadsheet, FileText, FileType,
  Loader2, ScanLine, Upload, Ruler, Plus, Trash2,
  RefreshCw
} from "lucide-react";
import { useState, useRef, useMemo } from "react";
import { AIService } from "../lib/aiService";
import { exportProfessionalPDF, exportProfessionalExcel, exportProfessionalWord } from "../lib/documentExport";
import { convertAllPointValues } from "../lib/inchConversion";
import type { HeaderTemplate, BillDetails } from "../types";
import { initialBillDetails } from "../data/initialBill";

// ─── Row type used only inside the scanner ───────────────────────────────────
type ScannedRow = {
  id: string;
  sr: number;
  particulars: string;
  size: string;    // raw string so user can type "10x12" or "5.50"
  rate: number;
  amount: number;  // always = parsedSize * rate, recalculated live
};

function parseSize(size: string): number {
  // handles "10x12", "10 x 12", "10*12", plain "5.50", etc.
  const clean = size.trim();
  const multiMatch = clean.match(/^([\d.]+)\s*[x*×]\s*([\d.]+)$/i);
  if (multiMatch) {
    return parseFloat(multiMatch[1]) * parseFloat(multiMatch[2]);
  }
  return parseFloat(clean) || 0;
}

function calcAmount(size: string, rate: number): number {
  return Math.round(parseSize(size) * rate * 100) / 100;
}

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

// ─── Props ────────────────────────────────────────────────────────────────────
type Props = {
  header: HeaderTemplate;
  onHeaderChange: (h: HeaderTemplate) => void;
};

export function BillScanner({ header, onHeaderChange }: Props) {
  const [isOpen, setIsOpen] = useState(false);

  // image
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [scanStatus, setScanStatus] = useState("");
  const [applyInchConversion, setApplyInchConversion] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // rows — this IS the live editable table
  const [rows, setRows] = useState<ScannedRow[]>([
    { id: uid(), sr: 1, particulars: "", size: "1", rate: 0, amount: 0 }
  ]);

  // bill details
  const [billDetails, setBillDetails] = useState<BillDetails>(initialBillDetails);
  const [isExporting, setIsExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState("");

  // ── derived totals ──────────────────────────────────────────────────────────
  const total   = useMemo(() => rows.reduce((s, r) => s + r.amount, 0), [rows]);
  const balance = total - billDetails.advance;

  // ── image select ────────────────────────────────────────────────────────────
  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { alert("Please select an image file"); return; }
    if (file.size > 10 * 1024 * 1024) { alert("Image must be < 10 MB"); return; }
    setSelectedImage(await AIService.fileToBase64(file));
    setScanStatus("Image ready. Click Scan.");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // ── scan ────────────────────────────────────────────────────────────────────
  const scanBill = async () => {
    if (!selectedImage) { setScanStatus("Upload an image first."); return; }
    setIsScanning(true);
    setScanStatus("🔍 AI is reading the bill… (10–30 sec)");
    try {
      const ai  = new AIService("", "ollama");
      const raw = await ai.extractBillFromImage(selectedImage);

      // parse JSON from AI response
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) throw new Error("AI did not return valid JSON. Try again.");
      const data = JSON.parse(match[0]);

      if (!data.items || !Array.isArray(data.items) || data.items.length === 0) {
        setScanStatus("⚠️ No items found. Try a clearer image.");
        return;
      }

      // build rows
      const newRows: ScannedRow[] = data.items.map((item: any, idx: number) => {
        let sizeStr = String(item.size ?? item.quantity ?? "1");
        if (applyInchConversion) sizeStr = convertAllPointValues(sizeStr);

        const rate   = parseFloat(item.rate)   || 0;
        const amount = parseFloat(item.amount) || calcAmount(sizeStr, rate);

        return {
          id: uid(),
          sr: item.sr ?? idx + 1,
          particulars: String(item.particulars ?? item.name ?? ""),
          size: sizeStr,
          rate,
          amount
        };
      });

      setRows(newRows);

      // pull advance / balance if AI returned them
      if (data.advance) {
        setBillDetails(prev => ({ ...prev, advance: parseFloat(data.advance) || 0 }));
      }

      setScanStatus(`✅ ${newRows.length} rows extracted. Edit below then export.`);
    } catch (err) {
      setScanStatus(`❌ ${err instanceof Error ? err.message : "Scan failed"}`);
    } finally {
      setIsScanning(false);
    }
  };

  // ── row helpers ─────────────────────────────────────────────────────────────
  const updateRow = (id: string, field: keyof ScannedRow, raw: string) => {
    setRows(prev => prev.map(r => {
      if (r.id !== id) return r;
      const next = { ...r, [field]: field === "particulars" || field === "size" ? raw : parseFloat(raw) || 0 };
      // recalculate amount whenever size or rate changes
      if (field === "size" || field === "rate") {
        next.amount = calcAmount(next.size, next.rate);
      }
      // if user edits amount directly, don't override
      return next;
    }));
  };

  const addRow = () => {
    setRows(prev => [
      ...prev,
      { id: uid(), sr: prev.length + 1, particulars: "", size: "1", rate: 0, amount: 0 }
    ]);
  };

  const deleteRow = (id: string) => {
    setRows(prev => {
      const next = prev.filter(r => r.id !== id);
      // re-number
      return next.map((r, i) => ({ ...r, sr: i + 1 }));
    });
  };

  // ── convert rows → BillTable for export functions ──────────────────────────
  const toBillTable = () => {
    const srId  = "sr";
    const pId   = "particulars";
    const sId   = "size";
    const rId   = "rate";
    const aId   = "amount";
    return [{
      id: "scanner-table",
      title: "Bill Items",
      columns: [
        { id: srId, label: "Sr. No",       kind: "number" as const },
        { id: pId,  label: "Particulars",  kind: "text"   as const },
        { id: sId,  label: "Size",         kind: "text"   as const },
        { id: rId,  label: "Rate",         kind: "number" as const },
        { id: aId,  label: "Amount",       kind: "number" as const }
      ],
      rows: rows.map(r => ({
        id: r.id,
        cells: {
          [srId]: String(r.sr),
          [pId]:  r.particulars,
          [sId]:  r.size,
          [rId]:  String(r.rate),
          [aId]:  String(r.amount)
        }
      }))
    }];
  };

  // ── export ──────────────────────────────────────────────────────────────────
  const doExport = async (type: "pdf" | "excel" | "word") => {
    setIsExporting(true);
    setExportStatus("");
    const tables = toBillTable();
    const filename = `bill-${billDetails.clientName || "draft"}`.replace(/\s+/g, "-");
    try {
      if (type === "pdf")   await exportProfessionalPDF(header, tables, billDetails, filename);
      if (type === "excel") await exportProfessionalExcel(header, tables, billDetails, filename);
      if (type === "word")  await exportProfessionalWord(header, tables, billDetails, filename);
      setExportStatus(`✅ ${type.toUpperCase()} downloaded!`);
    } catch (e) {
      setExportStatus(`❌ Export failed: ${e}`);
    }
    setIsExporting(false);
  };

  // ── toggle button ────────────────────────────────────────────────────────────
  if (!isOpen) {
    return (
      <button className="billScannerToggle" onClick={() => setIsOpen(true)} title="Bill Scanner & Export">
        <ScanLine size={24} />
      </button>
    );
  }

  // ── panel ────────────────────────────────────────────────────────────────────
  return (
    <div className="billScannerPanel">
      {/* header bar */}
      <div className="scannerHeader">
        <div>
          <h3>📷 Bill Scanner</h3>
          <small>Upload → Scan → Edit → Export</small>
        </div>
        <button className="closeBtn" onClick={() => setIsOpen(false)}>×</button>
      </div>

      <div className="scannerContent">

        {/* ── STEP 1 : upload ─────────────────────────────────────────────── */}
        <div className="scannerSection">
          <h4>1️⃣ Upload Bill Image</h4>
          <input ref={fileInputRef} type="file" accept="image/*"
            style={{ display: "none" }} onChange={handleImageSelect} />

          {selectedImage ? (
            <div className="imagePreviewBox">
              <img src={selectedImage} alt="bill" />
              <button className="changeBtn" onClick={() => fileInputRef.current?.click()}>
                <Upload size={14} /> Change
              </button>
            </div>
          ) : (
            <button className="uploadDropzone" onClick={() => fileInputRef.current?.click()}>
              <Camera size={32} />
              <span>Click to upload bill image</span>
              <small>JPG, PNG — max 10 MB</small>
            </button>
          )}
        </div>

        {/* ── STEP 2 : scan ───────────────────────────────────────────────── */}
        <div className="scannerSection">
          <h4>2️⃣ Scan with AI</h4>

          <label className="inchToggleRow">
            <input type="checkbox" checked={applyInchConversion}
              onChange={e => setApplyInchConversion(e.target.checked)} />
            <Ruler size={14} />
            <span>Auto-convert inch points (.6→.50 etc.)</span>
          </label>

          <button className="scanBtn" onClick={scanBill}
            disabled={!selectedImage || isScanning}>
            {isScanning
              ? <><Loader2 size={16} className="spinning" /> Scanning…</>
              : <><ScanLine size={16} /> Scan Bill</>}
          </button>

          {scanStatus && <p className="statusText">{scanStatus}</p>}
        </div>

        {/* ── STEP 3 : bill details ────────────────────────────────────────── */}
        <div className="scannerSection billDetailsSection">
          <h4>3️⃣ Bill Details</h4>
          <div className="detailsRow">
            <label>Date
              <input type="text" value={billDetails.date}
                onChange={e => setBillDetails({ ...billDetails, date: e.target.value })}
                placeholder="DD/MM/YYYY" />
            </label>
            <label>Client Name
              <input type="text" value={billDetails.clientName}
                onChange={e => setBillDetails({ ...billDetails, clientName: e.target.value })}
                placeholder="Atharv Palace" />
            </label>
          </div>
          <div className="detailsRow">
            <label>Client Address
              <input type="text" value={billDetails.clientAddress}
                onChange={e => setBillDetails({ ...billDetails, clientAddress: e.target.value })}
                placeholder="Vile Parle East" />
            </label>
            <label>Subject
              <input type="text" value={billDetails.subject}
                onChange={e => setBillDetails({ ...billDetails, subject: e.target.value })} />
            </label>
          </div>
          <div className="optionTogglesRow">
            <label className="toggleOption">
              <input type="checkbox" checked={billDetails.showNote}
                onChange={e => setBillDetails({ ...billDetails, showNote: e.target.checked })} />
              <span>Show Note</span>
            </label>
            <label className="toggleOption">
              <input type="checkbox" checked={billDetails.showSignature}
                onChange={e => setBillDetails({ ...billDetails, showSignature: e.target.checked })} />
              <span>Show Signature</span>
            </label>
          </div>
        </div>

        {/* ── STEP 4 : live editable table ─────────────────────────────────── */}
        <div className="scannerSection tableSection">
          <div className="sectionHeader">
            <h4>4️⃣ Edit Items Table</h4>
            <button className="primaryButton compact" onClick={addRow}>
              <Plus size={14} /> Add Row
            </button>
          </div>

          <div className="liveTableWrap">
            <table className="liveTable">
              <thead>
                <tr>
                  <th style={{ width: 36 }}>Sr</th>
                  <th>Particulars</th>
                  <th style={{ width: 90 }}>Size</th>
                  <th style={{ width: 80 }}>Rate (₹)</th>
                  <th style={{ width: 90 }}>Amount (₹)</th>
                  <th style={{ width: 30 }}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    {/* Sr */}
                    <td className="tdCenter">{row.sr}</td>

                    {/* Particulars */}
                    <td>
                      <textarea
                        className="cellTextarea"
                        value={row.particulars}
                        onChange={e => updateRow(row.id, "particulars", e.target.value)}
                        rows={2}
                        placeholder="Item description…"
                      />
                    </td>

                    {/* Size — shows inch conversion hint */}
                    <td>
                      <input
                        className="cellInput"
                        type="text"
                        value={row.size}
                        onChange={e => updateRow(row.id, "size", e.target.value)}
                        placeholder="e.g. 10x5"
                      />
                      {parseSize(row.size) > 0 && (
                        <small className="sizeCalc">= {parseSize(row.size)}</small>
                      )}
                    </td>

                    {/* Rate */}
                    <td>
                      <input
                        className="cellInput cellRight"
                        type="number"
                        value={row.rate || ""}
                        onChange={e => updateRow(row.id, "rate", e.target.value)}
                        placeholder="0"
                      />
                    </td>

                    {/* Amount — live = size * rate, but user can override */}
                    <td>
                      <input
                        className="cellInput cellRight amountCell"
                        type="number"
                        value={row.amount || ""}
                        onChange={e => {
                          // user override: just set amount directly
                          setRows(prev => prev.map(r =>
                            r.id === row.id
                              ? { ...r, amount: parseFloat(e.target.value) || 0 }
                              : r
                          ));
                        }}
                        placeholder="0"
                      />
                    </td>

                    {/* Delete */}
                    <td>
                      <button className="miniButton danger"
                        onClick={() => deleteRow(row.id)}
                        disabled={rows.length === 1}>
                        <Trash2 size={12} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>

              {/* ── formula footer ─────────────────────────────── */}
              <tfoot>
                <tr className="tfootTotal">
                  <td colSpan={4} className="tdRight"><strong>Total (SUM)</strong></td>
                  <td className="tdRight totalAmt">
                    <strong>₹ {total.toLocaleString("en-IN")}</strong>
                  </td>
                  <td></td>
                </tr>
                <tr>
                  <td colSpan={4} className="tdRight">Advance</td>
                  <td className="tdRight">
                    <input
                      className="cellInput cellRight"
                      type="number"
                      value={billDetails.advance || ""}
                      onChange={e => setBillDetails({ ...billDetails, advance: parseFloat(e.target.value) || 0 })}
                      placeholder="0"
                    />
                  </td>
                  <td></td>
                </tr>
                <tr className="tfootBalance">
                  <td colSpan={4} className="tdRight"><strong>Balance (Total − Advance)</strong></td>
                  <td className="tdRight balAmt">
                    <strong>₹ {balance.toLocaleString("en-IN")}</strong>
                  </td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>

          <p className="formulaNote">
            💡 Amount = Size × Rate (auto-calculated). Edit any cell freely. Balance = Total − Advance.
          </p>
        </div>

        {/* ── STEP 5 : export ──────────────────────────────────────────────── */}
        <div className="scannerSection exportSection">
          <h4>5️⃣ Export</h4>
          {exportStatus && <p className="statusText">{exportStatus}</p>}
          <div className="exportButtons">
            <button className="exportBtn pdf"  disabled={isExporting} onClick={() => doExport("pdf")}>
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
    </div>
  );
}
