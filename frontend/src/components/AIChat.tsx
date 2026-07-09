import { MessageCircle, Send, Settings, X, Download, Trash2, Image, XCircle, Bot, User, Sparkles } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { AIService, type AIMessage } from "../lib/aiService";
import type { HeaderTemplate, BillDetails } from "../types";
import { safeParseJSON } from "../lib/jsonHelper";
import { parseSize } from "../lib/billMath";

// ── Row / Col types (same as App.tsx) ────────────────────────────────────────
type ColKind = "text" | "number" | "formula";
type ColDef = {
  id: string;
  label: string;
  kind: ColKind;
  width?: number;
  locked?: boolean;
  isSize?: boolean;
  isQuantity?: boolean;
  isRate?: boolean;
  isAmount?: boolean;
};
type EditorRow = { id: string; cells: Record<string, string> };

// ── helpers ───────────────────────────────────────────────────────────────────
function uid() { return Math.random().toString(36).slice(2, 9); }

function computeAmount(row: EditorRow, cols: ColDef[]): number {
  const qtyCol = cols.find(c => c.isQuantity);
  const rateCol = cols.find(c => c.isRate);
  if (!qtyCol || !rateCol) return 0;
  return Math.round((parseFloat(row.cells[qtyCol.id] || "0") || 0) * (parseFloat(row.cells[rateCol.id] || "0") || 0) * 100) / 100;
}

function renumber(rows: EditorRow[]): EditorRow[] {
  return rows.map((r, i) => ({ ...r, cells: { ...r.cells, sr: String(i + 1) } }));
}

function recalcAmounts(rows: EditorRow[], cols: ColDef[]): EditorRow[] {
  const amtCol = cols.find(c => c.isAmount);
  if (!amtCol) return rows;
  return rows.map(r => ({ ...r, cells: { ...r.cells, [amtCol.id]: String(computeAmount(r, cols)) } }));
}

// ── Props ─────────────────────────────────────────────────────────────────────
type Props = {
  header: HeaderTemplate;
  cols: ColDef[];
  rows: EditorRow[];
  billDetails: BillDetails;
  onHeaderChange: (h: HeaderTemplate) => void;
  onColsChange: (c: ColDef[]) => void;
  onRowsChange: (r: EditorRow[] | ((prev: EditorRow[]) => EditorRow[])) => void;
  onBillDetailsChange: (d: BillDetails) => void;
};

export function AIChat({
  header, cols, rows, billDetails,
  onHeaderChange, onColsChange, onRowsChange, onBillDetailsChange
}: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<AIMessage[]>([]);
  const [input, setInput] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [apiKey, setApiKey] = useState(() => localStorage.getItem("ai_api_key") || "");
  const [provider, setProvider] = useState<"openai" | "anthropic" | "ollama">(
    () => (localStorage.getItem("ai_provider") as any) || "ollama"
  );
  const [showSettings, setShowSettings] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [selectedImageName, setSelectedImageName] = useState<string>("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const aiServiceRef = useRef<AIService | null>(null);

  useEffect(() => {
    aiServiceRef.current = new AIService(apiKey || "", provider);
  }, [apiKey, provider]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const saveSettings = () => {
    localStorage.setItem("ai_api_key", apiKey);
    localStorage.setItem("ai_provider", provider);
    aiServiceRef.current = new AIService(apiKey || "", provider);
    setShowSettings(false);
  };

  // ── Image upload ──────────────────────────────────────────────────────────
  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { alert("Please select an image file"); return; }
    if (file.size > 10 * 1024 * 1024) { alert("Image must be < 10 MB"); return; }
    setSelectedImage(await AIService.fileToBase64(file));
    setSelectedImageName(file.name);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // ── Apply AI command to actual app state ─────────────────────────────────
  const applyCommand = (parsed: any): string => {
    const { action, data } = parsed;
    const amtCol  = cols.find(c => c.isAmount);
    const sizeCol = cols.find(c => c.isSize);
    const rateCol = cols.find(c => c.isRate);
    const partCol = cols.find(c => c.id === "particulars");

    switch (action) {

      case "ADD_ROW": {
        onRowsChange(prev => {
          const newCells: Record<string, string> = { sr: String(prev.length + 1) };
          cols.forEach(c => { newCells[c.id] = ""; });
          
          // Map dynamic fields matching column ID or label (case-insensitive)
          Object.keys(data).forEach(key => {
            if (key === "bold" || key === "fontSize" || key === "align") return;
            const col = cols.find(c => c.id === key || c.label.toLowerCase() === key.toLowerCase());
            if (col) {
              newCells[col.id] = String(data[key]);
            }
          });
          
          // Backward compatibility support for legacy key names
          if (data.particulars !== undefined && partCol && !newCells[partCol.id]) {
            newCells[partCol.id] = String(data.particulars);
          }
          if (data.size !== undefined && sizeCol && !newCells[sizeCol.id]) {
            newCells[sizeCol.id] = String(data.size);
          }
          if (data.rate !== undefined && rateCol && !newCells[rateCol.id]) {
            newCells[rateCol.id] = String(data.rate);
          }
          
          const qtyCol = cols.find(c => c.isQuantity);
          if (qtyCol) {
            newCells[qtyCol.id] = String(data.quantity !== undefined ? data.quantity : parseSize(newCells[sizeCol?.id ?? ""]));
          }
          
          newCells.bold = String(data.bold || false);
          newCells.fontSize = String(data.fontSize || 11);
          newCells.align = data.align || "left";
          const newRow: EditorRow = { id: uid(), cells: newCells };
          const next = [...prev, newRow];
          return recalcAmounts(next, cols);
        });
        break;
      }
 
      case "ADD_MULTIPLE_ROWS": {
        onRowsChange(prev => {
          const added: EditorRow[] = (data.rows || []).map((item: any, i: number) => {
            const cells: Record<string, string> = { sr: String(prev.length + i + 1) };
            cols.forEach(c => { cells[c.id] = ""; });
            
            // Map dynamic fields matching column ID or label (case-insensitive)
            Object.keys(item).forEach(key => {
              if (key === "bold" || key === "fontSize" || key === "align") return;
              const col = cols.find(c => c.id === key || c.label.toLowerCase() === key.toLowerCase());
              if (col) {
                cells[col.id] = String(item[key]);
              }
            });
            
            // Backward compatibility
            if (item.particulars !== undefined && partCol && !cells[partCol.id]) {
              cells[partCol.id] = String(item.particulars);
            }
            if (item.size !== undefined && sizeCol && !cells[sizeCol.id]) {
              cells[sizeCol.id] = String(item.size);
            }
            if (item.rate !== undefined && rateCol && !cells[rateCol.id]) {
              cells[rateCol.id] = String(item.rate);
            }
            
            const qtyCol = cols.find(c => c.isQuantity);
            if (qtyCol) {
              cells[qtyCol.id] = String(item.quantity !== undefined ? item.quantity : parseSize(cells[sizeCol?.id ?? ""]));
            }
            
            cells.bold = String(item.bold || false);
            cells.fontSize = String(item.fontSize || 11);
            cells.align = item.align || "left";
            return { id: uid(), cells };
          });
          return recalcAmounts(renumber([...prev, ...added]), cols);
        });
        break;
      }
 
      case "UPDATE_ROW": {
        onRowsChange(prev => {
          const updated = prev.map(r => {
            if (r.cells.sr !== String(data.sr)) return r;
            const next = { ...r, cells: { ...r.cells } };
            
            // Map dynamic fields matching column ID or label (case-insensitive)
            Object.keys(data).forEach(key => {
              if (key === "sr") return;
              if (key === "bold") { next.cells.bold = String(data.bold); return; }
              if (key === "fontSize") { next.cells.fontSize = String(data.fontSize); return; }
              if (key === "align") { next.cells.align = String(data.align); return; }
              
              const col = cols.find(c => c.id === key || c.label.toLowerCase() === key.toLowerCase());
              if (col) {
                next.cells[col.id] = String(data[key]);
                if (col.isSize) {
                  const qtyCol = cols.find(c => c.isQuantity);
                  if (qtyCol && data.quantity === undefined) {
                    next.cells[qtyCol.id] = String(parseSize(String(data[key])));
                  }
                }
              }
            });
            
            // Backward compatibility
            if (data.particulars !== undefined && partCol) next.cells[partCol.id] = String(data.particulars);
            if (data.size        !== undefined && sizeCol) {
              next.cells[sizeCol.id] = String(data.size);
              const qtyCol = cols.find(c => c.isQuantity);
              if (qtyCol && data.quantity === undefined) {
                next.cells[qtyCol.id] = String(parseSize(String(data.size)));
              }
            }
            if (data.quantity    !== undefined) {
              const qtyCol = cols.find(c => c.isQuantity);
              if (qtyCol) next.cells[qtyCol.id] = String(data.quantity);
            }
            if (data.rate        !== undefined && rateCol) next.cells[rateCol.id] = String(data.rate);
            
            return next;
          });
          return recalcAmounts(updated, cols);
        });
        break;
      }
 
      case "DELETE_ROW": {
        onRowsChange(prev =>
          renumber(recalcAmounts(prev.filter(r => r.cells.sr !== String(data.sr)), cols))
        );
        break;
      }
 
      case "DELETE_LAST_ROW": {
        onRowsChange(prev => {
          if (prev.length <= 1) return prev;
          return renumber(recalcAmounts(prev.slice(0, -1), cols));
        });
        break;
      }
 
      case "CLEAR_TABLE": {
        const blankCells: Record<string, string> = { sr: "1" };
        cols.forEach(c => { blankCells[c.id] = ""; });
        onRowsChange([{ id: uid(), cells: blankCells }]);
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
        onBillDetailsChange({ ...billDetails, [field]: parsedValue });
        break;
      }
 
      case "UPDATE_HEADER": {
        let val = data.value;
        if (data.field && data.field.startsWith("fontSize")) {
          val = parseInt(val) || undefined;
        }
        onHeaderChange({ ...header, [data.field]: val });
        break;
      }

      case "ADD_COLUMN": {
        const newId = uid();
        const newCol: ColDef = {
          id: newId,
          label: data.label || "New Column",
          kind: data.kind === "number" ? "number" : "text",
          width: 100
        };
        // Insert before amount col
        const amtIdx = cols.findIndex(c => c.isAmount);
        const nextCols = [...cols];
        nextCols.splice(amtIdx >= 0 ? amtIdx : nextCols.length, 0, newCol);
        onColsChange(nextCols);
        onRowsChange(prev => prev.map(r => ({ ...r, cells: { ...r.cells, [newId]: "" } })));
        break;
      }

      case "RENAME_COLUMN": {
        onColsChange(cols.map(c =>
          (c.id === data.colId || c.label === data.oldLabel)
            ? { ...c, label: data.newLabel }
            : c
        ));
        break;
      }

      case "APPLY_GST": {
        const pct = parseFloat(data.percent) || 18;
        onRowsChange(prev => {
          const currentTotal = prev.reduce((s, r) => s + (parseFloat(r.cells[amtCol?.id ?? ""] || "0") || 0), 0);
          const gstAmt = Math.round(currentTotal * pct) / 100;
          const cells: Record<string, string> = { sr: String(prev.length + 1) };
          cols.forEach(c => { cells[c.id] = ""; });
          if (partCol)  cells[partCol.id]  = `GST @ ${pct}%`;
          if (rateCol)  cells[rateCol.id]  = String(gstAmt);
          if (sizeCol)  cells[sizeCol.id]  = "1";
          if (amtCol)   cells[amtCol.id]   = String(gstAmt);
          return renumber([...prev, { id: uid(), cells }]);
        });
        break;
      }

      case "APPLY_DISCOUNT": {
        const pct = parseFloat(data.percent) || 10;
        onRowsChange(prev => {
          const currentTotal = prev.reduce((s, r) => s + (parseFloat(r.cells[amtCol?.id ?? ""] || "0") || 0), 0);
          const discAmt = -Math.round(currentTotal * pct) / 100;
          const cells: Record<string, string> = { sr: String(prev.length + 1) };
          cols.forEach(c => { cells[c.id] = ""; });
          if (partCol) cells[partCol.id] = `Discount @ ${pct}%`;
          if (rateCol) cells[rateCol.id] = String(discAmt);
          if (sizeCol) cells[sizeCol.id] = "1";
          if (amtCol)  cells[amtCol.id]  = String(discAmt);
          return renumber([...prev, { id: uid(), cells }]);
        });
        break;
      }

      default:
        break;
    }

    return parsed.reply || "Done!";
  };

  // ── Build AI prompt that knows about the CURRENT state ────────────────────
  const buildFullPrompt = (userPrompt: string): string => {
    const rowSummary = rows.map(r => {
      const summary: Record<string, string> = { sr: r.cells.sr };
      cols.forEach(c => {
        summary[c.label] = r.cells[c.id] || "";
      });
      return summary;
    });

    const colSummary = cols.map(c => ({ id: c.id, label: c.label, kind: c.kind, isSize: c.isSize, isRate: c.isRate, isAmount: c.isAmount }));

    return `You are an AI assistant that fully controls a bill/invoice editor.

## CURRENT STATE
### Header
${JSON.stringify(header, null, 2)}

### Bill Details
${JSON.stringify(billDetails, null, 2)}

### Columns
${JSON.stringify(colSummary, null, 2)}

### Rows (${rows.length} items)
${JSON.stringify(rowSummary, null, 2)}

## YOUR CAPABILITIES
You can do ANYTHING the user asks. You have full control:
- Edit any row cell: Pass the column label (case-insensitive) as the key in the JSON response (e.g. if column is "Unit", pass "Unit": "value").
- Add/delete rows
- Change bill details (client, date, subject, advance)
- Change header (business name, phone, address, gstNumber, tagline, fontSizeName, fontSizeContact, fontSizeTagline)
- Add new columns
- Rename columns (e.g. "Size" → "SFT")
- Apply GST / discount
- Clear the table

## RESPONSE FORMAT
Return ONLY valid JSON (no markdown, no extra text):
{
  "action": "ACTION_NAME",
  "data": { ... },
  "reply": "Short confirmation message"
}

## ACTIONS

ADD_ROW:
{ "action": "ADD_ROW", "data": { "Particulars": "Window glass", "Size": "10x5", "Rate": 200, "Unit": "Nos" }, "reply": "Added row..." }

ADD_MULTIPLE_ROWS:
{ "action": "ADD_MULTIPLE_ROWS", "data": { "rows": [{"Particulars":"...", "Size":"...", "Rate":0, "Unit": "..."}] }, "reply": "..." }

UPDATE_ROW (sr is 1-based row number, can update ANY column label key):
{ "action": "UPDATE_ROW", "data": { "sr": 2, "Particulars": "new name", "Rate": 300, "Unit": "Box", "bold": true, "fontSize": 14, "align": "center" }, "reply": "..." }

DELETE_ROW (sr is 1-based):
{ "action": "DELETE_ROW", "data": { "sr": 3 }, "reply": "..." }

DELETE_LAST_ROW:
{ "action": "DELETE_LAST_ROW", "data": {}, "reply": "..." }

CLEAR_TABLE:
{ "action": "CLEAR_TABLE", "data": {}, "reply": "Table cleared." }

UPDATE_DETAIL (fields: clientName, clientAddress, date, subject, advance, note, showNote, showSignature, proprietorName):
{ "action": "UPDATE_DETAIL", "data": { "field": "clientName", "value": "ABC Corp" }, "reply": "..." }

UPDATE_HEADER (fields: businessName, phone, address, gstNumber, tagline, fontSizeName, fontSizeContact, fontSizeTagline):
{ "action": "UPDATE_HEADER", "data": { "field": "businessName", "value": "XYZ Works" }, "reply": "..." }

ADD_COLUMN (adds a new custom column before Amount):
{ "action": "ADD_COLUMN", "data": { "label": "Unit", "kind": "text" }, "reply": "..." }

RENAME_COLUMN (rename by current label):
{ "action": "RENAME_COLUMN", "data": { "oldLabel": "Size", "newLabel": "SFT" }, "reply": "Renamed Size to SFT." }

APPLY_GST:
{ "action": "APPLY_GST", "data": { "percent": 18 }, "reply": "Added 18% GST row." }

APPLY_DISCOUNT:
{ "action": "APPLY_DISCOUNT", "data": { "percent": 10 }, "reply": "Applied 10% discount." }

## FORMULA RULES
- Quantity = parseSize(Size) (if Size is provided, set Quantity to its calculation)
- Amount = Quantity * Rate
- parseSize("10x5") = 50, parseSize("3x4x2") = 24, parseSize("12") = 12
- Total = SUM of all amount values
- Balance = Total − advance

## User command: ${userPrompt}

JSON response:`;
  };

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!input.trim() && !selectedImage) || !aiServiceRef.current) return;

    // Image analysis
    if (selectedImage) {
      const userMsg: AIMessage = {
        id: Date.now().toString(), role: "user",
        content: input.trim() || "What do you see in this image?",
        timestamp: Date.now(), image: selectedImage
      };
      setMessages(prev => [...prev, userMsg]);
      setInput("");
      const img = selectedImage;
      const prompt = input.trim() || "Describe this image in detail.";
      setSelectedImage(null); setSelectedImageName("");
      setIsProcessing(true);
      try {
        const resp = await aiServiceRef.current.analyzeImage(img, prompt);
        setMessages(prev => [...prev, { id: (Date.now()+1).toString(), role: "assistant", content: resp, timestamp: Date.now() }]);
      } catch (err) {
        setMessages(prev => [...prev, { id: (Date.now()+2).toString(), role: "assistant", content: `Error: ${err instanceof Error ? err.message : "Failed"}`, timestamp: Date.now() }]);
      } finally { setIsProcessing(false); }
      return;
    }

    // Text command — controls the ACTUAL bill
    const userMsg: AIMessage = {
      id: Date.now().toString(), role: "user",
      content: input.trim(), timestamp: Date.now()
    };
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setIsProcessing(true);

    try {
      const fullPrompt = buildFullPrompt(userMsg.content);
      const raw = await aiServiceRef.current.rawOllamaCall(fullPrompt);
      const parsed = safeParseJSON(raw);
      const replyText = applyCommand(parsed);
      setMessages(prev => [...prev, { id: (Date.now()+1).toString(), role: "assistant", content: replyText, timestamp: Date.now() }]);
    } catch (err) {
      setMessages(prev => [...prev, { id: (Date.now()+2).toString(), role: "assistant", content: `Error: ${err instanceof Error ? err.message : "Something went wrong"}`, timestamp: Date.now() }]);
    } finally { setIsProcessing(false); }
  };

  const clearChat = () => { setMessages([]); aiServiceRef.current?.clearHistory(); };

  const exportChat = () => {
    const blob = new Blob([JSON.stringify(messages, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `chat-${Date.now()}.json`; a.click();
    URL.revokeObjectURL(url);
  };

  // Quick prompt chips
  const quickPrompts = [
    "add row for door work 10x8 rate 500",
    "rename Size column to SFT",
    "add 18% GST",
    "set advance to 50000",
    "delete last row",
    "add a Unit text column",
    "apply 5% discount",
  ];

  // ── Toggle button ─────────────────────────────────────────────────────────
  if (!isOpen) return (
    <button className="aiChatToggle" onClick={() => setIsOpen(true)} title="Open AI Assistant">
      <MessageCircle size={24} />
      {messages.length > 0 && <span className="badge">{messages.filter(m => m.role === "user").length}</span>}
    </button>
  );

  // ── Panel ─────────────────────────────────────────────────────────────────
  return (
    <div className="aiChatPanel">
      <div className="aiChatHeader">
        <div>
          <h3>AI Assistant</h3>
          <small>Full control — say anything</small>
        </div>
        <div className="aiChatActions">
          <button onClick={exportChat} title="Export chat" disabled={messages.length === 0}><Download size={18} /></button>
          <button onClick={clearChat} title="Clear chat" disabled={messages.length === 0}><Trash2 size={18} /></button>
          <button onClick={() => setShowSettings(!showSettings)} title="Settings"><Settings size={18} /></button>
          <button onClick={() => setIsOpen(false)} title="Close"><X size={18} /></button>
        </div>
      </div>

      {showSettings && (
        <div className="aiSettings">
          <label>AI Provider
            <select value={provider} onChange={e => setProvider(e.target.value as any)}>
              <option value="ollama">🆓 Ollama (FREE – Local)</option>
              <option value="openai">OpenAI (ChatGPT – Paid)</option>
              <option value="anthropic">Anthropic (Claude – Paid)</option>
            </select>
          </label>
          {provider !== "ollama" && (
            <label>API Key
              <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)}
                placeholder={`Enter your ${provider === "openai" ? "OpenAI" : "Anthropic"} API key`} />
            </label>
          )}
          {provider === "ollama" && (
            <div style={{ padding: 10, background: "#e8f5e9", borderRadius: 8, fontSize: 13, color: "#2e7d32" }}>
              ✅ Using <strong>FREE</strong> local AI (Ollama) — no API key needed!
            </div>
          )}
          <button className="primaryButton" onClick={saveSettings}>Save</button>
        </div>
      )}

      {/* Context strip */}
      <div className="aiContextPill">
        <Sparkles size={13} />
        <span>
          {rows.length} rows · Total ₹{rows.reduce((s, r) => s + (parseFloat(r.cells[cols.find(c => c.isAmount)?.id ?? ""] || "0") || 0), 0).toLocaleString("en-IN")}
        </span>
      </div>

      {/* Messages */}
      <div className="aiChatMessages">
        {messages.length === 0 && (
          <div className="aiWelcome">
            <Bot size={40} style={{ color: "#1a56db", opacity: 0.7 }} />
            <h4>AI has full control of your bill</h4>
            <p>Say anything — I can add/edit/delete rows, rename columns, change client details, apply GST, and more.</p>
            <ul>
              <li>"add row for door work 10x8 rate 500"</li>
              <li>"rename Size column to SFT"</li>
              <li>"set client name to Sharma Building"</li>
              <li>"add 18% GST"</li>
              <li>"change row 2 rate to 350"</li>
              <li>"add a Unit text column"</li>
            </ul>
          </div>
        )}

        {messages.map(msg => (
          <div key={msg.id} className={`aiMessage ${msg.role}`}>
            <div className="aiMsgIcon">
              {msg.role === "user" ? <User size={13} /> : <Bot size={13} />}
            </div>
            <div>
              {msg.image && <div className="aiMessageImage"><img src={msg.image} alt="Uploaded" /></div>}
              <div className="aiMessageContent">{msg.content}</div>
              <div className="aiMessageTime">{new Date(msg.timestamp).toLocaleTimeString()}</div>
            </div>
          </div>
        ))}

        {isProcessing && (
          <div className="aiMessage assistant">
            <div className="aiMsgIcon"><Bot size={13} /></div>
            <div className="aiMessageContent"><span className="typing">Thinking</span></div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Quick prompts */}
      <div className="quickPrompts">
        {quickPrompts.map(p => (
          <button key={p} className="quickPromptBtn" onClick={() => setInput(p)}>{p}</button>
        ))}
      </div>

      {/* Image preview */}
      {selectedImage && (
        <div className="imagePreview">
          <img src={selectedImage} alt="Selected" />
          <div className="imagePreviewInfo">
            <span>{selectedImageName}</span>
            <button onClick={() => { setSelectedImage(null); setSelectedImageName(""); }} title="Remove">
              <XCircle size={18} />
            </button>
          </div>
        </div>
      )}

      {/* Input */}
      <form className="aiChatInput" onSubmit={handleSubmit}>
        <input type="file" ref={fileInputRef} onChange={handleImageSelect} accept="image/*" style={{ display: "none" }} />
        {provider === "ollama" && (
          <button type="button" className="imageUploadBtn"
            onClick={() => fileInputRef.current?.click()} disabled={isProcessing} title="Upload image">
            <Image size={18} />
          </button>
        )}
        <input
          type="text" value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Type anything… e.g. 'rename Size to SFT' or 'add 18% GST'"
          disabled={isProcessing}
        />
        <button type="submit" disabled={(!input.trim() && !selectedImage) || isProcessing}>
          <Send size={18} />
        </button>
      </form>
    </div>
  );
}
