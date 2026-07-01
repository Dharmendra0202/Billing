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
      {header.phone && (
        <p className="pbContactLine">Mobile No. {header.phone}</p>
      )}
      {header.address && (
        <p className="pbContactLine">{header.address}</p>
      )}
      {header.gstNumber && (
        <p className="pbContactLine">GST: {header.gstNumber}</p>
      )}

      <div className="pbBottomLine" />

      {/* Tagline */}
      {header.tagline && (
        <p className="pbTagline">{header.tagline}</p>
      )}

      {/* Date */}
      <p className="pbDate">Date: {billDetails.date}</p>

      {/* Client */}
      <p className="pbTo">To,</p>
      <p className="pbClientName">{billDetails.clientName || "________________"}</p>
      <p className="pbClientAddr">{billDetails.clientAddress || "________________"}</p>

      {/* Subject */}
      {billDetails.subject && (
        <p className="pbSub">Sub: {billDetails.subject}</p>
      )}

      {/* Table */}
      <table className="pbTable">
        <thead>
          <tr>
            <th style={{ width: 32 }}>Sr. No</th>
            <th>Particulars</th>
            <th style={{ width: 80 }}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={3} style={{ textAlign: "center", color: "#aaa", fontStyle: "italic" }}>No items yet</td>
            </tr>
          )}
          {rows.map(row => (
            <tr key={row.id}>
              <td className="pbSrCell">{row.sr}</td>
              <td>{row.particulars || <span style={{ color: "#aaa" }}>—</span>}</td>
              <td className="pbAmtCell">{row.amount > 0 ? money(row.amount) : "—"}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="pbTfTotal">
            <td colSpan={2} className="pbRight" style={{ fontWeight: "bold" }}>Total</td>
            <td className="pbAmtCell">{money(total)}</td>
          </tr>
          <tr className="pbTfAdvance">
            <td colSpan={2} className="pbRight">Advance</td>
            <td className="pbAmtCell">{money(billDetails.advance)}</td>
          </tr>
          <tr className="pbTfBalance">
            <td colSpan={2} className="pbRight" style={{ fontWeight: "bold" }}>Balance</td>
            <td className="pbAmtCell" style={{ color: "#15803d" }}>{money(balance)}</td>
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
          <span className="pbSignatureLine" />
          <p>{billDetails.proprietorName}</p>
          <p>Authorised Signatory</p>
        </div>
      )}
    </div>
  );
}
