import type { BillDetails, HeaderTemplate } from "../types";
import { money, formatNumber } from "../lib/billMath";
import { convertAllPointValues, INCH_CONVERSION_MAP } from "../lib/inchConversion";

type Row = {
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

type Props = {
  header: HeaderTemplate;
  rows: Row[];
  billDetails: BillDetails;
};

// Convert each part of a size expression and return both original + converted display
function convertSizeDisplay(size: string): { original: string; converted: string; value: number } {
  const clean = size.trim();
  if (!clean) return { original: "", converted: "", value: 1 };

  const rawParts = clean.split(/[x*×]/i).map(p => p.trim()).filter(Boolean);

  if (rawParts.length >= 2) {
    const convertedParts = rawParts.map(p => convertAllPointValues(p));
    const values = convertedParts.map(p => parseFloat(p) || 0);
    const result = Math.round(values.reduce((a, b) => a * b, 1) * 10000) / 10000;
    const convertedStr = convertedParts.join(" × ");
    const originalStr = rawParts.join(" × ");
    // Only show converted if it actually changed
    const changed = convertedStr !== originalStr;
    return { original: originalStr, converted: changed ? convertedStr : "", value: result };
  }

  const converted = convertAllPointValues(clean);
  const changed = converted !== clean;
  return { original: clean, converted: changed ? converted : "", value: parseFloat(converted) || 1 };
}

// Check if a size string contains any convertible point values
function hasConvertiblePoints(size: string): boolean {
  return Object.keys(INCH_CONVERSION_MAP).some(point => {
    const escaped = point.replace('.', '\\.');
    return new RegExp(`\\d${escaped}(?!\\d)`).test(size);
  });
}

export function BillPreview({ header, rows, billDetails }: Props) {
  const total = rows.reduce((s, r) => s + r.amount, 0);
  const balance = total - billDetails.advance;

  return (
    <div>
      {/* Top border */}
      <div className="pbTopLine" />

      {/* Business Name */}
      <div className="pbBizName">{header.businessName || "BUSINESS NAME"}</div>

      {/* Contact */}
      {header.phone && <p className="pbContactLine">Mobile No. {header.phone}</p>}
      {header.address && <p className="pbContactLine">{header.address}</p>}
      {header.gstNumber && <p className="pbContactLine">GST: {header.gstNumber}</p>}

      <div className="pbBottomLine" />

      {/* Tagline */}
      {header.tagline && <p className="pbTagline">{header.tagline}</p>}

      {/* Date */}
      <p className="pbDate">Date: {billDetails.date}</p>

      {/* Client */}
      {billDetails.showClientDetails !== false && (
        <>
          <p className="pbTo">To,</p>
          <p className="pbClientName">{billDetails.clientName || "________________"}</p>
          {billDetails.showClientAddress !== false && (
            <p className="pbClientAddr">{billDetails.clientAddress || "________________"}</p>
          )}
        </>
      )}

      {/* Subject */}
      {billDetails.subject && <p className="pbSub">Sub: {billDetails.subject}</p>}

      {/* Items Table — full 6 columns */}
      <table className="pbTable">
        <thead>
          <tr>
            <th className="pbThSr">Sr. No</th>
            <th className="pbThParticulars">Particulars</th>
            <th className="pbThSize">Size</th>
            <th className="pbThQty">Quantity</th>
            <th className="pbThRate">Rate</th>
            <th className="pbThAmt">Amount (₹)</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={6} style={{ textAlign: "center", color: "#aaa", fontStyle: "italic", padding: "12px" }}>
                No items yet — add rows in the center panel
              </td>
            </tr>
          )}
          {rows.map(row => (
            <tr key={row.id}>
              <td className="pbSrCell">{row.sr}</td>
              <td
                className="pbParticularsCell"
                style={{
                  fontWeight: row.bold ? "bold" : "normal",
                  fontSize: row.fontSize ? `${row.fontSize}px` : undefined,
                  textAlign: row.align || "left"
                }}
              >
                {row.particulars || <span style={{ color: "#bbb" }}>—</span>}
              </td>
              <td className="pbSizeCell">
                {row.size ? (() => {
                  const { original, converted } = convertSizeDisplay(row.size);
                  return (
                    <>
                      <span className="pbSizeRaw">{original}</span>
                      {converted && (
                        <span className="pbSizeConverted">→ {converted}</span>
                      )}
                    </>
                  );
                })() : <span style={{ color: "#bbb" }}>—</span>}
              </td>
              <td className="pbQtyCell">{row.quantity || "—"}</td>
              <td className="pbRateCell">{row.rate > 0 ? formatNumber(row.rate) : "—"}</td>
              <td className="pbAmtCell">{row.amount > 0 ? money(row.amount) : "—"}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="pbTfTotal">
            <td colSpan={5} className="pbRight"><strong>Total</strong></td>
            <td className="pbAmtCell"><strong>{money(total)}</strong></td>
          </tr>
          <tr className="pbTfAdvance">
            <td colSpan={5} className="pbRight">Advance</td>
            <td className="pbAmtCell">{money(billDetails.advance)}</td>
          </tr>
          <tr className="pbTfBalance">
            <td colSpan={5} className="pbRight"><strong>Balance</strong></td>
            <td className="pbAmtCell" style={{ color: "#15803d", fontWeight: 700 }}>{money(balance)}</td>
          </tr>
        </tfoot>
      </table>

      {/* Note */}
      {billDetails.showNote && billDetails.note && (
        <div className="pbNote">
          <p className="pbNoteLabel">Note.</p>
          <p>{billDetails.note}</p>
        </div>
      )}

      {/* Signature */}
      {billDetails.showSignature && (
        <div className="pbSignatureArea">
          <div className="pbSignatureLine" />
          <p>{billDetails.proprietorName}</p>
          <p>Authorised Signatory</p>
        </div>
      )}
    </div>
  );
}
