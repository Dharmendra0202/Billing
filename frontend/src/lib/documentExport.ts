import { jsPDF } from "jspdf";
import {
  Document,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  AlignmentType,
  BorderStyle,
  HeadingLevel,
  PageBreak
} from "docx";
import { saveAs } from "file-saver";
import * as XLSX from "xlsx";
import ExcelJS from "exceljs";
import type { BillTable, HeaderTemplate, BillDetails, ColumnLabels } from "../types";
import { defaultColumnLabels } from "../types";
import { TINOS_REGULAR_BASE64, TINOS_BOLD_BASE64 } from "./tinosFont";
import { convertAllPointValues } from "./inchConversion";

// Format a date string (YYYY-MM-DD or any parseable) as DD/MM/YYYY for display.
function formatDateForExport(dateStr: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

// Register the embedded Tinos TTF (a Times-metric-compatible serif that includes
// the Indian Rupee glyph U+20B9) under the "times" family name. jsPDF's built-in
// Times font is WinAnsi-encoded and cannot render ₹ (it falls back to "Rs."), so
// we override "times" with this Unicode TTF. Existing setFont("times", …) calls
// then render ₹ correctly with no further changes.
function registerRupeeFont(doc: jsPDF): void {
  try {
    doc.addFileToVFS("Tinos-Regular.ttf", TINOS_REGULAR_BASE64);
    doc.addFont("Tinos-Regular.ttf", "times", "normal");
    doc.addFileToVFS("Tinos-Bold.ttf", TINOS_BOLD_BASE64);
    doc.addFont("Tinos-Bold.ttf", "times", "bold");
  } catch (e) {
    // If embedding fails for any reason, jsPDF keeps its built-in Times font.
    console.error("Failed to embed Rupee-capable font:", e);
  }
}

// ============================================
// PDF Export
// ============================================
export async function exportToPDF(
  header: HeaderTemplate,
  tables: BillTable[],
  filename: string = "bill"
): Promise<void> {
  const doc = new jsPDF();
  let yPos = 20;
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 20;
  const contentWidth = pageWidth - 2 * margin;

  // Header
  doc.setFontSize(18);
  doc.setFont("times", "bold");
  doc.text(header.businessName || "Business Name", pageWidth / 2, yPos, { align: "center" });
  yPos += 8;

  doc.setFontSize(10);
  doc.setFont("times", "normal");
  if (header.address) {
    doc.text(header.address, pageWidth / 2, yPos, { align: "center" });
    yPos += 5;
  }
  if (header.phone) {
    doc.text(`Phone: ${header.phone}`, pageWidth / 2, yPos, { align: "center" });
    yPos += 5;
  }
  if (header.gstNumber) {
    doc.text(`GST: ${header.gstNumber}`, pageWidth / 2, yPos, { align: "center" });
    yPos += 5;
  }

  yPos += 10;

  // Draw line
  doc.setDrawColor(200);
  doc.line(margin, yPos, pageWidth - margin, yPos);
  yPos += 10;

  // Tables
  for (const table of tables) {
    // Check if we need a new page
    if (yPos > 250) {
      doc.addPage();
      yPos = 20;
    }

    // Table title
    doc.setFontSize(12);
    doc.setFont("times", "bold");
    doc.text(table.title, margin, yPos);
    yPos += 8;

    // Table headers
    const colWidth = contentWidth / table.columns.length;
    doc.setFontSize(10);
    doc.setFillColor(240, 240, 240);
    doc.rect(margin, yPos - 4, contentWidth, 8, "F");
    
    table.columns.forEach((col, i) => {
      doc.setFont("times", "bold");
      doc.text(col.label, margin + i * colWidth + 2, yPos);
    });
    yPos += 8;

    // Table rows
    doc.setFont("times", "normal");
    for (const row of table.rows) {
      if (yPos > 270) {
        doc.addPage();
        yPos = 20;
      }

      table.columns.forEach((col, i) => {
        const cellValue = row.cells[col.id] || "";
        doc.text(String(cellValue).substring(0, 30), margin + i * colWidth + 2, yPos);
      });
      yPos += 6;
    }

    // Calculate table total
    const totalCol = table.columns.find(c => c.kind === "number");
    if (totalCol) {
      const total = table.rows.reduce((sum, row) => {
        return sum + (parseFloat(row.cells[totalCol.id]) || 0);
      }, 0);
      
      doc.setFont("times", "bold");
      doc.text(`Total: ₹${total.toFixed(2)}`, pageWidth - margin - 40, yPos);
      yPos += 10;
    }

    yPos += 5;
  }

  // Grand Total
  const grandTotal = tables.reduce((sum, table) => {
    const numCol = table.columns.find(c => c.kind === "number");
    if (!numCol) return sum;
    return sum + table.rows.reduce((s, r) => s + (parseFloat(r.cells[numCol.id]) || 0), 0);
  }, 0);

  yPos += 5;
  doc.setDrawColor(0);
  doc.line(margin, yPos, pageWidth - margin, yPos);
  yPos += 8;
  doc.setFontSize(14);
  doc.setFont("times", "bold");
  doc.text(`Grand Total: ₹${grandTotal.toFixed(2)}`, pageWidth - margin - 50, yPos);

  doc.save(`${filename}.pdf`);
}

// ============================================
// Excel Export
// ============================================
export async function exportToExcel(
  header: HeaderTemplate,
  tables: BillTable[],
  filename: string = "bill"
): Promise<void> {
  const wb = XLSX.utils.book_new();

  // Create main bill sheet
  const wsData: (string | number)[][] = [];

  // Header info
  wsData.push([header.businessName || "Business Name"]);
  wsData.push([header.address || ""]);
  wsData.push([`Phone: ${header.phone || ""}`]);
  wsData.push([`GST: ${header.gstNumber || ""}`]);
  wsData.push([]); // Empty row

  let grandTotal = 0;

  // Each table
  for (const table of tables) {
    wsData.push([table.title]);
    
    // Column headers
    wsData.push(table.columns.map(c => c.label));
    
    // Rows
    let tableTotal = 0;
    for (const row of table.rows) {
      const rowData = table.columns.map(col => {
        const val = row.cells[col.id] || "";
        if (col.kind === "number") {
          const num = parseFloat(val) || 0;
          tableTotal += num;
          return num;
        }
        return val;
      });
      wsData.push(rowData);
    }
    
    // Table total row
    const totalRow = table.columns.map((col, i) => {
      if (i === 0) return "Total";
      if (col.kind === "number") return tableTotal;
      return "";
    });
    wsData.push(totalRow);
    wsData.push([]); // Empty row
    
    grandTotal += tableTotal;
  }

  // Grand total
  wsData.push(["Grand Total", grandTotal]);

  const ws = XLSX.utils.aoa_to_sheet(wsData);
  
  // Set column widths
  ws["!cols"] = [
    { wch: 30 },
    { wch: 15 },
    { wch: 15 },
    { wch: 15 },
    { wch: 15 }
  ];

  XLSX.utils.book_append_sheet(wb, ws, "Bill");
  XLSX.writeFile(wb, `${filename}.xlsx`);
}

// ============================================
// Word Export
// ============================================
export async function exportToWord(
  header: HeaderTemplate,
  tables: BillTable[],
  filename: string = "bill"
): Promise<void> {
  const children: (Paragraph | Table)[] = [];

  // Header
  children.push(
    new Paragraph({
      children: [new TextRun({ text: header.businessName || "Business Name", bold: true, size: 36 })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 100 }
    })
  );

  if (header.address) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: header.address, size: 22 })],
        alignment: AlignmentType.CENTER
      })
    );
  }

  if (header.phone) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: `Phone: ${header.phone}`, size: 22 })],
        alignment: AlignmentType.CENTER
      })
    );
  }

  if (header.gstNumber) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: `GST: ${header.gstNumber}`, size: 22 })],
        alignment: AlignmentType.CENTER
      })
    );
  }

  children.push(new Paragraph({ text: "", spacing: { after: 300 } }));

  let grandTotal = 0;

  // Tables
  for (const billTable of tables) {
    // Table title
    children.push(
      new Paragraph({
        children: [new TextRun({ text: billTable.title, bold: true, size: 26 })],
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 200, after: 100 }
      })
    );

    // Create table
    const tableRows: TableRow[] = [];

    // Header row
    tableRows.push(
      new TableRow({
        children: billTable.columns.map(
          col =>
            new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: col.label, bold: true })] })],
              shading: { fill: "E0E0E0" }
            })
        )
      })
    );

    // Data rows
    let tableTotal = 0;
    for (const row of billTable.rows) {
      tableRows.push(
        new TableRow({
          children: billTable.columns.map(col => {
            const val = row.cells[col.id] || "";
            if (col.kind === "number") {
              tableTotal += parseFloat(val) || 0;
            }
            return new TableCell({
              children: [new Paragraph({ text: String(val) })]
            });
          })
        })
      );
    }

    // Total row
    tableRows.push(
      new TableRow({
        children: billTable.columns.map((col, i) =>
          new TableCell({
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: i === 0 ? "Total" : col.kind === "number" ? `₹${tableTotal.toFixed(2)}` : "",
                    bold: true
                  })
                ]
              })
            ],
            shading: { fill: "F5F5F5" }
          })
        )
      })
    );

    grandTotal += tableTotal;

    children.push(
      new Table({
        rows: tableRows,
        width: { size: 100, type: WidthType.PERCENTAGE }
      })
    );

    children.push(new Paragraph({ text: "", spacing: { after: 200 } }));
  }

  // Grand Total
  children.push(
    new Paragraph({
      children: [new TextRun({ text: `Grand Total: ₹${grandTotal.toFixed(2)}`, bold: true, size: 28 })],
      alignment: AlignmentType.RIGHT,
      spacing: { before: 300 }
    })
  );

  const doc = new Document({
    sections: [{ children }]
  });

  const blob = await Packer.toBlob(doc);
  saveAs(blob, `${filename}.docx`);
}

// ============================================
// Extract Bill Data from AI Response
// ============================================
export type ExtractedBillData = {
  businessName?: string;
  address?: string;
  phone?: string;
  gstNumber?: string;
  items: {
    name: string;
    quantity?: number;
    unit?: string;
    rate?: number;
    amount: number;
  }[];
  subtotal?: number;
  gst?: number;
  discount?: number;
  grandTotal?: number;
};

export function parseBillDataFromAI(aiResponse: string): ExtractedBillData | null {
  try {
    // Try to find JSON in the response
    const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const data = JSON.parse(jsonMatch[0]);
      return data as ExtractedBillData;
    }
    return null;
  } catch {
    return null;
  }
}

export function convertExtractedDataToTables(data: ExtractedBillData): {
  header: Partial<HeaderTemplate>;
  tables: BillTable[];
} {
  const header: Partial<HeaderTemplate> = {
    businessName: data.businessName || "",
    address: data.address || "",
    phone: data.phone || "",
    gstNumber: data.gstNumber || ""
  };

  const makeId = () => Math.random().toString(36).substring(2, 9);
  
  const amountColId = makeId();
  const nameColId = makeId();
  const qtyColId = makeId();
  const rateColId = makeId();

  const table: BillTable = {
    id: makeId(),
    title: "Items",
    columns: [
      { id: nameColId, label: "Item", kind: "text" },
      { id: qtyColId, label: "Quantity", kind: "number" },
      { id: rateColId, label: "Rate", kind: "number" },
      { id: amountColId, label: "Amount", kind: "number" }
    ],
    rows: data.items.map(item => ({
      id: makeId(),
      cells: {
        [nameColId]: item.name,
        [qtyColId]: String(item.quantity || 1),
        [rateColId]: String(item.rate || item.amount),
        [amountColId]: String(item.amount)
      }
    }))
  };

  return { header, tables: [table] };
}

// Build the extraction prompt for AI
export const BILL_EXTRACTION_PROMPT = `Analyze this bill/invoice image and extract all data in this exact JSON format:

{
  "businessName": "Store/Business name",
  "address": "Full address if visible",
  "phone": "Phone number if visible",
  "gstNumber": "GST/Tax number if visible",
  "items": [
    {
      "name": "Item name",
      "quantity": 1,
      "unit": "kg/pcs/etc",
      "rate": 100,
      "amount": 100
    }
  ],
  "subtotal": 1000,
  "gst": 180,
  "discount": 0,
  "grandTotal": 1180
}

Rules:
1. Extract ALL items you can see
2. If quantity/rate not visible, estimate from amount
3. Include GST/tax if shown
4. Return ONLY valid JSON, no other text
5. Use numbers (not strings) for numeric values`;


// ============================================
// Professional Bill Export (Dharmendra Format)
// ============================================

const formatIndianCurrency = (amount: number): string => {
  return `\u20b9 ${formatIndianNumber(amount)}/-`;
};

const formatIndianNumber = (amount: number): string => {
  return amount.toLocaleString('en-IN');
};

// Format currency for PDF. Uses the real ₹ (U+20B9) symbol, which renders via the
// embedded Tinos font registered by registerRupeeFont().
const RUPEE_SYMBOL = "\u20b9";
const pdfCurrency = (amount: number): string => {
  const rounded = Math.round(amount * 100) / 100;
  return RUPEE_SYMBOL + " " + rounded.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "/-";
};

// Format a plain number for PDF, rounded to max 2 decimal places
const pdfNumber = (value: number): string => {
  const rounded = Math.round(value * 100) / 100;
  return rounded.toLocaleString('en-IN', { maximumFractionDigits: 2 });
};

export async function exportProfessionalPDF(
  header: HeaderTemplate,
  tables: BillTable[],
  billDetails: BillDetails,
  filename: string = "bill",
  options?: { fitToOnePage?: boolean; embed?: string },
  columns: ColumnLabels = defaultColumnLabels
): Promise<void> {
  const doc = new jsPDF();
  registerRupeeFont(doc);
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 20;
  let yPos = 10;

  // Calculate grand total across all tables
  const tableTotal = (t: BillTable) => t.rows.reduce((sum, row) => sum + (parseFloat(row.cells.amount) || 0), 0);
  const total = tables.reduce((sum, t) => sum + tableTotal(t), 0);
  const balance = total - billDetails.advance;

  if (billDetails.showHeader !== false) {
    // Single line above name (drawn wider)
    doc.setDrawColor(0);
    doc.setLineWidth(0.5);
    doc.line(margin - 8, yPos, pageWidth - margin + 8, yPos);
    
    const fsName = header.fontSizeName || 24;
    const fsContact = header.fontSizeContact || 11;
    const fsTagline = header.fontSizeTagline || 11;

    // Add gap from top single line to business name
    // Point to mm conversion factor is approx 0.3527.
    // 2.4mm gap between top line and top of the business name text.
    yPos += (fsName * 0.3527) + 2.4;

    // Business Name
    doc.setFontSize(fsName);
    doc.setFont("times", "normal");
    doc.text(header.businessName, pageWidth / 2, yPos, { align: "center" });
    yPos += (fsContact * 0.3527) + 1.5;

    // Phone
    doc.setFontSize(fsContact);
    doc.setFont("times", "normal");
    if (header.phone) {
      doc.text(`Mobile No. ${header.phone}`, pageWidth / 2, yPos, { align: "center" });
      yPos += (fsContact * 0.3527 * 1.15);
    }

    // Address
    if (header.address) {
      doc.text(header.address, pageWidth / 2, yPos, { align: "center" });
      yPos += (fsContact * 0.3527 * 1.15);
    }

    // GST
    if (billDetails.showGST !== false && header.gstNumber) {
      doc.text(`GST: ${header.gstNumber}`, pageWidth / 2, yPos, { align: "center" });
      yPos += (fsContact * 0.3527 * 1.15);
    }

    // First double line (top line is longer/full-width, bottom line is indented/shorter)
    yPos += -1.8;
    doc.setDrawColor(0);
    doc.setLineWidth(0.5);
    doc.line(margin, yPos, pageWidth - margin, yPos);
    doc.line(margin + 10, yPos + 1.0, pageWidth - margin - 10, yPos + 1.0);
    
    // Tagline (reduced gap below bottom line of double-line)
    yPos += 1.0 + (fsTagline * 0.3527) + 1.2;

    if (header.tagline) {
      doc.setFontSize(fsTagline);
      doc.setFont("times", "normal");
      const taglineLines = doc.splitTextToSize(header.tagline, pageWidth - 40);
      taglineLines.forEach((line: string, idx: number) => {
        doc.text(line, pageWidth / 2, yPos, { align: "center" });
        if (idx < taglineLines.length - 1) {
          yPos += (fsTagline * 0.3527 * 1.15);
        }
      });
      yPos += (fsTagline * 0.3527 * 0.5) + 6.0;
    }
  } else {
    yPos = 15;
  }

  // Date - Right aligned
  if (billDetails.showDate !== false) {
    yPos += 5;
    doc.setFontSize(11);
    doc.text(`Date: ${formatDateForExport(billDetails.date)}`, pageWidth - margin, yPos, { align: "right" });
    yPos += 10;
  }

  // Client Details
  if (billDetails.showClientDetails !== false) {
    doc.setFont("times", "normal");
    doc.text("To,", margin, yPos);
    yPos += 6;
    doc.setFont("times", "bold");
    doc.text(billDetails.clientName || "________________", margin, yPos);
    yPos += 6;
    doc.setFont("times", "normal");
    if (billDetails.showClientAddress !== false) {
      const addressLines = doc.splitTextToSize(billDetails.clientAddress || "________________", pageWidth - 2 * margin - 40);
      doc.text(addressLines, margin, yPos);
      yPos += addressLines.length * 6;
    } else {
      yPos += 6;
    }
    yPos += 12;
  }

  // Subject - Centered (only when a subject is provided)
  if (billDetails.subject && billDetails.subject.trim()) {
    doc.setFont("times", "normal");
    doc.text(`Sub: ${billDetails.subject}`, pageWidth / 2, yPos, { align: "center", maxWidth: pageWidth - 40 });
    yPos += 12;
  }

  // ── Dynamic column widths (shared by every section table) ─────────────────
  // Measure the content so nothing is truncated. Sr/Quantity/Rate/Amount are
  // sized to the widest value (or their header); Size is sized to fit its
  // longest entry; Particulars takes whatever width remains. Size + Particulars
  // also wrap to multiple lines as a final safety net so text is never cut.
  const contentWidth = pageWidth - 2 * margin;
  const measureMax = (texts: string[], style: "normal" | "bold", fs: number): number => {
    doc.setFont("times", style);
    doc.setFontSize(fs);
    return texts.reduce((w, t) => Math.max(w, doc.getTextWidth(t || "")), 0);
  };
  const allRowsForWidth = tables.flatMap(t => t.rows);
  // A long custom header (e.g. "Materials with labour Charges") should WRAP inside
  // its column rather than stretch the column, so cap its width contribution.
  const HEADER_CAP = 34;
  const headerW = (label: string) => Math.min(measureMax([label], "bold", 11), HEADER_CAP);
  const dataMax = (texts: string[]) => measureMax(texts, "normal", 11);

  const srData = allRowsForWidth.map((r, i) => String(r.cells.sr || i + 1));
  const qtyData = allRowsForWidth.map(r => { const q = parseFloat(r.cells.quantity) || 0; return q > 0 ? pdfNumber(q) : "\u2014"; });
  const rateData = allRowsForWidth.map(r => { const v = parseFloat(r.cells.rate) || 0; return v > 0 ? pdfNumber(v) : "\u2014"; });
  // Include each table's subtotal (with the ₹ symbol) so the Amount column is
  // wide enough for the in-table Total row.
  const tableSubtotals = tables.map(t => t.rows.reduce((s, r) => s + (parseFloat(r.cells.amount) || 0), 0));
  const amtData = [
    ...allRowsForWidth.map(r => { const v = parseFloat(r.cells.amount) || 0; return v > 0 ? pdfCurrency(v) : "\u2014"; }),
    ...tableSubtotals.map(s => pdfCurrency(s))
  ];
  const sizeData = tables.flatMap(t => t.rows.map(r => {
    const s = (r.cells.size || "").trim();
    if (s.toUpperCase() === "LS") return "";
    const applyInch = (t.mode ?? "template") !== "manual";
    return applyInch ? convertAllPointValues(s) : s;
  }));
  const PAD = 5;
  let srW = Math.min(Math.max(Math.max(headerW(columns.sr), dataMax(srData)) + PAD, 12), 24);
  let qtyW = Math.max(Math.max(headerW(columns.quantity), dataMax(qtyData)) + PAD, 16);
  let rateW = Math.max(Math.max(headerW(columns.rate), dataMax(rateData)) + PAD, 14);
  let amtW = Math.max(Math.max(headerW(columns.amount), dataMax(amtData)) + PAD, 22);
  // Guarantee Size + Particulars always keep a usable share of the width. If the
  // numeric columns would be too greedy (very large numbers), scale them down —
  // their cells wrap, so the values still show in full over multiple lines.
  const SIZE_PLUS_PARTICULARS_MIN = 56;
  const maxNumericTotal = contentWidth - SIZE_PLUS_PARTICULARS_MIN;
  const numericTotal = srW + qtyW + rateW + amtW;
  if (numericTotal > maxNumericTotal) {
    const f = maxNumericTotal / numericTotal;
    srW *= f; qtyW *= f; rateW *= f; amtW *= f;
  }
  const remainingForSizeAndParticulars = contentWidth - (srW + qtyW + rateW + amtW);
  const PARTICULARS_MIN = 38;
  const sizePreferred = Math.max(headerW(columns.size), dataMax(sizeData)) + PAD;
  // Give Size what it needs, but never so much that Particulars drops below its
  // minimum; clamp within the space that's actually available.
  let sizeW = Math.min(sizePreferred, remainingForSizeAndParticulars - PARTICULARS_MIN);
  sizeW = Math.max(sizeW, 18);
  sizeW = Math.min(sizeW, Math.max(remainingForSizeAndParticulars - 12, 18));
  const particularsW = Math.max(remainingForSizeAndParticulars - sizeW, 12);
  const colWidths = [srW, particularsW, sizeW, qtyW, rateW, amtW];
  const colX = [
    margin + 2, // Sr. No
    margin + colWidths[0] + 2, // Particulars
    margin + colWidths[0] + colWidths[1] + 2, // Size
    margin + colWidths[0] + colWidths[1] + colWidths[2] + 2, // Quantity
    margin + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + 2, // Rate
    margin + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + colWidths[4] + 2 // Amount
  ];

  // Calculate vertical line X coordinates
  const verticalX = [
    margin,
    margin + colWidths[0],
    margin + colWidths[0] + colWidths[1],
    margin + colWidths[0] + colWidths[1] + colWidths[2],
    margin + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3],
    margin + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + colWidths[4],
    pageWidth - margin
  ];

  // Horizontal centres of each column (used when drawing wrapped cell text).
  const srCenterX = margin + colWidths[0] / 2;
  const sizeCenterX = margin + colWidths[0] + colWidths[1] + colWidths[2] / 2;
  const qtyCenterX = margin + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] / 2;
  const rateCenterX = margin + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + colWidths[4] / 2;
  const amtCenterX = margin + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + colWidths[4] + colWidths[5] / 2;

  const headerHeight = 6.5;
  const minRowHeight = 6;
  const pageBottom = 285;
  const multipleTables = tables.length > 1;

  // Draws a shaded, bordered column-header row starting at the current yPos.
  // Returns the y-coordinate at the top of the header (for vertical line drawing).
  const drawTableHeader = (scale: number = 1): number => {
    doc.setFont("times", "bold");
    doc.setFontSize(11 * scale);
    // Wrap each (possibly renamed) header label within its column; the header row
    // grows taller if any label needs more than one line.
    const labels = [columns.sr, columns.particulars, columns.size, columns.quantity, columns.rate, columns.amount];
    const labelLines = colWidths.map((w, i) => doc.splitTextToSize(labels[i] || "", Math.max(w - 3, 6)));
    const maxLines = Math.max(1, ...labelLines.map(l => l.length));
    const hLineSpacing = 11 * scale * 0.42;
    const hH = Math.max(headerHeight * scale, (maxLines - 1) * hLineSpacing + 11 * scale * 0.25 + 3.2 * scale);

    const yTopHeader = yPos - 4 * scale;
    doc.setFillColor(245, 245, 245);
    doc.rect(margin, yTopHeader, pageWidth - 2 * margin, hH, "F");

    const centers = [
      margin + colWidths[0] / 2,
      margin + colWidths[0] + 2, // Particulars = left aligned
      margin + colWidths[0] + colWidths[1] + colWidths[2] / 2,
      margin + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] / 2,
      margin + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + colWidths[4] / 2,
      margin + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + colWidths[4] + colWidths[5] / 2
    ];
    labelLines.forEach((lines, i) => {
      const n = lines.length;
      const yBase = yTopHeader + hH / 2 - ((n - 1) * hLineSpacing) / 2 + (11 * scale * 0.25) / 2;
      doc.text(lines, centers[i], yBase, { align: i === 1 ? "left" : "center" });
    });

    doc.setDrawColor(0);
    doc.setLineWidth(0.2);
    doc.line(margin, yTopHeader, pageWidth - margin, yTopHeader);
    doc.line(margin, yTopHeader + hH, pageWidth - margin, yTopHeader + hH);
    // Header vertical separators (full set)
    verticalX.forEach(x => doc.line(x, yTopHeader, x, yTopHeader + hH));

    yPos = yTopHeader + hH;
    return yTopHeader;
  };

  // Draw vertical grid lines for a single row segment. For "LS" (lump-sum) rows
  // the Size/Quantity/Rate separators are omitted so those three columns read
  // as one merged cell.
  const drawRowVerticals = (top: number, bottom: number, merged: boolean) => {
    const idxs = merged ? [0, 1, 2, 5, 6] : [0, 1, 2, 3, 4, 5, 6];
    idxs.forEach(i => doc.line(verticalX[i], top, verticalX[i], bottom));
  };

  // Render one section table. Returns its subtotal.
  // Behaviour: never split a table across pages. If a table overflows the page by
  // only a few rows, its rows are shrunk slightly so the whole table fits on one
  // page. If it overflows by more, the whole table moves to the next page (or, if
  // it is genuinely taller than a full page, it flows and splits between rows).
  const drawSectionTable = (table: BillTable, reserveBelow: number = 0, scale: number = 1): number => {
    const fitMode = scale !== 1;
    // Pre-measure each data row's natural height (accounts for multi-line text).
    // Fonts and heights are multiplied by `scale` (1 = normal size).
    // Normal cell font geometry (Sr / Size / Quantity / Rate / Amount).
    const nfs = 11 * scale;
    const nLineSpacing = nfs * 0.405;
    const nCapHeight = nfs * 0.25;
    const heightOf = (n: number, lineSpacing: number, capHeight: number) => (n > 0 ? (n - 1) * lineSpacing + capHeight : 0);

    const measured = table.rows.map((row, index) => {
      const fontSize = (parseInt(row.cells.fontSize) || 11) * scale;
      const isBold = row.cells.bold === "true";
      const align = (row.cells.align as any) || "left";

      // Particulars (per-row font size / weight, wraps within its column).
      doc.setFont("times", isBold ? "bold" : "normal");
      doc.setFontSize(fontSize);
      const lines = doc.splitTextToSize(row.cells.particulars || "", colWidths[1] - 4);
      const lineSpacing = fontSize * 0.405;
      const capHeight = fontSize * 0.25;
      const textHeight = heightOf(lines.length, lineSpacing, capHeight);

      // Every other cell wraps too, so no value is ever clipped. Measured at 11pt.
      doc.setFont("times", "normal");
      doc.setFontSize(nfs);
      const sizeRaw = row.cells.size || "";
      const isLSRow = sizeRaw.trim().toUpperCase() === "LS";
      // Apply inch conversion when the table is in template mode (default).
      const applyInch = (table.mode ?? "template") !== "manual";
      const sizeStr = (!isLSRow && applyInch && sizeRaw) ? convertAllPointValues(sizeRaw) : sizeRaw;
      const quantity = parseFloat(row.cells.quantity) || 0;
      const rate = parseFloat(row.cells.rate) || 0;
      const amount = parseFloat(row.cells.amount) || 0;

      const srLines = doc.splitTextToSize(String(row.cells.sr || index + 1), colWidths[0] - 2);
      const sizeLines = sizeStr && !isLSRow ? doc.splitTextToSize(sizeStr, colWidths[2] - 3) : [];
      const qtyLines = !isLSRow ? doc.splitTextToSize(quantity > 0 ? pdfNumber(quantity) : "\u2014", colWidths[3] - 3) : [];
      const rateLines = !isLSRow ? doc.splitTextToSize(rate > 0 ? pdfNumber(rate) : "\u2014", colWidths[4] - 3) : [];
      const amtLines = doc.splitTextToSize(amount > 0 ? pdfCurrency(amount) : "\u2014", colWidths[5] - 3);

      // Row height fits the tallest cell across all columns.
      const maxTextHeight = Math.max(
        textHeight,
        heightOf(srLines.length, nLineSpacing, nCapHeight),
        heightOf(sizeLines.length, nLineSpacing, nCapHeight),
        heightOf(qtyLines.length, nLineSpacing, nCapHeight),
        heightOf(rateLines.length, nLineSpacing, nCapHeight),
        heightOf(amtLines.length, nLineSpacing, nCapHeight)
      );
      const naturalHeight = Math.max(maxTextHeight + 2.5 * scale, minRowHeight * scale);

      return {
        row, fontSize, isBold, align, isLS: isLSRow,
        lines, lineSpacing, capHeight, textHeight, maxTextHeight, naturalHeight,
        srLines, sizeLines, qtyLines, rateLines, amtLines
      };
    });

    const labelHeight = ((table.title && table.title.trim()) ? 7 : 0) * scale;
    const totalRowHeight = minRowHeight * scale;
    const headerH = headerHeight * scale;
    const fixedHeight = labelHeight + headerH + totalRowHeight;
    const rowsNaturalHeight = measured.reduce((h, m) => h + m.naturalHeight, 0);
    const naturalTableHeight = fixedHeight + rowsNaturalHeight;

    let rowHeights = measured.map(m => m.naturalHeight);
    let compressed = false;

    if (fitMode) {
      // The global fit-to-one-page scale already sized this table to fit; draw it
      // straight through, with no page breaks or per-table compression.
      compressed = true;
    } else {
      // Try to fit all rows into `avail` mm by mildly shrinking row heights. Returns
      // per-row heights, or null if it can't fit without clipping text (a row is
      // never shrunk below the height of its own text).
      const fitRowsInto = (avail: number): number[] | null => {
        const availableForRows = avail - fixedHeight;
        if (availableForRows <= 0) return null;
        if (rowsNaturalHeight <= availableForRows) return measured.map(m => m.naturalHeight);
        const factor = availableForRows / rowsNaturalHeight;
        const heights = measured.map(m => Math.max(m.naturalHeight * factor, m.maxTextHeight + 0.6));
        const totalH = heights.reduce((a, b) => a + b, 0);
        return totalH <= availableForRows + 0.4 ? heights : null;
      };

      const maxExtra = minRowHeight * 3; // "a few rows" worth of overflow
      // Reserve space at the bottom of the page (e.g. for the grand-total summary
      // that must stay with the last table) so this table never crowds it out.
      const bottomLimit = pageBottom - reserveBelow;
      const currentAvailable = bottomLimit - yPos;
      const freshAvailable = bottomLimit - 20;

      if (naturalTableHeight <= currentAvailable) {
        // Fits as-is in the space left on the current page.
      } else {
        // Doesn't fit here. If it's only slightly over, shrink to fit the current page.
        let comp: number[] | null = null;
        if (yPos > 20 && naturalTableHeight - currentAvailable <= maxExtra) {
          comp = fitRowsInto(currentAvailable);
        }
        if (comp) {
          rowHeights = comp;
          compressed = true;
        } else if (yPos > 20 && naturalTableHeight <= freshAvailable) {
          // Fits wholly on a fresh page — move it there intact.
          doc.addPage();
          yPos = 20;
        } else {
          // Taller than a full page. Start on a fresh page, then shrink to a single
          // page if the overflow is small; otherwise let it flow (split cleanly).
          if (yPos > 20) { doc.addPage(); yPos = 20; }
          if (naturalTableHeight - (bottomLimit - yPos) <= maxExtra) {
            const c = fitRowsInto(bottomLimit - yPos);
            if (c) { rowHeights = c; compressed = true; }
          }
        }
      }
    }

    // Optional left-aligned label above the table (e.g. "Master Bedroom")
    if (table.title && table.title.trim()) {
      doc.setFont("times", "bold");
      doc.setFontSize(12 * scale);
      doc.text(table.title, margin, yPos, { align: "left" });
      yPos += 7 * scale;
    }

    drawTableHeader(scale);
    let subtotal = 0;

    measured.forEach((m, index) => {
      const isLS = m.isLS;
      const align = m.align;
      const rowHeight = rowHeights[index];

      // Page break only when the table is flowing (a compressed table always fits).
      if (!compressed && yPos + rowHeight > pageBottom) {
        doc.addPage();
        yPos = 20;
        drawTableHeader();
      }

      const yTop = yPos;
      // Vertically-centred baseline for a block of `n` lines at the given spacing.
      const baselineFor = (n: number, lineSpacing: number, capHeight: number) =>
        yTop + rowHeight / 2 - ((Math.max(n, 1) - 1) * lineSpacing) / 2 + capHeight / 2;

      // Sr. No (normal font, centred, wraps if ever needed).
      doc.setFont("times", "normal");
      doc.setFontSize(nfs);
      doc.text(m.srLines, srCenterX, baselineFor(m.srLines.length, nLineSpacing, nCapHeight), { align: "center" });

      // Particulars (per-row font size / weight, honours row alignment).
      doc.setFont("times", m.isBold ? "bold" : "normal");
      doc.setFontSize(m.fontSize);
      const alignOpt = align === "left" ? "left" : align === "right" ? "right" : "center";
      const drawX = colX[1] + (align === "right" ? colWidths[1] - 4 : align === "center" ? (colWidths[1] - 4) / 2 : 0);
      doc.text(m.lines, drawX, baselineFor(m.lines.length, m.lineSpacing, m.capHeight), { align: alignOpt });

      // Size / Quantity / Rate (or a single merged "LS" cell).
      doc.setFont("times", "normal");
      doc.setFontSize(nfs);
      if (isLS) {
        doc.text("LS", (verticalX[2] + verticalX[5]) / 2, baselineFor(1, nLineSpacing, nCapHeight), { align: "center" });
      } else {
        const sizeLines = m.sizeLines.length > 0 ? m.sizeLines : ["\u2014"];
        doc.text(sizeLines, sizeCenterX, baselineFor(sizeLines.length, nLineSpacing, nCapHeight), { align: "center" });
        doc.text(m.qtyLines, qtyCenterX, baselineFor(m.qtyLines.length, nLineSpacing, nCapHeight), { align: "center" });
        doc.text(m.rateLines, rateCenterX, baselineFor(m.rateLines.length, nLineSpacing, nCapHeight), { align: "center" });
      }
      // Amount (always shown; wraps if ever needed).
      doc.text(m.amtLines, amtCenterX, baselineFor(m.amtLines.length, nLineSpacing, nCapHeight), { align: "center" });

      subtotal += parseFloat(m.row.cells.amount) || 0;

      yPos += rowHeight;
      // Draw horizontal grid line below the row
      doc.line(margin, yPos, pageWidth - margin, yPos);
      // Vertical grid lines for this row (merged for LS rows)
      drawRowVerticals(yTop, yPos, isLS);
    });

    // In-table Total row: two boxes under the Rate and Amount columns only.
    const totalRowH = minRowHeight * scale;
    if (!compressed && yPos + totalRowH > pageBottom) { doc.addPage(); yPos = 20; }
    const totalTop = yPos;
    const totalBot = yPos + totalRowH;
    doc.setDrawColor(0);
    doc.setLineWidth(0.2);
    // Box borders: Rate column = verticalX[4]..[5], Amount column = verticalX[5]..[6]
    doc.line(verticalX[4], totalTop, verticalX[6], totalTop);
    doc.line(verticalX[4], totalBot, verticalX[6], totalBot);
    doc.line(verticalX[4], totalTop, verticalX[4], totalBot);
    doc.line(verticalX[5], totalTop, verticalX[5], totalBot);
    doc.line(verticalX[6], totalTop, verticalX[6], totalBot);
    // Box text ("Total" under Rate, summed amount with the ₹ symbol under Amount)
    const yBaseTotal = totalTop + totalRowH / 2 + 1.25 * scale;
    doc.setFont("times", "bold");
    doc.setFontSize(10 * scale);
    doc.text("Total", (verticalX[4] + verticalX[5]) / 2, yBaseTotal, { align: "center" });
    doc.text(pdfCurrency(subtotal), (verticalX[5] + verticalX[6]) / 2, yBaseTotal, { align: "center" });
    yPos = totalBot;

    return subtotal;
  };

  // Grand-total summary footprint (Total + Advance + Balance), reserved below the
  // last page group so it never gets orphaned on its own page.
  const GRAND_SUMMARY_RESERVE = 40;
  const noteReserve = (billDetails.showNote && billDetails.note) ? 20 : 0;

  // Natural (unscaled) printed height of one table.
  const measureTableNatural = (table: BillTable): number => {
    let rowsH = 0;
    table.rows.forEach(row => {
      const fontSize = parseInt(row.cells.fontSize) || 11;
      const isBold = row.cells.bold === "true";
      doc.setFont("times", isBold ? "bold" : "normal");
      doc.setFontSize(fontSize);
      const lines = doc.splitTextToSize(row.cells.particulars || "", colWidths[1] - 4);
      const lineSpacing = fontSize * 0.405;
      const capHeight = fontSize * 0.25;
      const textHeight = (lines.length - 1) * lineSpacing + capHeight;
      // Account for wrapped Size lines too.
      const sizeRawM = row.cells.size || "";
      const isLSRowM = sizeRawM.trim().toUpperCase() === "LS";
      const applyInchM = (table.mode ?? "template") !== "manual";
      const sizeStrM = (!isLSRowM && applyInchM && sizeRawM) ? convertAllPointValues(sizeRawM) : sizeRawM;
      doc.setFont("times", "normal");
      doc.setFontSize(11);
      const sizeLines = sizeStrM && !isLSRowM ? doc.splitTextToSize(sizeStrM, colWidths[2] - 3) : [];
      const sizeTextHeight = sizeLines.length > 0 ? (sizeLines.length - 1) * (11 * 0.405) + 11 * 0.25 : 0;
      rowsH += Math.max(Math.max(textHeight, sizeTextHeight) + 2.5, minRowHeight);
    });
    const labelH = (table.title && table.title.trim()) ? 7 : 0;
    return labelH + headerHeight + rowsH + minRowHeight;
  };

  // Partition tables into page groups using their page numbers. A new group
  // starts whenever a table's page number is higher than the previous table's.
  const groups: BillTable[][] = [];
  tables.forEach((t, i) => {
    const thisPage = t.page ?? 1;
    const prevPage = i > 0 ? (tables[i - 1].page ?? 1) : thisPage;
    if (i === 0 || thisPage > prevPage) groups.push([t]);
    else groups[groups.length - 1].push(t);
  });

  // When enabled, each page group is shrunk (row heights + fonts) just enough to
  // fit on its own single page. Groups always begin on a fresh page.
  const shrinkToFit = options?.fitToOnePage === true;

  groups.forEach((group, gi) => {
    const isLastGroup = gi === groups.length - 1;
    if (gi > 0) { doc.addPage(); yPos = 20; }

    let groupScale = 1;
    if (shrinkToFit) {
      const naturalGroupHeight =
        group.reduce((s, t) => s + measureTableNatural(t), 0) + 15 * Math.max(0, group.length - 1);
      // The last group leaves room for the grand-total summary (+ note/signature).
      const endLimit = isLastGroup
        ? (billDetails.showSignature ? 236 : pageBottom - 6) - GRAND_SUMMARY_RESERVE - noteReserve
        : pageBottom - 6;
      const availableForGroup = endLimit - yPos;
      if (availableForGroup > 0 && naturalGroupHeight > availableForGroup) {
        // Never shrink below 40% (stays readable); if it still won't fit, the
        // group simply flows to another page as usual.
        groupScale = Math.max(0.4, availableForGroup / naturalGroupHeight);
      }
    }
    const groupFitActive = groupScale < 1;

    group.forEach((table, ti) => {
      const isLastTable = ti === group.length - 1;
      // Reserve room for the grand-total summary below the last table of the last
      // group — but only at natural size (the fit path already reserved that space).
      const reserveBelow = (!groupFitActive && isLastGroup && isLastTable) ? GRAND_SUMMARY_RESERVE : 0;
      drawSectionTable(table, reserveBelow, groupScale);
      if (!isLastTable) yPos += 15 * groupScale;
    });
  });

  // Gap between the last table and the grand-total summary.
  yPos += 14;

  // Draw left-aligned totals below the tables (no box)
  if (yPos + 25 > pageBottom) { doc.addPage(); yPos = 20; }
  const boxX = margin;
  const boxY = yPos;
  const rowHeight = 4.5;
  const labelX = boxX;
  const valX = boxX + 45;
  
  // Total is always shown; Advance and Balance are optional.
  const showAdvance = billDetails.showAdvance !== false;
  const showBalance = billDetails.showBalance !== false;
  const showGrandTotal = billDetails.showGrandTotal !== false;
  const summaryEntries: { label: string; value: number; bold: boolean; divider: boolean }[] = [];
  if (showGrandTotal) summaryEntries.push({ label: multipleTables ? "Grand Total:" : "Total:", value: total, bold: true, divider: false });
  if (showAdvance) summaryEntries.push({ label: "Advance:", value: billDetails.advance, bold: false, divider: false });
  if (showBalance) summaryEntries.push({ label: "Balance:", value: balance, bold: true, divider: showAdvance });

  summaryEntries.forEach((e, i) => {
    const y = boxY + rowHeight * i + rowHeight * 0.7;
    if (e.divider) {
      doc.setLineWidth(0.15);
      doc.line(labelX, boxY + rowHeight * i, valX, boxY + rowHeight * i);
    }
    doc.setFont("times", e.bold ? "bold" : "normal");
    doc.setFontSize(9);
    doc.text(e.label, labelX, y);
    doc.text(pdfCurrency(e.value), valX, y, { align: "right" });
  });
  doc.setLineWidth(0.2);
  yPos = boxY + rowHeight * summaryEntries.length + 8;

  // Note
  if (billDetails.showNote && billDetails.note) {
    doc.setFont("times", "bold");
    doc.text("Note.", margin, yPos);
    yPos += 5;
    doc.setFont("times", "normal");
    doc.text(billDetails.note, margin, yPos, { maxWidth: pageWidth - 40 });
    yPos += 15;
  }

  // Signature
  if (billDetails.showSignature) {
    yPos = Math.max(yPos, 240); // Push signature to bottom
    doc.setFont("times", "normal");
    doc.text(`Proprietor: ${billDetails.proprietorName}`, pageWidth - margin - 60, yPos, { align: "center" });
    yPos += 15;
    doc.text("Authorised Signatory", pageWidth - margin - 60, yPos, { align: "center" });
  }

  // If editable bill data was provided, append it after the PDF so the file can
  // be re-uploaded and edited in-app. Otherwise save normally.
  if (options?.embed) {
    const pdfBytes = doc.output("arraybuffer");
    const blob = new Blob([pdfBytes, options.embed], { type: "application/pdf" });
    saveAs(blob, `${filename}.pdf`);
  } else {
    doc.save(`${filename}.pdf`);
  }
}

export async function exportProfessionalExcel(
  header: HeaderTemplate,
  tables: BillTable[],
  billDetails: BillDetails,
  filename: string = "bill",
  columns: ColumnLabels = defaultColumnLabels
): Promise<void> {
  const tableTotal = (t: BillTable) => t.rows.reduce((sum, row) => sum + (parseFloat(row.cells.amount) || 0), 0);
  const total = tables.reduce((sum, t) => sum + tableTotal(t), 0);
  const balance = total - billDetails.advance;
  const multipleTables = tables.length > 1;

  const wb = new ExcelJS.Workbook();
  // Page setup: fit ALL columns onto one page width so columns never spill onto
  // a separate page. Height flows naturally (rows are never split mid-row).
  const ws = wb.addWorksheet("Bill", {
    pageSetup: {
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      orientation: "portrait",
      margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 }
    }
  });

  ws.columns = [
    { width: 8 }, { width: 45 }, { width: 15 }, { width: 12 }, { width: 12 }, { width: 16 }
  ];

  const LAST_COL = "F";
  const thin = { style: "thin" as const, color: { argb: "FF000000" } };
  const cellBorder = { top: thin, left: thin, bottom: thin, right: thin };
  const headerFill = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFF0F0F0" } };

  type BannerOpts = { align?: "left" | "center" | "right"; bold?: boolean; size?: number };
  const addBanner = (text: string, opts: BannerOpts = {}) => {
    const row = ws.addRow([text]);
    ws.mergeCells(`A${row.number}:${LAST_COL}${row.number}`);
    const cell = row.getCell(1);
    cell.alignment = { horizontal: opts.align || "center", vertical: "middle", wrapText: true };
    cell.font = { bold: !!opts.bold, size: opts.size || 11 };
    return row;
  };
  const addSpacer = () => ws.addRow([]);

  // Header / letterhead
  if (billDetails.showHeader !== false) {
    addBanner(header.businessName || "", { bold: true, size: 16 });
    if (header.phone) addBanner(`Mobile No. ${header.phone}`);
    if (header.address) addBanner(header.address);
    if (billDetails.showGST !== false && header.gstNumber) addBanner(`GST: ${header.gstNumber}`);
    if (header.tagline) addBanner(header.tagline, { size: 10 });
    addSpacer();
  }

  if (billDetails.showDate !== false) {
    addBanner(`Date: ${formatDateForExport(billDetails.date)}`, { align: "right" });
  }

  if (billDetails.showClientDetails !== false) {
    ws.addRow(["To,"]);
    const cn = ws.addRow([billDetails.clientName || ""]);
    cn.getCell(1).font = { bold: true };
    if (billDetails.showClientAddress !== false) ws.addRow([billDetails.clientAddress || ""]);
  }
  addSpacer();

  if (billDetails.subject && billDetails.subject.trim()) {
    ws.addRow([`Sub: ${billDetails.subject}`]);
    addSpacer();
  }

  tables.forEach((table) => {
    // Optional left-aligned table label (e.g. "Master Bedroom")
    if (table.title && table.title.trim()) {
      const t = ws.addRow([table.title]);
      t.getCell(1).font = { bold: true, size: 12 };
    }

    // Column header row
    const hr = ws.addRow([columns.sr, columns.particulars, columns.size, columns.quantity, columns.rate, columns.amount]);
    hr.eachCell(c => {
      c.font = { bold: true };
      c.fill = headerFill;
      c.border = cellBorder;
      c.alignment = { horizontal: "center" };
    });

    // Data rows
    table.rows.forEach((row, index) => {
      const amtVal = parseFloat(row.cells.amount) || 0;
      const qty = parseFloat(row.cells.quantity) || 0;
      const rate = parseFloat(row.cells.rate) || 0;
      const isLS = (row.cells.size || "").trim().toUpperCase() === "LS";
      const qtyRounded = Math.round(qty * 100) / 100;
      const rateRounded = Math.round(rate * 100) / 100;
      const dr = ws.addRow([
        row.cells.sr || String(index + 1),
        row.cells.particulars || "",
        isLS ? "LS" : (row.cells.size || ""),
        isLS ? "" : (qty > 0 ? qtyRounded : ""),
        isLS ? "" : (rate > 0 ? rateRounded : ""),
        amtVal > 0 ? `${formatIndianNumber(amtVal)}/-` : ""
      ]);
      dr.eachCell({ includeEmpty: true }, c => { c.border = cellBorder; });
      [1, 3, 4, 5, 6].forEach(i => { dr.getCell(i).alignment = { horizontal: "center" }; });
      if (isLS) {
        // Merge Size + Quantity + Rate into one centered "LS" cell
        ws.mergeCells(`C${dr.number}:E${dr.number}`);
        dr.getCell(3).alignment = { horizontal: "center" };
      }
    });

    // In-table Total row ("Total" under Rate, summed amount under Amount)
    const sub = tableTotal(table);
    const tr = ws.addRow(["", "", "", "", "Total", `${formatIndianNumber(sub)}/-`]);
    [5, 6].forEach(i => {
      tr.getCell(i).font = { bold: true };
      tr.getCell(i).border = cellBorder;
      tr.getCell(i).alignment = { horizontal: "center" };
    });
    addSpacer();
  });

  // Grand totals (Total always; Advance/Balance optional)
  const summaryLines: [string, string][] = [];
  if (billDetails.showGrandTotal !== false) summaryLines.push([multipleTables ? "Grand Total:" : "Total:", `${formatIndianNumber(total)}/-`]);
  if (billDetails.showAdvance !== false) summaryLines.push(["Advance:", `${formatIndianNumber(billDetails.advance)}/-`]);
  if (billDetails.showBalance !== false) summaryLines.push(["Balance:", `${formatIndianNumber(balance)}/-`]);
  summaryLines.forEach(([label, value]) => {
    const r = ws.addRow(["", "", "", "", label, value]);
    r.getCell(5).font = { bold: true };
    r.getCell(6).font = { bold: true };
    r.getCell(6).alignment = { horizontal: "center" };
  });
  addSpacer();

  // Note
  if (billDetails.showNote && billDetails.note) {
    const n = ws.addRow(["Note."]);
    n.getCell(1).font = { bold: true };
    ws.addRow([billDetails.note]);
    addSpacer();
  }

  // Signature
  if (billDetails.showSignature) {
    addSpacer();
    ws.addRow(["", "", "", "", "", `Proprietor: ${billDetails.proprietorName}`]);
    ws.addRow(["", "", "", "", "", "Authorised Signatory"]);
  }

  const buffer = await wb.xlsx.writeBuffer();
  saveAs(
    new Blob([buffer as any], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `${filename}.xlsx`
  );
}

export async function exportProfessionalWord(
  header: HeaderTemplate,
  tables: BillTable[],
  billDetails: BillDetails,
  filename: string = "bill",
  columns: ColumnLabels = defaultColumnLabels
): Promise<void> {
  const tableTotalW = (t: BillTable) => t.rows.reduce((sum, row) => sum + (parseFloat(row.cells.amount) || 0), 0);
  const total = tables.reduce((sum, t) => sum + tableTotalW(t), 0);
  const balance = total - billDetails.advance;
  const multipleTables = tables.length > 1;

  const children: (Paragraph | Table)[] = [];

  const fsName = header.fontSizeName || 24;
  const fsContact = header.fontSizeContact || 11;
  const fsTagline = header.fontSizeTagline || 11;

  if (billDetails.showHeader !== false) {
    // Business Name with a top border (single line above name)
    children.push(
      new Paragraph({
        children: [new TextRun({ text: header.businessName, bold: false, size: fsName * 2 })],
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 0 },
        border: {
          top: { style: BorderStyle.SINGLE, size: 6, space: 4, color: "000000" }
        }
      })
    );

    const beforeTaglineConfigs: {
      text: string;
      size: number;
      spacing?: { before: number; after: number };
    }[] = [];

    if (header.phone) {
      beforeTaglineConfigs.push({
        text: `Mobile No. ${header.phone}`,
        size: fsContact * 2,
        spacing: { before: 0, after: 0 }
      });
    }

    if (header.address) {
      beforeTaglineConfigs.push({
        text: header.address,
        size: fsContact * 2,
        spacing: { before: 0, after: 0 }
      });
    }

    if (billDetails.showGST !== false && header.gstNumber) {
      beforeTaglineConfigs.push({
        text: `GST: ${header.gstNumber}`,
        size: fsContact * 2,
        spacing: { before: 0, after: 0 }
      });
    }

    beforeTaglineConfigs.forEach((cfg, idx) => {
      const isLast = idx === beforeTaglineConfigs.length - 1;
      children.push(
        new Paragraph({
          children: [new TextRun({ text: cfg.text, size: cfg.size })],
          alignment: AlignmentType.CENTER,
          spacing: cfg.spacing ? {
            before: cfg.spacing.before,
            after: isLast ? 20 : cfg.spacing.after
          } : undefined,
          border: isLast ? {
            bottom: { style: BorderStyle.DOUBLE, size: 12, space: 2, color: "000000" }
          } : undefined
        })
      );
    });

    if (header.tagline) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: header.tagline, size: fsTagline * 2, italics: true })],
          alignment: AlignmentType.CENTER,
          spacing: { before: 20, after: 20 }
        })
      );
    }
  }

  // Date
  if (billDetails.showDate !== false) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: `Date: ${formatDateForExport(billDetails.date)}`, size: 22 })],
        alignment: AlignmentType.RIGHT,
        spacing: { before: 200 }
      })
    );
  }

  // Client
  children.push(new Paragraph({ children: [new TextRun({ text: "To,", size: 22 })], spacing: { before: 200 } }));
  children.push(new Paragraph({ children: [new TextRun({ text: billDetails.clientName, bold: true, size: 22 })] }));
  if (billDetails.showClientAddress !== false) {
    children.push(new Paragraph({ children: [new TextRun({ text: billDetails.clientAddress, size: 22 })], spacing: { after: 200 } }));
  } else {
    children.push(new Paragraph({ children: [new TextRun({ text: "", size: 22 })], spacing: { after: 200 } }));
  }

  // Subject
  children.push(
    new Paragraph({
      children: [new TextRun({ text: `Sub: ${billDetails.subject}`, size: 22 })],
      spacing: { after: 200 }
    })
  );

  // Build the column-header row (reused for every section table)
  const buildHeaderRow = () =>
    new TableRow({
      children: [
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: columns.sr, bold: true })] })], shading: { fill: "F0F0F0" }, width: { size: 8, type: WidthType.PERCENTAGE } }),
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: columns.particulars, bold: true })] })], shading: { fill: "F0F0F0" }, width: { size: 42, type: WidthType.PERCENTAGE } }),
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: columns.size, bold: true })] })], shading: { fill: "F0F0F0" }, width: { size: 15, type: WidthType.PERCENTAGE } }),
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: columns.quantity, bold: true })], alignment: AlignmentType.CENTER })], shading: { fill: "F0F0F0" }, width: { size: 10, type: WidthType.PERCENTAGE } }),
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: columns.rate, bold: true })], alignment: AlignmentType.CENTER })], shading: { fill: "F0F0F0" }, width: { size: 10, type: WidthType.PERCENTAGE } }),
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: columns.amount, bold: true })], alignment: AlignmentType.CENTER })], shading: { fill: "F0F0F0" }, width: { size: 15, type: WidthType.PERCENTAGE } })
      ]
    });

  // Render each section table
  tables.forEach((table, i) => {
    // Manual paging: start a new page when this table's page number is higher
    // than the previous table's.
    const thisPage = table.page ?? 1;
    const prevPage = i > 0 ? (tables[i - 1].page ?? 1) : thisPage;
    if (i > 0 && thisPage > prevPage) {
      children.push(new Paragraph({ children: [new PageBreak()] }));
    }

    // Optional left-aligned label above the table (e.g. "Master Bedroom")
    if (table.title && table.title.trim()) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: table.title, bold: true, size: 24 })],
          alignment: AlignmentType.LEFT,
          spacing: { before: 200, after: 60 }
        })
      );
    }

    const tableRows: TableRow[] = [buildHeaderRow()];

    table.rows.forEach((row, index) => {
      const qtyVal = parseFloat(row.cells.quantity) || 0;
      const rateVal = parseFloat(row.cells.rate) || 0;
      const amtVal = parseFloat(row.cells.amount) || 0;

      const isBold = row.cells.bold === "true";
      const fontSize = parseInt(row.cells.fontSize) || 11;
      const align = (row.cells.align as any) || "left";
      const isLS = (row.cells.size || "").trim().toUpperCase() === "LS";

      let wordAlign: any = AlignmentType.LEFT;
      if (align === "center") wordAlign = AlignmentType.CENTER;
      if (align === "right") wordAlign = AlignmentType.RIGHT;

      const srCell = new TableCell({ children: [new Paragraph({ text: row.cells.sr || String(index + 1) })] });
      const particularsCell = new TableCell({
        children: [
          new Paragraph({
            children: [new TextRun({ text: row.cells.particulars || "", bold: isBold, size: fontSize * 2 })],
            alignment: wordAlign
          })
        ]
      });
      const amountCell = new TableCell({ children: [new Paragraph({ text: amtVal > 0 ? formatIndianCurrency(amtVal) : "—", alignment: AlignmentType.CENTER })] });

      const middleCells = isLS
        ? [
            // Merge Size + Quantity + Rate into one centered "LS" cell
            new TableCell({
              columnSpan: 3,
              children: [new Paragraph({ children: [new TextRun({ text: "LS" })], alignment: AlignmentType.CENTER })]
            })
          ]
        : [
            new TableCell({ children: [new Paragraph({ text: row.cells.size || "" })] }),
            new TableCell({ children: [new Paragraph({ text: qtyVal > 0 ? pdfNumber(qtyVal) : "—", alignment: AlignmentType.CENTER })] }),
            new TableCell({ children: [new Paragraph({ text: rateVal > 0 ? pdfNumber(rateVal) : "—", alignment: AlignmentType.CENTER })] })
          ];

      tableRows.push(new TableRow({ children: [srCell, particularsCell, ...middleCells, amountCell] }));
    });

    // In-table Total row: "Total" under Rate column, summed amount under Amount column
    const sub = tableTotalW(table);
    tableRows.push(
      new TableRow({
        children: [
          new TableCell({ children: [new Paragraph({ text: "" })] }),
          new TableCell({ children: [new Paragraph({ text: "" })] }),
          new TableCell({ children: [new Paragraph({ text: "" })] }),
          new TableCell({ children: [new Paragraph({ text: "" })] }),
          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Total", bold: true })], alignment: AlignmentType.CENTER })] }),
          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: `${formatIndianNumber(sub)}/-`, bold: true })], alignment: AlignmentType.CENTER })] })
        ]
      })
    );

    children.push(new Table({ rows: tableRows, width: { size: 100, type: WidthType.PERCENTAGE } }));
  });

  // Grand totals summary (Grand Total / Advance / Balance). Uses explicit column
  // widths so the label (e.g. "Grand Total") and the ₹ value never wrap.
  const SUMMARY_SPACER = 4600;
  const SUMMARY_LABEL = 2300;
  const SUMMARY_VALUE = 2100;
  const summaryRow = (label: string, value: string) =>
    new TableRow({
      children: [
        new TableCell({ children: [new Paragraph({ text: "" })], width: { size: SUMMARY_SPACER, type: WidthType.DXA } }),
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: label, bold: true })], alignment: AlignmentType.RIGHT })], width: { size: SUMMARY_LABEL, type: WidthType.DXA } }),
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: value, bold: true })], alignment: AlignmentType.RIGHT })], width: { size: SUMMARY_VALUE, type: WidthType.DXA } })
      ]
    });

  const summaryRows: TableRow[] = [];
  if (billDetails.showGrandTotal !== false) summaryRows.push(summaryRow(multipleTables ? "Grand Total:" : "Total:", formatIndianCurrency(total)));
  if (billDetails.showAdvance !== false) summaryRows.push(summaryRow("Advance:", formatIndianCurrency(billDetails.advance)));
  if (billDetails.showBalance !== false) summaryRows.push(summaryRow("Balance:", formatIndianCurrency(balance)));
  children.push(
    new Table({
      rows: summaryRows,
      columnWidths: [SUMMARY_SPACER, SUMMARY_LABEL, SUMMARY_VALUE],
      width: { size: SUMMARY_SPACER + SUMMARY_LABEL + SUMMARY_VALUE, type: WidthType.DXA }
    })
  );

  // Note
  if (billDetails.showNote && billDetails.note) {
    children.push(new Paragraph({ children: [new TextRun({ text: "Note.", bold: true, size: 22 })], spacing: { before: 400 } }));
    children.push(new Paragraph({ children: [new TextRun({ text: billDetails.note, size: 22 })] }));
  }

  // Signature
  if (billDetails.showSignature) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: `Proprietor: ${billDetails.proprietorName}`, size: 22 })],
        alignment: AlignmentType.RIGHT,
        spacing: { before: 600 }
      })
    );
    children.push(
      new Paragraph({
        children: [new TextRun({ text: "Authorised Signatory", size: 22 })],
        alignment: AlignmentType.RIGHT,
        spacing: { before: 200 }
      })
    );
  }

  const doc = new Document({ sections: [{ children }] });
  const blob = await Packer.toBlob(doc);
  saveAs(blob, `${filename}.docx`);
}
