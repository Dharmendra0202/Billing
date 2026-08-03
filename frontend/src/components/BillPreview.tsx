import { Fragment } from "react";
import type { BillDetails, BillSection, ColumnLabels, HeaderTemplate } from "../types";
import { defaultColumnLabels } from "../types";
import { money, formatNumber } from "../lib/billMath";
import { convertAllPointValues, INCH_CONVERSION_MAP } from "../lib/inchConversion";

// Format a date string (YYYY-MM-DD or any parseable) as DD/MM/YYYY for display.
function formatDate(dateStr: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr; // fallback: show as-is
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

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
  sections: BillSection[];
  billDetails: BillDetails;
  columnLabels?: ColumnLabels;
};

// Convert each part of a size expression and return both original + converted display
function convertSizeDisplay(size: string, applyInch: boolean = true): { original: string; converted: string; value: number } {
  const clean = size.trim();
  if (!clean) return { original: "", converted: "", value: 1 };

  const rawParts = clean.split(/[x*×]/i).map(p => p.trim()).filter(Boolean);

  if (rawParts.length >= 2) {
    const convertedParts = rawParts.map(p => (applyInch ? convertAllPointValues(p) : p));
    const values = convertedParts.map(p => parseFloat(p) || 0);
    const result = Math.round(values.reduce((a, b) => a * b, 1) * 10000) / 10000;
    const convertedStr = convertedParts.join(" × ");
    const originalStr = rawParts.join(" × ");
    // Only show converted if it actually changed
    const changed = applyInch && convertedStr !== originalStr;
    return { original: originalStr, converted: changed ? convertedStr : "", value: result };
  }

  const converted = applyInch ? convertAllPointValues(clean) : clean;
  const changed = applyInch && converted !== clean;
  return { original: clean, converted: changed ? converted : "", value: parseFloat(converted) || 1 };
}

// Check if a size string contains any convertible point values
function hasConvertiblePoints(size: string): boolean {
  return Object.keys(INCH_CONVERSION_MAP).some(point => {
    const escaped = point.replace('.', '\\.');
    return new RegExp(`\\d${escaped}(?!\\d)`).test(size);
  });
}

// Renders a single section table (with an optional top-left label).
function SectionTable({ section, cols }: { section: BillSection; cols: ColumnLabels }) {
  const rows = section.rows as Row[];
  const subtotal = rows.reduce((s, r) => s + r.amount, 0);
  const applyInch = (section.mode ?? "template") !== "manual";

  return (
    <div className="pbSectionBlock">
      {section.title.trim() && (
        <p className="pbSectionLabel">{section.title}</p>
      )}
      <table className="pbTable">
        <thead>
          <tr>
            <th className="pbThSr">{cols.sr}</th>
            <th className="pbThParticulars">{cols.particulars}</th>
            <th className="pbThSize">{cols.size}</th>
            <th className="pbThQty">{cols.quantity}</th>
            <th className="pbThRate">{cols.rate}</th>
            <th className="pbThAmt">{cols.amount}</th>
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
          {rows.map(row => {
            const isLS = (row.size || "").trim().toUpperCase() === "LS";
            return (
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
              {isLS ? (
                <td colSpan={3} className="pbLsCell">LS</td>
              ) : (
                <>
                  <td className="pbSizeCell">
                    {row.size ? (() => {
                      const { original, converted } = convertSizeDisplay(row.size, applyInch);
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
                </>
              )}
              <td className="pbAmtCell">{row.amount > 0 ? money(row.amount) : "—"}</td>
            </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="pbTotalRow">
            <td colSpan={4} className="pbTotalSpacer"></td>
            <td className="pbTotalLabel">Total</td>
            <td className="pbTotalValue">{money(subtotal).replace("₹ ", "")}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export function BillPreview({ header, sections, billDetails, columnLabels }: Props) {
  const cols = columnLabels ?? defaultColumnLabels;
  const total = sections.reduce((s, section) => s + section.rows.reduce((rs, r) => rs + r.amount, 0), 0);
  const balance = total - billDetails.advance;
  const multipleTables = sections.length > 1;
  const showAdvance = billDetails.showAdvance !== false;
  const showBalance = billDetails.showBalance !== false;
  const showGrandTotal = billDetails.showGrandTotal !== false;

  return (
    <div style={{ paddingTop: billDetails.showHeader === false ? "12px" : "0" }}>
      {/* Single Line above Name */}
      {billDetails.showHeader !== false && (
        <>
          <div className="pbSingleLine" />

          {/* Business Name */}
          <div className="pbBizName" style={{ fontSize: `${header.fontSizeName ?? 24}px` }}>
            {header.businessName || "BUSINESS NAME"}
          </div>

          {/* Contact */}
          {header.phone && (
            <p className="pbContactLine" style={{ fontSize: `${header.fontSizeContact ?? 11}px` }}>
              Mobile No. {header.phone}
            </p>
          )}
          {header.address && (
            <p className="pbContactLine" style={{ fontSize: `${header.fontSizeContact ?? 11}px` }}>
              {header.address}
            </p>
          )}
          {billDetails.showGST !== false && header.gstNumber && (
            <p className="pbContactLine" style={{ fontSize: `${header.fontSizeContact ?? 11}px` }}>
              GST: {header.gstNumber}
            </p>
          )}

          {/* First Double Line */}
          <div className="pbDoubleLineContainer">
            <div className="pbDoubleLineTop" />
            <div className="pbDoubleLineBottom" />
          </div>

          {/* Tagline */}
          {header.tagline ? (
            <p className="pbTagline" style={{ fontSize: `${header.fontSizeTagline ?? 11}px` }}>
              {header.tagline}
            </p>
          ) : null}
        </>
      )}

      {/* Date */}
      {billDetails.showDate !== false && (
        <p className="pbDate">Date: {formatDate(billDetails.date)}</p>
      )}

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

      {/* Section tables — each with its own top-left label + in-table Total row */}
      {sections.map((section, i) => {
        const thisPage = section.page ?? 1;
        const prevPage = i > 0 ? (sections[i - 1].page ?? 1) : thisPage;
        const showBreak = i > 0 && thisPage > prevPage;
        return (
          <Fragment key={section.id}>
            {showBreak && (
              <div className="pbPageBreakMark"><span>Page {thisPage}</span></div>
            )}
            <SectionTable section={section} cols={cols} />
          </Fragment>
        );
      })}

      {/* Grand totals */}
      <div className="pbSummaryContainer">
        <table className="pbSummaryTable">
          <tbody>
            {showGrandTotal && (
              <tr>
                <td className="pbSummaryLabel"><strong>{multipleTables ? "Grand Total:" : "Total:"}</strong></td>
                <td className="pbSummaryVal"><strong>{money(total)}</strong></td>
              </tr>
            )}
            {showAdvance && (
              <tr>
                <td className="pbSummaryLabel">Advance:</td>
                <td className="pbSummaryVal">{money(billDetails.advance)}</td>
              </tr>
            )}
            {showBalance && (
              <tr className="pbSummaryBalanceRow">
                <td className="pbSummaryLabel"><strong>Balance:</strong></td>
                <td className="pbSummaryVal" style={{ color: "#15803d" }}><strong>{money(balance)}</strong></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

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
