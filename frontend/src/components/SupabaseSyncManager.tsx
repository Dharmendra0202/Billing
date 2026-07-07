import { useState, useEffect } from "react";
import {
  isSupabaseConfigured,
  getStoredConfig,
  updateSupabaseConfig,
  clearSupabaseConfig,
  fetchSavedBills,
  saveBillToCloud,
  deleteBillFromCloud
} from "../lib/supabaseClient";
import { CloudLightning, CheckCircle2, AlertTriangle, Cloud, Trash2 } from "lucide-react";

type Props = {
  header: any;
  rows: any;
  billDetails: any;
  billTitle: string;
  onLoadBill: (bill: any) => void;
};

export function SupabaseSyncManager({ header, rows, billDetails, billTitle, onLoadBill }: Props) {
  const [configured, setConfigured] = useState(isSupabaseConfigured());
  const [config, setConfig] = useState(getStoredConfig());
  const [urlInput, setUrlInput] = useState(config.url);
  const [keyInput, setKeyInput] = useState(config.key);
  const [savedBills, setSavedBills] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const loadList = async () => {
    if (!isSupabaseConfigured()) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const list = await fetchSavedBills();
      setSavedBills(list);
    } catch (err: any) {
      setErrorMsg(`Failed to fetch bills: ${err.message || err}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (configured) {
      loadList();
    }
  }, [configured]);

  const handleConnect = () => {
    if (!urlInput.trim() || !keyInput.trim()) {
      setErrorMsg("Please fill in both URL and API Key.");
      return;
    }
    updateSupabaseConfig(urlInput.trim(), keyInput.trim());
    setConfigured(true);
    setConfig(getStoredConfig());
    setErrorMsg(null);
    setSuccessMsg("Connected successfully!");
    setTimeout(() => setSuccessMsg(null), 3000);
  };

  const handleDisconnect = () => {
    if (config.isEnv) {
      setErrorMsg("Cannot disconnect database configured via env variables.");
      return;
    }
    clearSupabaseConfig();
    setConfigured(false);
    setUrlInput("");
    setKeyInput("");
    setSavedBills([]);
    setErrorMsg(null);
  };

  const handleSaveToCloud = async () => {
    setLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      await saveBillToCloud({
        bill_title: billTitle,
        client_name: billDetails.clientName || "",
        client_address: billDetails.clientAddress || "",
        date: billDetails.date || "",
        subject: billDetails.subject || "",
        advance: billDetails.advance || 0,
        header,
        rows
      });
      setSuccessMsg(`Bill saved to cloud!`);
      setTimeout(() => setSuccessMsg(null), 3000);
      loadList();
    } catch (err: any) {
      setErrorMsg(`Failed to save: ${err.message || err}. Make sure you created the 'saved_bills' table.`);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Are you sure you want to delete this bill from the cloud?")) return;
    setLoading(true);
    try {
      await deleteBillFromCloud(id);
      loadList();
    } catch (err: any) {
      setErrorMsg(`Failed to delete: ${err.message || err}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="supabaseManager" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {errorMsg && (
        <div style={{ display: "flex", gap: 8, background: "#fef2f2", color: "#b91c1c", padding: 12, borderRadius: 8, fontSize: 13 }}>
          <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          <div>{errorMsg}</div>
        </div>
      )}
      
      {successMsg && (
        <div style={{ display: "flex", gap: 8, background: "#ecfdf5", color: "#047857", padding: 12, borderRadius: 8, fontSize: 13 }}>
          <CheckCircle2 size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          <div>{successMsg}</div>
        </div>
      )}

      {!configured ? (
        <div className="supabaseSetup" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <p style={{ fontSize: 13, color: "#64748b", margin: 0, lineHeight: 1.4 }}>
            Connect your Supabase account to save bills to the cloud. You can find these details in your <strong>Supabase Dashboard → Settings → API</strong>.
          </p>
          
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <label style={{ fontSize: 12, fontWeight: 600, display: "flex", flexDirection: "column", gap: 4 }}>
              Supabase Project URL
              <input 
                type="text" 
                value={urlInput} 
                onChange={e => setUrlInput(e.target.value)} 
                placeholder="https://xxxxxx.supabase.co" 
                style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13 }}
              />
            </label>

            <label style={{ fontSize: 12, fontWeight: 600, display: "flex", flexDirection: "column", gap: 4 }}>
              Anon Public API Key
              <input 
                type="password" 
                value={keyInput} 
                onChange={e => setKeyInput(e.target.value)} 
                placeholder="eyJhbGciOi..." 
                style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13 }}
              />
            </label>

            <button 
              className="primaryButton" 
              onClick={handleConnect}
              style={{ width: "100%", marginTop: 8 }}
            >
              <CloudLightning size={16} /> Save & Connect
            </button>
          </div>
        </div>
      ) : (
        <div className="supabaseConnected" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#f8fafc", padding: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <CheckCircle2 size={16} style={{ color: "#16a34a" }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: "#334155" }}>
                {config.isEnv ? "Connected (Vercel Config)" : "Connected (Local Storage)"}
              </span>
            </div>
            {!config.isEnv && (
              <button 
                onClick={handleDisconnect} 
                style={{ fontSize: 11, background: "transparent", color: "#ef4444", border: "none", cursor: "pointer", fontWeight: 600 }}
              >
                Disconnect
              </button>
            )}
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button 
              className="primaryButton" 
              onClick={handleSaveToCloud} 
              disabled={loading}
              style={{ flex: 1 }}
            >
              <Cloud size={16} /> Save Current Bill
            </button>
            <button 
              className="secondaryButton" 
              onClick={loadList} 
              disabled={loading}
              style={{ padding: "0 12px" }}
            >
              Refresh
            </button>
          </div>

          <h4 style={{ margin: "8px 0 0 0", fontSize: 14, color: "#475569" }}>Saved Bills in Cloud ({savedBills.length})</h4>
          
          {loading && <div style={{ fontSize: 13, color: "#64748b", textAlign: "center", padding: 10 }}>Loading cloud bills...</div>}
          
          {!loading && savedBills.length === 0 && (
            <div style={{ fontSize: 13, color: "#94a3b8", textAlign: "center", padding: 20, border: "1px dashed #cbd5e1", borderRadius: 8 }}>
              No saved bills in cloud. Save one above!
            </div>
          )}

          {!loading && savedBills.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: "250px", overflowY: "auto" }}>
              {savedBills.map((bill: any) => (
                <div 
                  key={bill.id} 
                  onClick={() => onLoadBill(bill)}
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", border: "1px solid #e2e8f0", borderRadius: 6, cursor: "pointer", background: "#ffffff" }}
                  className="cloudBillItem"
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <strong style={{ fontSize: 13, color: "#1e293b" }}>{bill.bill_title || "Untitled Bill"}</strong>
                    <span style={{ fontSize: 11, color: "#64748b" }}>
                      {bill.client_name ? `To: ${bill.client_name}` : "No client"} · {bill.date || "No date"}
                    </span>
                  </div>
                  <button 
                    onClick={(e) => handleDelete(bill.id, e)} 
                    style={{ background: "transparent", border: "none", color: "#64748b", cursor: "pointer", padding: 4 }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
