import { Fragment, useMemo } from "react";
import type { BillDetails, BillSection, ColumnLabels, HeaderTemplate, BillFormat } from "../types";
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
  labourRate?: number;
  labourAmount?: number;
  materialRate?: number;
  materialAmount?: number;
  bold?: boolean;
  fontSize?: number;
  align?: "left" | "center" | "right";
  mode?: "template" | "manual";
};

type Props = {
  header: HeaderTemplate;
  sections: BillSection[];
  billDetails: BillDetails;
  columnLabels?: ColumnLabels;
  billFormat?: BillFormat;
};

// Convert each part of a size expression and return both original + converted display
export function convertSizeDisplay(size: string, applyInch: boolean = true): { original: string; converted: string; value: number } {
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
function SectionTable({ section, cols, billFormat }: { section: BillSection; cols: ColumnLabels; billFormat?: BillFormat }) {
  const rows = section.rows as Row[];
  const applyInch = (section.mode ?? "template") !== "manual";

  if (billFormat === "custom") {
    const customCols = section.columns && section.columns.length > 0
      ? section.columns
      : [
          { id: "sr", label: cols.sr, kind: "number" as const },
          { id: "particulars", label: cols.particulars, kind: "text" as const },
          { id: "amount", label: cols.amount, kind: "number" as const }
        ];
    const customRows: { id: string; cells: Record<string, string> }[] = section.customRows && section.customRows.length > 0
      ? section.customRows
      : section.rows.map(r => ({
          id: r.id,
          cells: { sr: String(r.sr), particulars: r.particulars, amount: String(r.amount) }
        }));

    const getColAlign = (col: { id: string; label: string; kind: string }) => {
      const label = col.label.toLowerCase();
      const id = col.id.toLowerCase();
      if (id === "sr" || label.includes("sr")) return "center";
      if (id === "particulars" || label.includes("particular")) return "left";
      if (id === "size" || label.includes("size")) return "center";
      if (id === "quantity" || label.includes("qty") || label.includes("quantity")) return "center";
      if (col.kind === "number") return "right";
      return "left";
    };

    const amtCol = customCols.find(c => c.id === "amount" || c.label.toLowerCase().includes("amount"));
    const amtColIdx = amtCol ? customCols.findIndex(c => c.id === amtCol.id) : customCols.length - 1;
    const subtotalCustom = amtCol ? customRows.reduce((s, r) => s + (parseFloat(r.cells[amtCol.id]) || 0), 0) : 0;

    return (
      <div className="pbSectionBlock">
        {section.title.trim() && (
          <p className="pbSectionLabel">{section.title}</p>
        )}
        <table className="pbTable">
          <thead>
            <tr>
              {customCols.map(col => (
                <th key={col.id} style={{ textAlign: getColAlign(col) }}>
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {customRows.length === 0 && (
              <tr>
                <td colSpan={customCols.length} style={{ textAlign: "center", color: "#aaa", fontStyle: "italic", padding: "12px" }}>
                  No items yet — add rows in the editor
                </td>
              </tr>
            )}
            {customRows.map(r => (
              <tr key={r.id} style={{ fontWeight: r.cells.bold === "true" ? "bold" : "normal" }}>
                {customCols.map(col => {
                  let val = r.cells[col.id] ?? "";
                  const isNum = col.kind === "number";
                  // A bare "0" in a number column means "not filled" — show blank.
                  if (isNum && val.trim() === "0") val = "";
                  const isSizeCol = col.label.toLowerCase().includes("size") || col.id === "size";
                  // Only format as a number when the WHOLE value is a clean number
                  // (e.g. "15000"). If it contains any letters/symbols like
                  // "15000/NOS", show it exactly as typed.
                  const isPureNumber = val.trim() !== "" && /^-?\d+(\.\d+)?$/.test(val.trim());
                  const numVal = parseFloat(val);
                  const displayVal = isNum && isPureNumber
                    ? (col.label.toLowerCase().includes("amount") ? money(numVal) : formatNumber(numVal))
                    : val;
                  const align = getColAlign(col);
                  return (
                    <td key={col.id} style={{ textAlign: align }}>
                      {isSizeCol && val ? (() => {
                        const { original, converted } = convertSizeDisplay(val, applyInch);
                        return (
                          <>
                            <span className="pbSizeRaw">{original}</span>
                            {converted && (
                              <span className="pbSizeConverted" style={{ display: "block" }}>→ {converted}</span>
                            )}
                          </>
                        );
                      })() : (displayVal !== "" ? displayVal : "")}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          {section.showTableTotal !== false && (
          <tfoot>
            <tr className="pbTotalRow">
              <td colSpan={Math.max(1, amtColIdx - 1)} className="pbTotalSpacer"></td>
              <td className="pbTotalLabel" style={{ textAlign: "center", fontWeight: "bold" }}>Total</td>
              <td className="pbTotalValue" style={{ textAlign: "right", fontWeight: "bold" }}>{money(subtotalCustom).replace("₹ ", "")}</td>
            </tr>
          </tfoot>
          )}
        </table>
      </div>
    );
  }

  if (billFormat === "labourMaterial") {
    const labourTotal = rows.reduce((s, r) => s + (r.labourAmount || 0), 0);
    const materialTotal = rows.reduce((s, r) => s + (r.materialAmount || 0), 0);

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
              <th className="pbThQty">Quantity</th>
              <th className="pbThLabourHeader">Only Labour<br />Charges</th>
              <th className="pbThAmt">Amount</th>
              <th className="pbThMaterialHeader">Materials with<br />Labour Charges</th>
              <th className="pbThAmt">Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} style={{ textAlign: "center", color: "#aaa", fontStyle: "italic", padding: "12px" }}>
                  No items yet — add rows in the center panel
                </td>
              </tr>
            )}
            {rows.map(row => {
              const isLS = (row.size || "").trim().toUpperCase() === "LS";
              const lRate = row.labourRate || 0;
              const lAmt = row.labourAmount || 0;
              const mRate = row.materialRate || 0;
              const mAmt = row.materialAmount || 0;
              return (
                <tr key={row.id}>
                  <td className="pbSrCell">{row.sr}</td>
                  <td
                    className="pbParticularsCell"
                    style={{
                      fontSize: row.fontSize ? `${row.fontSize}px` : undefined,
                      textAlign: row.align || "left"
                    }}
                  >
                    {row.particulars
                      ? <span dangerouslySetInnerHTML={{ __html: row.particulars }} />
                      : <span style={{ color: "#bbb" }}>—</span>}
                  </td>
                  {isLS ? (
                    <td colSpan={2} className="pbLsCell">LS</td>
                  ) : (
                    <>
                      <td className="pbSizeCell">
                        {row.size ? (() => {
                          const rowApplyInch = (row as any).mode ? (row as any).mode !== "manual" : applyInch;
                          const { original, converted } = convertSizeDisplay(row.size, rowApplyInch);
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
                    </>
                  )}
                  <td className="pbRateCell" style={{ textAlign: "center" }}>{lRate > 0 ? formatNumber(lRate) : "—"}</td>
                  <td className="pbAmtCell" style={{ textAlign: "center" }}>{lAmt > 0 ? money(lAmt) : "—"}</td>
                  <td className="pbRateCell" style={{ textAlign: "center" }}>{mRate > 0 ? formatNumber(mRate) : "—"}</td>
                  <td className="pbAmtCell" style={{ textAlign: "center" }}>{mAmt > 0 ? money(mAmt) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="pbTotalRow">
              <td colSpan={4} className="pbTotalSpacer" style={{ textAlign: "right", fontWeight: "bold" }}>Total</td>
              <td colSpan={2} style={{ textAlign: "center", fontWeight: "bold" }}>Labour: {money(labourTotal).replace("₹ ", "")}</td>
              <td colSpan={2} style={{ textAlign: "center", fontWeight: "bold" }}>Material: {money(materialTotal).replace("₹ ", "")}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    );
  }

  const subtotal = rows.reduce((s, r) => s + r.amount, 0);

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
                  fontSize: row.fontSize ? `${row.fontSize}px` : undefined,
                  textAlign: row.align || "left"
                }}
              >
                {row.particulars
                  ? <span dangerouslySetInnerHTML={{ __html: row.particulars }} />
                  : <span style={{ color: "#bbb" }}>—</span>}
              </td>
              {isLS ? (
                <td colSpan={3} className="pbLsCell">LS</td>
              ) : (
                <>
                  <td className="pbSizeCell">
                    {row.size ? (() => {
                      const rowApplyInch = row.mode ? row.mode !== "manual" : applyInch;
                      const { original, converted } = convertSizeDisplay(row.size, rowApplyInch);
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

export function BillPreview({ header, sections, billDetails, columnLabels, billFormat }: Props) {
  const cols = columnLabels ?? defaultColumnLabels;
  const total = useMemo(() => {
    if (billFormat === "labourMaterial") {
      return sections.reduce((s, section) => s + section.rows.reduce((rs, r) => rs + (r.materialAmount || 0), 0), 0);
    }
    if (billFormat === "custom") {
      return sections.reduce((s, section) => {
        const customCols = section.columns && section.columns.length > 0 ? section.columns : [];
        const customRows = section.customRows && section.customRows.length > 0 ? section.customRows : [];
        const amtCol = customCols.find(c => c.label.toLowerCase().includes("amount") || c.kind === "number");
        if (!amtCol) return s;
        return s + customRows.reduce((rs, r) => rs + (parseFloat(r.cells[amtCol.id]) || 0), 0);
      }, 0);
    }
    return sections.reduce((s, section) => s + section.rows.reduce((rs, r) => rs + r.amount, 0), 0);
  }, [sections, billFormat]);

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
          <p className="pbClientName" dangerouslySetInnerHTML={{ __html: billDetails.clientName || "________________" }} />
          {billDetails.showClientAddress !== false && (
            <p className="pbClientAddr" dangerouslySetInnerHTML={{ __html: billDetails.clientAddress || "________________" }} />
          )}
        </>
      )}

      {/* Subject */}
      {billDetails.subject && <p className="pbSub">Sub: <span dangerouslySetInnerHTML={{ __html: billDetails.subject }} /></p>}

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
            <SectionTable section={section} cols={cols} billFormat={billFormat} />
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
          <p dangerouslySetInnerHTML={{ __html: billDetails.note }} />
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
