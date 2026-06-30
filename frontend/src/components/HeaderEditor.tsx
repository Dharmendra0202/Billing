import { ImagePlus, ScanLine } from "lucide-react";
import type { HeaderTemplate } from "../types";

type Props = {
  header: HeaderTemplate;
  onChange: (header: HeaderTemplate) => void;
  onPickImage: () => void;
};

export function HeaderEditor({ header, onChange, onPickImage }: Props) {
  const update = (key: keyof HeaderTemplate, value: string) => {
    onChange({ ...header, [key]: value });
  };

  return (
    <section className="panel">
      <div className="panelHeader">
        <div>
          <p className="eyebrow">Reusable header</p>
          <h2>Company Details</h2>
        </div>
        <button className="iconButton" onClick={onPickImage} title="Upload header image">
          <ImagePlus size={18} />
        </button>
      </div>

      <label>
        Business name
        <input value={header.businessName} onChange={(event) => update("businessName", event.target.value)} />
      </label>
      <label>
        Address
        <textarea value={header.address} onChange={(event) => update("address", event.target.value)} />
      </label>
      <div className="twoCols">
        <label>
          Mobile
          <input value={header.phone} onChange={(event) => update("phone", event.target.value)} />
        </label>
        <label>
          GST number
          <input value={header.gstNumber} onChange={(event) => update("gstNumber", event.target.value)} />
        </label>
      </div>

      <div className="notice">
        <ScanLine size={17} />
        <span>OCR API is prepared for header extraction. Manual editing keeps version 1 reliable.</span>
      </div>
    </section>
  );
}
