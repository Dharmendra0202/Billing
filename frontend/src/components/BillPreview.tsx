import type { BillDetails, HeaderTemplate } from "../types";
import { money } from "../lib/billMath";

type Row = {
  id: string;
  sr: number;
  particulars: string;
  size: string;
  rate: number;
  amount: number;
};

type Props = {
  header: HeaderTemplate;
  rows: Row[];
  billDetails: BillDetails;
};

function parseSizeDisplay(size: string): string {
  if (!size.trim()) return "";
  const parts = size.split(/[x*×]/i).map(p => parseFloat(p.trim())).filter(n => !isNaN(n));
  if (parts.length >= 2) {
    const result = parts.reduce((a, b) => a * b, 1);
    return `${size} = ${result}`;
  }
  return size;
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
      <p className="pbTo">To,</p>
      <p className="pbClientName">{billDetails.clientName || "________________"}</p>
      <p className="pbClientAddr">{billDetails.clientAddress || "________________"}</p>

      {/* Subject */}
      {billDetails.subject && <p className="pbSub">Sub: {billDetails.subject}</p>}

      {/* Items Table — full 5 columns */}
      <table className="pbTable">
        <thead>
          <tr>
            <th className="pbThSr">Sr. No</th>
            <th className="pbThParticulars">Particulars</th>
            <th className="pbThSize">Size</th>
            <th className="pbThRate">Rate (₹)</th>
            <th className="pbThAmt">Amount (₹)</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={5} style={{ textAlign: "center", color: "#aaa", fontStyle: "italic", padding: "12px" }}>
                No items yet — add rows in the center panel
              </td>
            </tr>
          )}
          {rows.map(row => (
            <tr key={row.id}>
              <td className="pbSrCell">{row.sr}</td>
              <td className="pbParticularsCell">
                {row.particulars || <span style={{ color: "#bbb" }}>—</span>}
              </td>
              <td className="pbSizeCell">
                {row.size ? (
                  <>
                    <span className="pbSizeRaw">{row.size}</span>
                    {row.size.match(/[x*×]/i) && (
                      <span className="pbSizeCalc">
                        {" = "}{row.size.split(/[x*×]/i).map(p => parseFloat(p.trim())).filter(n => !isNaN(n)).reduce((a, b) => a * b, 1)}
                      </span>
                    )}
                  </>
                ) : <span style={{ color: "#bbb" }}>—</span>}
              </td>
              <td className="pbRateCell">{row.rate > 0 ? money(row.rate) : "—"}</td>
              <td className="pbAmtCell">{row.amount > 0 ? money(row.amount) : "—"}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="pbTfTotal">
            <td colSpan={4} className="pbRight"><strong>Total</strong></td>
            <td className="pbAmtCell"><strong>{money(total)}</strong></td>
          </tr>
          <tr className="pbTfAdvance">
            <td colSpan={4} className="pbRight">Advance</td>
            <td className="pbAmtCell">{money(billDetails.advance)}</td>
          </tr>
          <tr className="pbTfBalance">
            <td colSpan={4} className="pbRight"><strong>Balance</strong></td>
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
