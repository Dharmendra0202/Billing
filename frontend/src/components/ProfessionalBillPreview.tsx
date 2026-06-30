import { useMemo } from "react";
import type { BillTable, HeaderTemplate, BillDetails } from "../types";

type Props = {
  header: HeaderTemplate;
  tables: BillTable[];
  billDetails: BillDetails;
};

export function ProfessionalBillPreview({ header, tables, billDetails }: Props) {
  // Calculate total from all tables
  const total = useMemo(() => {
    return tables.reduce((sum, table) => {
      const amountCol = table.columns.find(c => c.label.toLowerCase().includes('amount'));
      if (!amountCol) return sum;
      return sum + table.rows.reduce((rowSum, row) => {
        return rowSum + (parseFloat(row.cells[amountCol.id]) || 0);
      }, 0);
    }, 0);
  }, [tables]);

  const balance = total - billDetails.advance;
  const mainTable = tables[0];

  const formatMoney = (amount: number) => {
    return `₹ ${amount.toLocaleString('en-IN')}`;
  };

  return (
    <div className="professionalBillPreview" id="bill-preview">
      {/* Header */}
      <div className="pbHeader">
        <div className="pbHeaderLine"></div>
        <h1 className="pbBusinessName">{header.businessName}</h1>
        <p className="pbContact">Mobile No. {header.phone}</p>
        <p className="pbAddress">{header.address}</p>
        <div className="pbHeaderLine"></div>
        {header.tagline && <p className="pbTagline">{header.tagline}</p>}
      </div>

      {/* Date - Right aligned */}
      <div className="pbDate">
        <span>Date: {billDetails.date}</span>
      </div>

      {/* Client Details */}
      <div className="pbClient">
        <p>To,</p>
        <p className="pbClientName">{billDetails.clientName || "________________"}</p>
        <p>{billDetails.clientAddress || "________________"}</p>
      </div>

      {/* Subject */}
      <div className="pbSubject">
        <p>Sub: {billDetails.subject}</p>
      </div>

      {/* Items Table */}
      <table className="pbTable">
        <thead>
          <tr>
            <th style={{ width: "60px" }}>Sr. No</th>
            <th>Particulars</th>
            <th style={{ width: "100px" }}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {mainTable?.rows.map((row, index) => (
            <tr key={row.id}>
              <td className="pbCenter">{row.cells.sr || (index + 1)}</td>
              <td>{row.cells.particulars || ""}</td>
              <td className="pbRight">{formatMoney(parseFloat(row.cells.amount) || 0)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="pbTotalRow">
            <td colSpan={2} className="pbRight"><strong>Total</strong></td>
            <td className="pbRight"><strong>{formatMoney(total)}</strong></td>
          </tr>
          <tr>
            <td colSpan={2} className="pbRight"><strong>Advance</strong></td>
            <td className="pbRight"><strong>{formatMoney(billDetails.advance)}</strong></td>
          </tr>
          <tr>
            <td colSpan={2} className="pbRight"><strong>Balance</strong></td>
            <td className="pbRight"><strong>{formatMoney(balance)}</strong></td>
          </tr>
        </tfoot>
      </table>

      {/* Note */}
      {billDetails.showNote && billDetails.note && (
        <div className="pbNote">
          <p><strong>Note.</strong></p>
          <p>{billDetails.note}</p>
        </div>
      )}

      {/* Signature */}
      {billDetails.showSignature && (
        <div className="pbSignature">
          <p>Proprietor: {billDetails.proprietorName}</p>
          <div className="pbSignatureLine"></div>
          <p>Authorised Signatory</p>
        </div>
      )}
    </div>
  );
}
