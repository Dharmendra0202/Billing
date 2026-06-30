import { Download, FileImage, FilePlus2, Printer, Replace, RotateCcw, Save, Upload } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import Tesseract from "tesseract.js";
import { AIChat } from "./components/AIChat";
import { BillPreview } from "./components/BillPreview";
import { BillTableEditor } from "./components/BillTableEditor";
import { HeaderEditor } from "./components/HeaderEditor";
import { initialHeader, initialTables } from "./data/initialBill";
import { grandTotal, makeId, money } from "./lib/billMath";
import type { BillTable, HeaderTemplate } from "./types";

export function App() {
  const [header, setHeader] = useState<HeaderTemplate>(() => {
    const saved = localStorage.getItem("bill.header");
    return saved ? JSON.parse(saved) : initialHeader;
  });
  const [tables, setTables] = useState<BillTable[]>(() => {
    const saved = localStorage.getItem("bill.tables");
    return saved ? JSON.parse(saved) : initialTables;
  });
  const [sourceFile, setSourceFile] = useState<string>("");
  const [rawImagePreview, setRawImagePreview] = useState<string>("");
  const [rawImageFile, setRawImageFile] = useState<File | null>(null);
  const [extractedText, setExtractedText] = useState("");
  const [convertedText, setConvertedText] = useState("");
  const [imagePrompt, setImagePrompt] = useState(
    "Convert this raw image into text and replace point values using the inch conversion chart."
  );
  const [ocrStatus, setOcrStatus] = useState("");
  const [isExtracting, setIsExtracting] = useState(false);
  const headerInputRef = useRef<HTMLInputElement>(null);
  const rawImageInputRef = useRef<HTMLInputElement>(null);

  const total = useMemo(() => grandTotal(tables), [tables]);

  const saveTemplate = () => {
    localStorage.setItem("bill.header", JSON.stringify(header));
    localStorage.setItem("bill.tables", JSON.stringify(tables));
  };

  const resetSample = () => {
    setHeader(initialHeader);
    setTables(initialTables);
    localStorage.removeItem("bill.header");
    localStorage.removeItem("bill.tables");
  };

  const addTable = () => {
    const amountId = makeId("col");
    setTables([
      ...tables,
      {
        id: makeId("table"),
        title: `Table ${tables.length + 1}`,
        columns: [
          { id: makeId("col"), label: "Particulars", kind: "text" },
          { id: amountId, label: "Amount", kind: "number" }
        ],
        rows: [{ id: makeId("row"), cells: { [amountId]: "0" } }]
      }
    ]);
  };

  const pickHeaderImage = async () => {
    if (window.billDesktop?.openImage) {
      const filePath = await window.billDesktop.openImage();
      if (filePath) setSourceFile(filePath);
      return;
    }

    headerInputRef.current?.click();
  };

  const pickRawImage = async () => {
    rawImageInputRef.current?.click();
  };

  const handleRawImage = (file: File) => {
    setSourceFile(file.name);
    setRawImageFile(file);
    setExtractedText("");
    setConvertedText("");
    setOcrStatus("");
    setRawImagePreview((currentPreview) => {
      if (currentPreview) URL.revokeObjectURL(currentPreview);
      return URL.createObjectURL(file);
    });
  };

  const extractTextFromImage = async () => {
    if (!rawImageFile) {
      setOcrStatus("Upload an image first.");
      return;
    }

    setIsExtracting(true);
    setExtractedText("");
    setOcrStatus("Starting OCR...");

    try {
      const result = await Tesseract.recognize(rawImageFile, "eng", {
        logger: (message) => {
          const progress = Math.round((message.progress || 0) * 100);
          setOcrStatus(progress ? `${message.status} ${progress}%` : message.status);
        }
      });

      setExtractedText(result.data.text.trim());
      setConvertedText(convertPointValues(result.data.text.trim()));
      setOcrStatus("Text extraction complete.");
    } catch (error) {
      setOcrStatus(error instanceof Error ? error.message : "Text extraction failed.");
    } finally {
      setIsExtracting(false);
    }
  };

  const inchConversionMap: Record<string, string> = {
    ".2": ".18",
    ".3": ".25",
    ".4": ".32",
    ".5": ".42",
    ".6": ".50",
    ".7": ".58",
    ".8": ".66",
    ".9": ".75",
    ".10": ".82",
    ".11": ".92",
    "1 inch": ".08"
  };

  const convertPointValues = (text: string) => {
    let converted = text;

    Object.entries(inchConversionMap)
      .sort(([a], [b]) => b.length - a.length)
      .forEach(([source, target]) => {
        const escaped = source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        converted = converted.replace(new RegExp(`(^|[^\\d])${escaped}(?=$|[^\\d])`, "gi"), `$1${target}`);
      });

    return converted;
  };

  const runPromptConversion = () => {
    if (!extractedText.trim()) {
      setOcrStatus("Extract text first, then run the prompt conversion.");
      return;
    }

    setConvertedText(convertPointValues(extractedText));
    setOcrStatus("Point values replaced using the inch conversion chart.");
  };

  const printBill = async () => {
    if (window.billDesktop?.printBill) {
      await window.billDesktop.printBill();
      return;
    }
    window.print();
  };

  const handleAIUpdate = (newHeader: HeaderTemplate, newTables: BillTable[]) => {
    setHeader(newHeader);
    setTables(newTables);
    localStorage.setItem("bill.header", JSON.stringify(newHeader));
    localStorage.setItem("bill.tables", JSON.stringify(newTables));
  };

  return (
    <main className="appShell">
      <input
        ref={headerInputRef}
        className="hiddenInput"
        type="file"
        accept="image/*,.pdf"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) setSourceFile(file.name);
        }}
      />
      <input
        ref={rawImageInputRef}
        className="hiddenInput"
        type="file"
        accept="image/*"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          handleRawImage(file);
        }}
      />
      <aside className="sidebar">
        <div className="brand">
          <span>BA</span>
          <div>
            <strong>Bill AI</strong>
            <small>Desktop Builder</small>
          </div>
        </div>

        <nav>
          <button className="active">Create Bill</button>
          <button>Templates</button>
          <button>Saved Bills</button>
          <button>OCR Center</button>
          <button>Settings</button>
        </nav>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Desktop invoice formatter</p>
            <h1>Header from image, tables by you</h1>
          </div>
          <div className="topActions">
            <button className="textButton" onClick={pickRawImage}>
              <FileImage size={17} /> Upload raw image
            </button>
            <button className="textButton" onClick={pickHeaderImage}>
              <Upload size={17} /> Upload header
            </button>
            <button className="textButton" onClick={saveTemplate}>
              <Save size={17} /> Save
            </button>
            <button className="textButton" onClick={resetSample}>
              <RotateCcw size={17} /> Reset sample
            </button>
            <button className="primaryButton" onClick={printBill}>
              <Printer size={17} /> Print / PDF
            </button>
          </div>
        </header>

        <div className="contentGrid">
          <div className="editorStack">
            <HeaderEditor header={header} onChange={setHeader} onPickImage={pickHeaderImage} />

            {sourceFile && (
              <div className="fileBanner">
                <Upload size={16} />
                <span>{sourceFile}</span>
              </div>
            )}

            <section className="panel rawImagePanel">
              <div className="panelHeader">
                <div>
                  <p className="eyebrow">Image template</p>
                  <h2>Raw Image Upload</h2>
                </div>
                <button className="primaryButton compact" onClick={pickRawImage}>
                  <FileImage size={17} /> Upload raw image
                </button>
              </div>
              {rawImagePreview ? (
                <div className="rawImageGrid">
                  <div>
                    <img className="rawImagePreview" src={rawImagePreview} alt="Uploaded raw bill template" />
                    <div className="rawImageActions">
                      <button className="textButton" onClick={pickRawImage}>
                        <FileImage size={17} /> Change image
                      </button>
                      <button className="primaryButton" onClick={extractTextFromImage} disabled={isExtracting}>
                        {isExtracting ? "Extracting..." : "Extract text"}
                      </button>
                    </div>
                  </div>
                  <div className="ocrPanel">
                    <div>
                      <p className="eyebrow">Chat-style raw image workflow</p>
                      <h3>Prompt + OCR</h3>
                    </div>
                    <label className="promptBox">
                      Prompt
                      <textarea
                        value={imagePrompt}
                        onChange={(event) => setImagePrompt(event.target.value)}
                        placeholder="Tell the app what to extract or replace."
                      />
                    </label>
                    {ocrStatus && <p className="ocrStatus">{ocrStatus}</p>}
                    <div className="ocrOutputGrid">
                      <label>
                        Extracted text
                        <textarea
                          className="ocrText"
                          value={extractedText}
                          onChange={(event) => {
                            setExtractedText(event.target.value);
                            setConvertedText(convertPointValues(event.target.value));
                          }}
                          placeholder="Extracted text will appear here after OCR."
                        />
                      </label>
                      <label>
                        Converted text
                        <textarea
                          className="ocrText"
                          value={convertedText}
                          onChange={(event) => setConvertedText(event.target.value)}
                          placeholder="Point values replaced from the inch conversion chart will appear here."
                        />
                      </label>
                    </div>
                    <div className="conversionFooter">
                      <button className="textButton" onClick={runPromptConversion}>
                        <Replace size={17} /> Replace point values
                      </button>
                      <span>.2→.18, .3→.25, .4→.32, .5→.42, .6→.50, .7→.58, .8→.66, .9→.75, .10→.82, .11→.92</span>
                    </div>
                  </div>
                </div>
              ) : (
                <button className="uploadDropzone" onClick={pickRawImage}>
                  <FileImage size={22} />
                  <span>Upload the bill/template image you want to use for value replacement later.</span>
                </button>
              )}
            </section>

            <section className="panel">
              <div className="panelHeader">
                <div>
                  <p className="eyebrow">Manual builder</p>
                  <h2>Bill Tables</h2>
                </div>
                <button className="primaryButton compact" onClick={addTable}>
                  <FilePlus2 size={17} /> Add table
                </button>
              </div>

              <div className="summaryBar">
                <span>Total tables: {tables.length}</span>
                <strong>{money(total)}</strong>
              </div>

              {tables.map((table) => (
                <BillTableEditor
                  key={table.id}
                  table={table}
                  tables={tables}
                  onChange={(nextTable) => setTables(tables.map((item) => (item.id === table.id ? nextTable : item)))}
                  onDelete={() => setTables(tables.filter((item) => item.id !== table.id))}
                />
              ))}
            </section>
          </div>

          <div className="previewPane">
            <div className="previewHeader">
              <div>
                <p className="eyebrow">Live preview</p>
                <h2>Printable Output</h2>
              </div>
              <button className="iconButton" onClick={printBill} title="Export with print dialog">
                <Download size={18} />
              </button>
            </div>
            <BillPreview header={header} tables={tables} />
          </div>
        </div>
      </section>

      <AIChat header={header} tables={tables} onUpdate={handleAIUpdate} />
    </main>
  );
}
