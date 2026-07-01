import { Settings } from "lucide-react";
import { useState } from "react";
import type { HeaderTemplate } from "../types";

type Props = {
  header: HeaderTemplate;
  onChange: (header: HeaderTemplate) => void;
};

export function HeaderEditor({ header, onChange }: Props) {
  const [editing, setEditing] = useState(false);

  const update = (key: keyof HeaderTemplate, value: string) => {
    onChange({ ...header, [key]: value });
  };

  return (
    <div className="headerCard">
      {/* Letterhead preview */}
      <div className="headerCardPreview">
        <p className="hcBizName">{header.businessName || "Business Name"}</p>
        {header.phone && <p className="hcContact">Mobile No. {header.phone}</p>}
        {header.address && <p className="hcContact">{header.address}</p>}
        {header.tagline && <p className="hcTagline">{header.tagline}</p>}
      </div>

      {/* Gear toggle */}
      <div className="headerCardEditToggle">
        <button onClick={() => setEditing(prev => !prev)}>
          <Settings size={13} />
          {editing ? "Done" : "Edit Header"}
        </button>
      </div>

      {/* Editing fields */}
      {editing && (
        <div className="headerEditFields">
          <label>
            Business name
            <input value={header.businessName} onChange={e => update("businessName", e.target.value)} />
          </label>
          <label>
            Address
            <input value={header.address} onChange={e => update("address", e.target.value)} />
          </label>
          <label>
            Mobile
            <input value={header.phone} onChange={e => update("phone", e.target.value)} />
          </label>
          <label>
            GST number
            <input value={header.gstNumber} onChange={e => update("gstNumber", e.target.value)} placeholder="Optional" />
          </label>
          <label>
            Tagline
            <textarea
              value={header.tagline ?? ""}
              onChange={e => update("tagline", e.target.value)}
              placeholder="e.g. Specialist In All Interiors Works…"
              style={{ minHeight: 52 }}
            />
          </label>
        </div>
      )}
    </div>
  );
}
