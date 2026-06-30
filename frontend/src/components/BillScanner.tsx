import { Camera, FileSpreadsheet, FileText, FileType, Loader2, ScanLine, Upload, Check, Edit3 } from "lucide-react";
import { useState, useRef } from "react";
import { AIService } from "../lib/aiService";
import {
  exportToPDF,
  exportToExcel,
  exportToWord,
  parseBillDataFromAI,
  convertExtractedDataToTables,
  type ExtractedBillData
} from "../lib/documentExport";
import type { BillTable, HeaderTemplate } from "../types";

type Props = {
  header: HeaderTemplate;
  tables: BillTable[];
  onUpdate: (header: HeaderTemplate, tables: BillTable[]) => void;
};

export function BillScanner({ header, tables, onUpdate }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [extractedData, setExtractedData] = useState<ExtractedBillData | null>(null);
  const [rawResponse, setRawResponse] = useState<string>("");
  const [isExporting, setIsExporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      alert("Please select an image file");
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      alert("Image size should be less than 10MB");
      return;
    }

    try {
      const base64 = await AIService.fileToBase64(file);
      setSelectedImage(base64);
      setExtractedData(null);
      setRawResponse("");
      setStatus("Image loaded. Click 'Scan Bill' to extract data.");
    } catch (error) {
      alert("Failed to load image");
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const scanBill = async () => {
    if (!selectedImage) {
      setStatus("Please upload an image first");
      return;
    }

    setIsProcessing(true);
    setStatus("🔍 Scanning bill with AI... (this may take 10-30 seconds)");
    setExtractedData(null);

    try {
      const aiService = new AIService("", "ollama");
      const response = await aiService.extractBillFromImage(selectedImage);
      setRawResponse(response);

      const data = parseBillDataFromAI(response);
      if (data && data.items && data.items.length > 0) {
        setExtractedData(data);
        setStatus(`✅ Extracted ${data.items.length} items! You can now edit or export.`);
      } else {
        setStatus("⚠️ Could not parse structured data. Check the raw response below.");
      }
    } catch (error) {
      setStatus(`❌ Error: ${error instanceof Error ? error.message : "Failed to scan"}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const loadIntoEditor = () => {
    if (!extractedData) return;

    const { header: newHeader, tables: newTables } = convertExtractedDataToTables(extractedData);
    
    // Merge with existing header (keep logo if exists)
    const mergedHeader: HeaderTemplate = {
      ...header,
      businessName: newHeader.businessName || header.businessName,
      address: newHeader.address || header.address,
      phone: newHeader.phone || header.phone,
      gstNumber: newHeader.gstNumber || header.gstNumber
    };

    onUpdate(mergedHeader, newTables);
    setStatus("✅ Bill loaded into editor! You can now edit the tables.");
  };

  const handleExportPDF = async () => {
    setIsExporting(true);
    try {
      if (extractedData) {
        const { header: h, tables: t } = convertExtractedDataToTables(extractedData);
        const fullHeader: HeaderTemplate = { ...header, ...h } as HeaderTemplate;
        await exportToPDF(fullHeader, t, "scanned-bill");
      } else {
        await exportToPDF(header, tables, "bill");
      }
      setStatus("✅ PDF exported!");
    } catch (error) {
      setStatus(`❌ PDF export failed: ${error}`);
    }
    setIsExporting(false);
  };

  const handleExportExcel = async () => {
    setIsExporting(true);
    try {
      if (extractedData) {
        const { header: h, tables: t } = convertExtractedDataToTables(extractedData);
        const fullHeader: HeaderTemplate = { ...header, ...h } as HeaderTemplate;
        await exportToExcel(fullHeader, t, "scanned-bill");
      } else {
        await exportToExcel(header, tables, "bill");
      }
      setStatus("✅ Excel exported!");
    } catch (error) {
      setStatus(`❌ Excel export failed: ${error}`);
    }
    setIsExporting(false);
  };

  const handleExportWord = async () => {
    setIsExporting(true);
    try {
      if (extractedData) {
        const { header: h, tables: t } = convertExtractedDataToTables(extractedData);
        const fullHeader: HeaderTemplate = { ...header, ...h } as HeaderTemplate;
        await exportToWord(fullHeader, t, "scanned-bill");
      } else {
        await exportToWord(header, tables, "bill");
      }
      setStatus("✅ Word document exported!");
    } catch (error) {
      setStatus(`❌ Word export failed: ${error}`);
    }
    setIsExporting(false);
  };

  if (!isOpen) {
    return (
      <button
        className="billScannerToggle"
        onClick={() => setIsOpen(true)}
        title="Bill Scanner & Export"
      >
        <ScanLine size={24} />
      </button>
    );
  }

  return (
    <div className="billScannerPanel">
      <div className="scannerHeader">
        <div>
          <h3>📷 Bill Scanner</h3>
          <small>Scan → Edit → Export</small>
        </div>
        <button onClick={() => setIsOpen(false)} className="closeBtn">×</button>
      </div>

      <div className="scannerContent">
        {/* Step 1: Upload Image */}
        <div className="scannerSection">
          <h4>1️⃣ Upload Bill Image</h4>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleImageSelect}
            accept="image/*"
            style={{ display: "none" }}
          />
          
          {selectedImage ? (
            <div className="imagePreviewBox">
              <img src={selectedImage} alt="Bill" />
              <button onClick={() => fileInputRef.current?.click()} className="changeBtn">
                <Upload size={16} /> Change Image
              </button>
            </div>
          ) : (
            <button 
              className="uploadDropzone" 
              onClick={() => fileInputRef.current?.click()}
            >
              <Camera size={32} />
              <span>Click to upload bill image</span>
              <small>JPG, PNG (max 10MB)</small>
            </button>
          )}
        </div>

        {/* Step 2: Scan */}
        <div className="scannerSection">
          <h4>2️⃣ Scan with AI</h4>
          <button 
            className="scanBtn" 
            onClick={scanBill} 
            disabled={!selectedImage || isProcessing}
          >
            {isProcessing ? (
              <>
                <Loader2 size={18} className="spinning" /> Scanning...
              </>
            ) : (
              <>
                <ScanLine size={18} /> Scan Bill
              </>
            )}
          </button>
          
          {status && <p className="statusText">{status}</p>}
        </div>

        {/* Step 3: Preview Extracted Data */}
        {extractedData && (
          <div className="scannerSection extractedData">
            <h4>3️⃣ Extracted Data (Editable)</h4>
            
            <div className="dataPreview">
              <div className="dataRow">
                <strong>Business:</strong>
                <input 
                  type="text" 
                  value={extractedData.businessName || ""} 
                  onChange={(e) => setExtractedData({...extractedData, businessName: e.target.value})}
                />
              </div>
              {extractedData.address && (
                <div className="dataRow">
                  <strong>Address:</strong>
                  <input 
                    type="text" 
                    value={extractedData.address} 
                    onChange={(e) => setExtractedData({...extractedData, address: e.target.value})}
                  />
                </div>
              )}
              {extractedData.phone && (
                <div className="dataRow">
                  <strong>Phone:</strong>
                  <input 
                    type="text" 
                    value={extractedData.phone} 
                    onChange={(e) => setExtractedData({...extractedData, phone: e.target.value})}
                  />
                </div>
              )}
              {extractedData.gstNumber && (
                <div className="dataRow">
                  <strong>GST:</strong>
                  <input 
                    type="text" 
                    value={extractedData.gstNumber} 
                    onChange={(e) => setExtractedData({...extractedData, gstNumber: e.target.value})}
                  />
                </div>
              )}
              
              <table className="itemsTable">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Qty</th>
                    <th>Rate</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {extractedData.items.map((item, idx) => (
                    <tr key={idx}>
                      <td>
                        <input 
                          type="text" 
                          value={item.name} 
                          onChange={(e) => {
                            const newItems = [...extractedData.items];
                            newItems[idx] = {...item, name: e.target.value};
                            setExtractedData({...extractedData, items: newItems});
                          }}
                        />
                      </td>
                      <td>
                        <input 
                          type="number" 
                          value={item.quantity || 1} 
                          onChange={(e) => {
                            const newItems = [...extractedData.items];
                            newItems[idx] = {...item, quantity: parseFloat(e.target.value) || 1};
                            setExtractedData({...extractedData, items: newItems});
                          }}
                        />
                      </td>
                      <td>
                        <input 
                          type="number" 
                          value={item.rate || item.amount} 
                          onChange={(e) => {
                            const newItems = [...extractedData.items];
                            newItems[idx] = {...item, rate: parseFloat(e.target.value) || 0};
                            setExtractedData({...extractedData, items: newItems});
                          }}
                        />
                      </td>
                      <td>
                        <input 
                          type="number" 
                          value={item.amount} 
                          onChange={(e) => {
                            const newItems = [...extractedData.items];
                            newItems[idx] = {...item, amount: parseFloat(e.target.value) || 0};
                            setExtractedData({...extractedData, items: newItems});
                          }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3}><strong>Grand Total</strong></td>
                    <td><strong>₹{extractedData.grandTotal || extractedData.items.reduce((s, i) => s + i.amount, 0)}</strong></td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <button className="loadEditorBtn" onClick={loadIntoEditor}>
              <Edit3 size={16} /> Load into Bill Editor
            </button>
          </div>
        )}

        {/* Raw Response (collapsible) */}
        {rawResponse && (
          <details className="rawResponseBox">
            <summary>View Raw AI Response</summary>
            <pre>{rawResponse}</pre>
          </details>
        )}

        {/* Step 4: Export */}
        <div className="scannerSection exportSection">
          <h4>4️⃣ Export Document</h4>
          <p className="exportNote">
            {extractedData 
              ? "Export the scanned data above, or load into editor first to make more changes."
              : "Export your current bill from the editor."}
          </p>
          
          <div className="exportButtons">
            <button onClick={handleExportPDF} disabled={isExporting} className="exportBtn pdf">
              <FileText size={18} />
              <span>PDF</span>
            </button>
            <button onClick={handleExportExcel} disabled={isExporting} className="exportBtn excel">
              <FileSpreadsheet size={18} />
              <span>Excel</span>
            </button>
            <button onClick={handleExportWord} disabled={isExporting} className="exportBtn word">
              <FileType size={18} />
              <span>Word</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
