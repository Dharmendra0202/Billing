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
  PageBreak,
  TableLayoutType
} from "docx";
import { saveAs } from "file-saver";
import * as XLSX from "xlsx";
import ExcelJS from "exceljs";
import type { BillTable, BillRow, HeaderTemplate, BillDetails, ColumnLabels, BillColumn } from "../types";
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
// Rich text helpers for PDF rendering
// ============================================

type RichSegment = { text: string; bold: boolean };
type RichLine = RichSegment[]; // A single visual line, potentially with mixed bold/normal runs

/**
 * Parse HTML into a flat array of rich segments (single-line, no <br> handling).
 * Kept for backward compatibility with the older table rendering code.
 * For multi-line content use parseRichLines() instead.
 */
function parseRichText(html: string): RichSegment[] {
  const lines = parseRichLines(html);
  // Flatten — join lines with a newline segment (used only by legacy code)
  const flat: RichSegment[] = [];
  lines.forEach((line, i) => {
    if (i > 0) flat.push({ text: "\n", bold: false });
    flat.push(...line);
  });
  return flat.length > 0 ? flat : [{ text: "", bold: false }];
}

/**
 * Parse HTML into an array of visual lines, where each line is a list of
 * bold/normal segments. Uses the browser DOM for robust parsing, so it handles
 * arbitrary tags, nesting, inline font-weight styles, and <br> line breaks
 * consistently.
 */
/**
 * Parse HTML into an array of visual lines, where each line is a list of
 * bold/normal segments. Uses the browser DOM for robust parsing, so it handles
 * arbitrary tags, nesting, inline font-weight styles, and <br> line breaks
 * consistently.
 */
function parseRichLines(html: string, forceBold: boolean = false): RichLine[] {
  if (!html) return [[]];

  if (typeof document === "undefined") return parseRichLinesRegex(html, forceBold);

  const normalized = html.replace(/\r\n|\r|\n/g, "<br/>");
  const container = document.createElement("div");
  container.innerHTML = normalized;

  const lines: RichLine[] = [[]];
  let currentLine = lines[0];

  const walk = (node: Node, bold: boolean): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent || "";
      if (text.length > 0) {
        // In case any raw newlines remain in text
        const parts = text.split(/\r\n|\r|\n/);
        parts.forEach((p, idx) => {
          if (idx > 0) {
            currentLine = [];
            lines.push(currentLine);
          }
          if (p.length > 0) {
            currentLine.push({ text: p, bold: forceBold || bold });
          }
        });
      }
      return;
    }
    if (!(node instanceof HTMLElement)) return;

    const tag = node.tagName.toLowerCase();
    if (tag === "br") {
      currentLine = [];
      lines.push(currentLine);
      return;
    }

    let nextBold = bold;
    if (tag === "b" || tag === "strong") nextBold = true;
    const fw = (node.style?.fontWeight || "").toString().toLowerCase();
    if (fw) {
      const numeric = parseInt(fw, 10);
      if (fw === "bold" || fw === "bolder" || (!isNaN(numeric) && numeric >= 600)) nextBold = true;
      else if (fw === "normal" || fw === "lighter" || (!isNaN(numeric) && numeric < 600)) nextBold = false;
    }

    const isBlock = tag === "div" || tag === "p" || tag === "li" || tag === "tr";
    if (isBlock && currentLine.length > 0) {
      currentLine = [];
      lines.push(currentLine);
    }
    node.childNodes.forEach(child => walk(child, nextBold));
    if (isBlock && currentLine.length > 0) {
      currentLine = [];
      lines.push(currentLine);
    }
  };

  container.childNodes.forEach(child => walk(child, false));
  while (lines.length > 1 && lines[lines.length - 1].length === 0) {
    lines.pop();
  }
  return lines.length > 0 ? lines : [[]];
}

/** Node-only fallback: regex-based parser for tests. */
function parseRichLinesRegex(html: string, forceBold: boolean = false): RichLine[] {
  const lines: RichLine[] = [[]];
  let cur = lines[0];
  const normalized = html.replace(/\r\n|\r|\n/g, "<br/>");
  const parts = normalized.split(/<br\s*\/?>/gi);
  parts.forEach((part, i) => {
    if (i > 0) { cur = []; lines.push(cur); }
    let rem = part;
    while (rem.length > 0) {
      const m = rem.match(/<(b|strong)>([\s\S]*?)<\/\1>/i);
      if (!m || m.index === undefined) {
        const text = rem.replace(/<[^>]*>/g, "");
        if (text) cur.push({ text, bold: forceBold || false });
        break;
      }
      const before = rem.substring(0, m.index).replace(/<[^>]*>/g, "");
      if (before) cur.push({ text: before, bold: forceBold || false });
      const boldText = m[2].replace(/<[^>]*>/g, "");
      if (boldText) cur.push({ text: boldText, bold: true });
      rem = rem.substring(m.index + m[0].length);
    }
  });
  while (lines.length > 1 && lines[lines.length - 1].length === 0) {
    lines.pop();
  }
  return lines.length > 0 ? lines : [[]];
}

/**
 * Convert rich HTML text into an ExcelJS cell value.
 * Preserves bold formatting per word/segment or across the entire cell.
 */
function parseRichTextForExcel(html: string, forceBold: boolean = false): string | { richText: { text: string; font?: { bold?: boolean } }[] } {
  if (!html) return "";
  const lines = parseRichLines(html, forceBold);
  const richText: { text: string; font?: { bold?: boolean } }[] = [];
  lines.forEach((line, idx) => {
    if (idx > 0) {
      richText.push({ text: "\n", font: forceBold ? { bold: true } : undefined });
    }
    line.forEach(seg => {
      if (seg.text) {
        richText.push({ text: seg.text, font: (forceBold || seg.bold) ? { bold: true } : undefined });
      }
    });
  });
  if (richText.length === 0) return "";
  const hasBold = richText.some(r => r.font && r.font.bold);
  if (!hasBold && !forceBold) {
    return richText.map(r => r.text).join("");
  }
  return { richText };
}

/** Strip all HTML tags from a string */
function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, "");
}

/** Get plain text from HTML (converts <br> to newlines, then strips other tags) */
function getPlainText(html: string): string {
  if (!html) return "";
  const withBreaks = html.replace(/<br\s*\/?>/gi, "\n");
  return stripTags(withBreaks);
}

/**
 * Draw a pre-computed run of rich segments on a single visual line at (x, y).
 * Segments are drawn in order; alignment shifts the whole run.
 */
function drawRichSegments(
  doc: any, segments: RichSegment[],
  x: number, y: number, fontSize: number, align: "left" | "center" | "right"
): void {
  if (segments.length === 0) return;
  const safeX = (typeof x === "number" && !isNaN(x)) ? x : 0;
  const safeY = (typeof y === "number" && !isNaN(y)) ? y : 0;

  // Measure total width for center/right alignment
  let totalWidth = 0;
  for (const seg of segments) {
    if (!seg.text) continue;
    doc.setFont("times", seg.bold ? "bold" : "normal");
    doc.setFontSize(fontSize);
    totalWidth += doc.getTextWidth(seg.text);
  }

  let curX = safeX;
  if (align === "right") curX = safeX - totalWidth;
  else if (align === "center") curX = safeX - totalWidth / 2;

  for (const seg of segments) {
    if (!seg.text) continue;
    doc.setFont("times", seg.bold ? "bold" : "normal");
    doc.setFontSize(fontSize);
    doc.text(seg.text, curX, safeY, { align: "left" });
    curX += doc.getTextWidth(seg.text);
  }
}

/**
 * Word-wrap a rich line into visual rows that fit `maxWidth`, keeping bold
 * information attached to each token. Uses jsPDF's splitTextToSize per-segment
 * for measurement but preserves per-token bold state.
 */
function wrapRichLine(doc: any, line: RichLine, maxWidth: number, fontSize: number): RichLine[] {
  if (line.length === 0) return [[]];

  // Tokenize each segment into words + spaces so wrapping works cleanly
  type Token = { text: string; bold: boolean; width: number; isSpace: boolean };
  const tokens: Token[] = [];
  for (const seg of line) {
    if (!seg.text) continue;
    // Split by whitespace but keep it — /(\s+)/ produces alternating text/whitespace
    const parts = seg.text.split(/(\s+)/).filter(p => p.length > 0);
    for (const p of parts) {
      doc.setFont("times", seg.bold ? "bold" : "normal");
      doc.setFontSize(fontSize);
      tokens.push({ text: p, bold: seg.bold, width: doc.getTextWidth(p), isSpace: /^\s+$/.test(p) });
    }
  }

  const rows: RichLine[] = [];
  let curRow: RichSegment[] = [];
  let curWidth = 0;

  const flushRow = () => {
    // Trim trailing spaces
    while (curRow.length > 0 && /^\s+$/.test(curRow[curRow.length - 1].text)) curRow.pop();
    rows.push(curRow);
    curRow = [];
    curWidth = 0;
  };

  for (const tok of tokens) {
    if (curWidth + tok.width <= maxWidth || curRow.length === 0) {
      curRow.push({ text: tok.text, bold: tok.bold });
      curWidth += tok.width;
    } else {
      // Doesn't fit — new row (skip leading space on new row)
      flushRow();
      if (!tok.isSpace) {
        curRow.push({ text: tok.text, bold: tok.bold });
        curWidth += tok.width;
      }
    }
  }
  if (curRow.length > 0) flushRow();
  return rows.length > 0 ? rows : [[]];
}

/**
 * Draw multi-line rich HTML at (x, y). Handles <br> line breaks, bold segments,
 * and word-wrapping. Returns the y-coordinate after the last drawn line.
 */
function drawRichHtml(
  doc: any, html: string,
  x: number, y: number, maxWidth: number, lineHeight: number, fontSize: number,
  align: "left" | "center" | "right" = "left"
): number {
  const lines = parseRichLines(html);
  let curY = y;
  for (const line of lines) {
    const wrapped = wrapRichLine(doc, line, maxWidth, fontSize);
    for (const row of wrapped) {
      drawRichSegments(doc, row, x, curY, fontSize, align);
      curY += lineHeight;
    }
  }
  return curY;
}

/**
 * LEGACY: drawRichLine kept for backwards compatibility with the table
 * rendering code that still uses the old (line, segments, fullPlain) signature.
 * It now delegates to drawRichSegments after building segments for just the line.
 */
function drawRichLine(
  doc: any, line: string, segments: RichSegment[], _fullPlain: string,
  x: number, y: number, fontSize: number, align: "left" | "center" | "right"
): void {
  const safeLine = typeof line === "string" ? line : String(line ?? "");
  const safeX = (typeof x === "number" && !isNaN(x)) ? x : 0;
  const safeY = (typeof y === "number" && !isNaN(y)) ? y : 0;

  const hasBold = segments.some(s => s.bold);
  if (!hasBold) {
    doc.setFont("times", "normal");
    doc.setFontSize(fontSize);
    doc.text(safeLine, safeX, safeY, { align });
    return;
  }

  // Build lineSegments by mapping characters against the concatenated segment text.
  const fullPlain = segments.map(s => s.text).join("");
  const lineStart = fullPlain.indexOf(safeLine);
  if (lineStart === -1) {
    doc.setFont("times", "normal");
    doc.setFontSize(fontSize);
    doc.text(safeLine, safeX, safeY, { align });
    return;
  }

  const charBold: boolean[] = [];
  for (const seg of segments) {
    for (let i = 0; i < seg.text.length; i++) charBold.push(seg.bold);
  }

  const lineSegments: RichSegment[] = [];
  let i = lineStart;
  const lineEnd = lineStart + safeLine.length;
  while (i < lineEnd) {
    const bold = charBold[i] || false;
    let segText = "";
    while (i < lineEnd && (charBold[i] || false) === bold) {
      segText += fullPlain[i];
      i++;
    }
    if (segText) lineSegments.push({ text: segText, bold });
  }

  drawRichSegments(doc, lineSegments, safeX, safeY, fontSize, align);
}

/**
 * Convert rich HTML text to an array of docx TextRun objects for Word export.
 * Flattens the multi-line structure — inserts line-break runs between lines.
 */
/**
 * Convert rich HTML text to an array of docx TextRun objects for Word export.
 * Flattens the multi-line structure — inserts line-break runs between lines.
 */
function richTextToDocxRuns(html: string, size?: number, forceBold: boolean = false): any[] {
  const lines = parseRichLines(html, forceBold);
  const runs: any[] = [];
  lines.forEach((line, i) => {
    if (i > 0) runs.push(new TextRun({ break: 1 }));
    for (const seg of line) {
      runs.push(new TextRun({
        text: seg.text || "",
        bold: forceBold || seg.bold,
        ...(size ? { size } : {})
      }));
    }
  });
  // docx throws on a Paragraph with an empty children array — guarantee one run.
  return runs.length > 0 ? runs : [new TextRun({ text: "", bold: forceBold, ...(size ? { size } : {}) })];
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

/**
 * Compute the standard-format column widths (in mm) exactly the way the PDF
 * does, so that Word and Excel can reuse the SAME proportions. `measure` must
 * return the rendered width (mm) of a string for a given weight/font-size —
 * the PDF passes a jsPDF-backed measurer; Word/Excel pass a throwaway jsPDF.
 *
 * Returns final widths AFTER hidden columns collapse to 0 (their space is
 * redistributed to Particulars), matching the PDF's on-page layout.
 */
type StdColWidths = { sr: number; particulars: number; size: number; quantity: number; rate: number; amount: number };
function computeStandardColWidthsMM(
  measure: (text: string, style: "normal" | "bold", fs: number) => number,
  tables: BillTable[],
  columns: ColumnLabels,
  vis: { size?: boolean; quantity?: boolean; rate?: boolean; amount?: boolean },
  contentWidth: number
): StdColWidths {
  const showSizeCol = vis.size !== false;
  const showQtyCol = vis.quantity !== false;
  const showRateCol = vis.rate !== false;
  const showAmtCol = vis.amount !== false;

  const measureMax = (texts: string[], style: "normal" | "bold", fs: number): number =>
    texts.reduce((w, t) => Math.max(w, measure(t || "", style, fs)), 0);
  const allRows = tables.flatMap(t => t.rows);
  const HEADER_CAP = 34;
  const headerW = (label: string) => Math.min(measureMax([label], "bold", 11), HEADER_CAP);
  const dataMax = (texts: string[]) => measureMax(texts, "normal", 11);

  const srData = allRows.map((r, i) => String(r.cells.sr || i + 1));
  const qtyData = allRows.map(r => { const q = parseFloat(r.cells.quantity) || 0; return q > 0 ? pdfNumber(q) : "\u2014"; });
  const rateData = allRows.map(r => { const v = parseFloat(r.cells.rate) || 0; return v > 0 ? pdfNumber(v) : "\u2014"; });
  const tableSubtotals = tables.map(t => t.rows.reduce((s, r) => s + (parseFloat(r.cells.amount) || 0), 0));
  const amtData = [
    ...allRows.map(r => { const v = parseFloat(r.cells.amount) || 0; return v > 0 ? pdfCurrency(v) : "\u2014"; }),
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
  const SIZE_PLUS_PARTICULARS_MIN = 56;
  const maxNumericTotal = contentWidth - SIZE_PLUS_PARTICULARS_MIN;
  const numericTotal = srW + qtyW + rateW + amtW;
  if (numericTotal > maxNumericTotal) {
    const f = maxNumericTotal / numericTotal;
    srW *= f; qtyW *= f; rateW *= f; amtW *= f;
  }
  const remaining = contentWidth - (srW + qtyW + rateW + amtW);
  const PARTICULARS_MIN = 38;
  const sizePreferred = Math.max(headerW(columns.size), dataMax(sizeData)) + PAD;
  let sizeW = Math.min(sizePreferred, remaining - PARTICULARS_MIN);
  sizeW = Math.max(sizeW, 18);
  sizeW = Math.min(sizeW, Math.max(remaining - 12, 18));
  let particularsW = Math.max(remaining - sizeW, 12);
  if (!showSizeCol) { particularsW += sizeW; sizeW = 0; }
  if (!showQtyCol) { particularsW += qtyW; qtyW = 0; }
  if (!showRateCol) { particularsW += rateW; rateW = 0; }
  if (!showAmtCol) { particularsW += amtW; amtW = 0; }

  return { sr: srW, particulars: particularsW, size: sizeW, quantity: qtyW, rate: rateW, amount: amtW };
}

/**
 * Let a header wrap after "/" (e.g. "Laminate/Rate" → "Laminate/" + "Rate")
 * instead of being cut mid-word. jsPDF's splitTextToSize only breaks on spaces,
 * so we add a space after "/" for wrapping and remove it again from each line.
 */
function headerWrapFriendly(label: string): string {
  return (label || "").replace(/\/(?=\S)/g, "/ ");
}
function headerLines(doc: jsPDF, label: string, width: number): string[] {
  if (label.includes("\n")) return label.split("\n");
  // Fits as-is → keep it on one line (the helper space would make it measure wider).
  if (doc.getTextWidth(label) <= width) return [label];
  const lines: string[] = doc.splitTextToSize(headerWrapFriendly(label), width);
  return lines.map(l => l.replace(/\/ /g, "/"));
}

/**
 * Column widths (mm) for the Labour + Material format, auto-fitted to content:
 * [Sr, Particulars, Size, Qty, LabourRate, LabourAmt, MaterialRate, MaterialAmt].
 *
 *   hard = minimum that never cuts a value or a header word (header 9.5pt bold),
 *   pref = wide enough to show the whole header on one line.
 * Each column gets `hard`; Particulars gets a healthy share; leftover widens
 * headers toward one line; the rest goes to Particulars. Columns only shrink
 * below `hard` as a last resort.
 */
function computeLabourColWidthsMM(
  measure: (text: string, style: "normal" | "bold", fs: number) => number,
  tables: BillTable[],
  columns: ColumnLabels,
  contentWidth: number
): number[] {
  const allRows = tables.flatMap(t => t.rows);
  const headerFull = (label: string) => measure((label || "").replace(/\n/g, " "), "bold", 9.5);
  const headerWord = (label: string) =>
    headerWrapFriendly(label || "").split(/\s+/).reduce((w, word) => Math.max(w, measure(word, "bold", 9.5)), 0);
  const widest = (fmt: (r: BillRow) => string) => allRows.reduce((w, r) => Math.max(w, measure(fmt(r), "normal", 11)), 0);
  const num = (v: string) => { const n = parseFloat(v) || 0; return n > 0 ? pdfNumber(n) : "\u2014"; };

  const sizeVal = (r: BillRow) => {
    const s = (r.cells.size || "").trim();
    if (s.toUpperCase() === "LS") return "";
    const t = tables.find(tb => tb.rows.includes(r));
    const applyInch = (r.cells.mode || t?.mode || "template") !== "manual";
    return applyInch && s ? convertAllPointValues(s) : s;
  };
  // The Total row is drawn at 10pt bold — measure it exactly that way.
  const lSub = Math.max(0, ...tables.map(t => measure(pdfCurrency(t.rows.reduce((s, r) => s + (parseFloat(r.cells.labourAmount) || 0), 0)), "bold", 10)));
  const mSub = Math.max(0, ...tables.map(t => measure(pdfCurrency(t.rows.reduce((s, r) => s + (parseFloat(r.cells.materialAmount) || 0), 0)), "bold", 10)));

  const specs: { label: string; value: number }[] = [
    { label: columns.sr, value: widest(r => String(r.cells.sr || "")) },
    { label: columns.size, value: widest(sizeVal) },
    { label: columns.quantity, value: widest(r => num(r.cells.quantity)) },
    { label: columns.labourCharges ?? "Only Labour Charges", value: widest(r => num(r.cells.labourRate)) },
    { label: columns.labourAmount ?? "Amount", value: Math.max(widest(r => num(r.cells.labourAmount)), lSub) },
    { label: columns.materialCharges ?? "Materials with Labour Charges", value: widest(r => num(r.cells.materialRate)) },
    { label: columns.materialAmount ?? "Amount", value: Math.max(widest(r => num(r.cells.materialAmount)), mSub) },
  ];
  // Cells wrap at (width - 3mm) and headers at (width - 2mm), so give values and
  // headers a bit more than that so they stay on one line.
  const VAL_PAD = 3.6;
  const HDR_PAD = 2.6;
  const PREF_CAP = 30;
  const hard = specs.map(sp => Math.max(sp.value + VAL_PAD, headerWord(sp.label) + HDR_PAD));
  const pref = specs.map((sp, i) => Math.max(hard[i], Math.min(headerFull(sp.label) + HDR_PAD, PREF_CAP)));

  // Priority (matches the original layout): one-line headers come before extra
  // Particulars width; Particulars keeps at least PART_TARGET and gets the rest.
  const PART_MIN = 28;
  const PART_TARGET = 30;
  const hardSum = hard.reduce((a, b) => a + b, 0);
  let fixed: number[];
  let part: number;
  if (contentWidth - hardSum >= PART_MIN) {
    const avail = contentWidth - hardSum;
    part = Math.min(avail, PART_TARGET);
    let slack = avail - part;
    const extra = pref.map((p, i) => p - hard[i]);
    const extraSum = extra.reduce((a, b) => a + b, 0);
    const give = Math.min(slack, extraSum);
    fixed = hard.map((h, i) => h + (extraSum > 0 ? extra[i] * (give / extraSum) : 0));
    slack -= give;
    part += slack;
  } else {
    const f = (contentWidth - PART_MIN) / hardSum;
    fixed = hard.map(h => h * f);
    part = PART_MIN;
  }
  return [fixed[0], part, fixed[1], fixed[2], fixed[3], fixed[4], fixed[5], fixed[6]];
}

/** A throwaway jsPDF measurer for Word/Excel, matching the PDF's text metrics. */
function makeTimesMeasurer(): (text: string, style: "normal" | "bold", fs: number) => number {
  const mdoc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  registerRupeeFont(mdoc);
  return (text: string, style: "normal" | "bold", fs: number) => {
    mdoc.setFont("times", style);
    mdoc.setFontSize(fs);
    return mdoc.getTextWidth(text || "");
  };
}

/**
 * Compute column widths (mm) for a CUSTOM-format table, measuring actual
 * content so every column is as wide as its widest cell.
 *
 * `measure(text, style, fontSize)` must return the rendered width in mm —
 * pass a jsPDF-backed measurer for the PDF, or makeTimesMeasurer() for
 * Word/Excel so their columns match the PDF.
 *
 * `tableMode` is the table's inch-conversion mode (template/manual).
 * `contentWidth` is the available page width in mm (A4 = 170mm).
 */
function computeCustomColWidthsMM(
  measure: (text: string, style: "normal" | "bold", fs: number) => number,
  customCols: BillColumn[],
  allRows: Array<Record<string, string>>,    // all rows' cells across every table
  tableModes: Array<"template" | "manual">,  // one mode per table; rows are interleaved
  contentWidth: number
): number[] {
  const PAD = 6;
  const NON_PART_MIN = 14;
  const NON_PART_CAP = 55;
  const PART_MIN = 40;

  // Format a cell value exactly as it will be drawn (number formatting, size conversion).
  const displayVal = (c: BillColumn, raw: string, mode: "template" | "manual"): string => {
    let v = (raw ?? "").trim();
    if (c.kind === "number" && v === "0") return "";
    if (!v) return "";
    const isPureNum = /^-?\d+(\.\d+)?$/.test(v);
    if ((c.label.toLowerCase().includes("size") || c.id === "size") && mode !== "manual") {
      return convertAllPointValues(v);
    }
    if (c.kind === "number" && isPureNum) {
      const num = parseFloat(v);
      return c.label.toLowerCase().includes("amount") ? pdfCurrency(num) : pdfNumber(num);
    }
    return v;
  };

  // The column whose total is drawn in the Total row ("₹ x/-" must fit too).
  const numNonSr = customCols.filter(c => c.kind === "number" && c.id !== "sr" && !c.label.toLowerCase().includes("sr"));
  const totalCol = customCols.find(c => c.id === "amount" || c.label.toLowerCase().includes("amount"))
    ?? numNonSr[numNonSr.length - 1];

  const measureCol = (c: BillColumn): number => {
    // Header (bold)
    let w = measure(c.label || "", "bold", 11);
    if (totalCol && c.id === totalCol.id) {
      const sum = allRows.reduce((s, cells) => s + (parseFloat(cells[c.id]) || 0), 0);
      w = Math.max(w, measure(pdfCurrency(sum), "bold", 10));
    }
    // Every cell value
    allRows.forEach((cells, ri) => {
      const mode = tableModes[ri] ?? "template";
      const txt = displayVal(c, cells[c.id] ?? "", mode);
      if (txt) w = Math.max(w, measure(txt, "normal", 11));
    });
    return w;
  };

  const computedWidths = customCols.map(c => {
    const isPart = c.id.toLowerCase().includes("particular") || c.label.toLowerCase().includes("particular");
    if (isPart) return -1; // filled from leftover
    const measured = measureCol(c) + PAD;
    return Math.min(Math.max(measured, NON_PART_MIN), NON_PART_CAP);
  });

  const definedSum = computedWidths.reduce((s, w) => s + (w > 0 ? w : 0), 0);
  const partIdx = computedWidths.findIndex(w => w === -1);
  let remaining = contentWidth - definedSum;

  if (partIdx !== -1) {
    if (remaining < PART_MIN) {
      const shrinkTarget = contentWidth - PART_MIN;
      const scaleF = definedSum > 0 ? Math.max(0.4, shrinkTarget / definedSum) : 1;
      for (let i = 0; i < computedWidths.length; i++) {
        if (computedWidths[i] > 0)
          computedWidths[i] = Math.max(NON_PART_MIN * 0.7, computedWidths[i] * scaleF);
      }
      remaining = contentWidth - computedWidths.reduce((s, w) => s + (w > 0 ? w : 0), 0);
    }
    computedWidths[partIdx] = Math.max(PART_MIN, remaining);
  } else {
    // No Particulars: give leftover to the last text column.
    const lastTextIdx = customCols.reduce((acc, c, idx) => c.kind === "text" ? idx : acc, customCols.length - 1);
    if (remaining > 0) computedWidths[lastTextIdx] += remaining;
  }

  return computedWidths;
}

/** Build the flat (row, mode) arrays needed by computeCustomColWidthsMM from a list of BillTables. */
function customRowsAndModes(tables: BillTable[]): { allCells: Array<Record<string, string>>; modes: Array<"template" | "manual"> } {
  const allCells: Array<Record<string, string>> = [];
  const modes: Array<"template" | "manual"> = [];
  for (const t of tables) {
    const mode = (t.mode ?? "template") === "manual" ? "manual" : "template";
    for (const r of t.rows) { allCells.push(r.cells); modes.push(mode); }
  }
  return { allCells, modes };
}

export async function exportProfessionalPDF(
  header: HeaderTemplate,
  tables: BillTable[],
  billDetails: BillDetails,
  filename: string = "bill",
  options?: { fitToOnePage?: boolean; embed?: string; format?: "standard" | "labourMaterial" | "custom"; columnVisibility?: { size?: boolean; quantity?: boolean; rate?: boolean; amount?: boolean } },
  columns: ColumnLabels = defaultColumnLabels
): Promise<void> {
  // Explicit A4 portrait (210 x 297 mm) so the page size never depends on defaults.
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  registerRupeeFont(doc);
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 20;
  let yPos = 10;

  // Calculate grand total across all tables
  const isLabourFormat = options?.format === "labourMaterial";
  const isCustomFormat = options?.format === "custom";

  // Standard-format column visibility (Sr + Particulars always shown).
  const cv = options?.columnVisibility ?? {};
  const showSizeCol = cv.size !== false;
  const showQtyCol = cv.quantity !== false;
  const showRateCol = cv.rate !== false;
  const showAmtCol = cv.amount !== false;

  const findCustomAmountCol = (cols: BillColumn[]) => {
    const byIdOrLabel = cols.find(c => c.id === "amount" || c.label.toLowerCase().includes("amount"));
    if (byIdOrLabel) return byIdOrLabel;
    const numCols = cols.filter(c => c.kind === "number" && c.id !== "sr" && !c.label.toLowerCase().includes("sr"));
    return numCols.length > 0 ? numCols[numCols.length - 1] : undefined;
  };

  const tableTotal = (t: BillTable) => {
    if (isCustomFormat) {
      const amtCol = findCustomAmountCol(t.columns);
      if (!amtCol) return 0;
      return t.rows.reduce((sum, row) => sum + (parseFloat(row.cells[amtCol.id]) || 0), 0);
    }
    if (isLabourFormat) return t.rows.reduce((sum, row) => sum + (parseFloat(row.cells.materialAmount) || 0), 0);
    return t.rows.reduce((sum, row) => sum + (parseFloat(row.cells.amount) || 0), 0);
  };
  const tableLabourTotal = (t: BillTable) => t.rows.reduce((sum, row) => sum + (parseFloat(row.cells.labourAmount) || 0), 0);
  const total = tables.reduce((sum, t) => sum + tableTotal(t), 0);
  const balance = total - billDetails.advance;

  if (billDetails.showHeader !== false) {
    // Single line above name (drawn wider)
    doc.setDrawColor(0);
    doc.setLineWidth(0.3);
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
    doc.setLineWidth(0.3);
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
    doc.setFontSize(11);
    doc.setFont("times", "normal");
    doc.text("To,", margin, yPos);
    yPos += 3.8;
    // Client name — robust rich-text rendering (honours inline bold).
    yPos = drawRichHtml(doc, billDetails.clientName || "________________", margin, yPos, pageWidth - 2 * margin - 40, 3.8, 11, "left");
    if (billDetails.showClientAddress !== false) {
      yPos = drawRichHtml(doc, billDetails.clientAddress || "________________", margin, yPos, pageWidth - 2 * margin - 40, 3.8, 11, "left");
    } else {
      yPos += 3.8;
    }
    yPos += 12;
  }

  // Subject - Centered (only when a subject is provided)
  if (billDetails.subject && billDetails.subject.trim()) {
    doc.setFontSize(11);
    // Draw "Sub: " label + the (possibly bold) subject text, centered.
    const subjectHtml = `Sub: ${billDetails.subject}`;
    yPos = drawRichHtml(doc, subjectHtml, pageWidth / 2, yPos, pageWidth - 40, 4, 11, "center");
    yPos += 8;
  }

  // ── Dynamic column widths (shared by every section table) ─────────────────
  // Measure the content so nothing is truncated. Sr/Quantity/Rate/Amount are
  // sized to the widest value (or their header); Size is sized to fit its
  // longest entry; Particulars takes whatever width remains. Size + Particulars
  // also wrap to multiple lines as a final safety net so text is never cut.
  const contentWidth = pageWidth - 2 * margin;
  // Shared width computation (also used by Word & Excel so all three match).
  // For custom/labour we don't collapse the standard columns, so pass all-visible.
  const stdVis = (!isCustomFormat && !isLabourFormat)
    ? { size: showSizeCol, quantity: showQtyCol, rate: showRateCol, amount: showAmtCol }
    : { size: true, quantity: true, rate: true, amount: true };
  const measurePdf = (text: string, style: "normal" | "bold", fs: number) => {
    doc.setFont("times", style);
    doc.setFontSize(fs);
    return doc.getTextWidth(text || "");
  };
  // Column layout. Widths are computed for text at scale `s` (shrink/grow-to-fit):
  // we lay the table out for a virtual width of contentWidth / s at normal 11pt,
  // then multiply every width by s. So when fonts grow, numeric columns grow with
  // them and Particulars absorbs the difference — text can never overflow.
  let colWidths: number[] = [];
  let colX: number[] = [];
  let verticalX: number[] = [];
  let layoutScale = 1;
  let flexColIdx = 1; // column that absorbs leftover width (Particulars)
  let srCenterX = 0, sizeCenterX = 0, qtyCenterX = 0, rateCenterX = 0, amtCenterX = 0;
  // For Labour + Material format we override colWidths/verticalX with 8 columns:
  // Sr | Particulars | Size | Quantity | Only Labour | Amount | Materials w/ Labour | Amount
  let labourCenterX = 0, labourAmtCenterX = 0, materialCenterX = 0, materialAmtCenterX = 0;

  const layoutColumns = (scaleIn: number, _rawLayout: boolean = false): void => {
  // Columns are sized for the text size actually printed (scale s): number
  // columns get exactly what their values/headers need at that size, and
  // Particulars receives everything left over. Smaller text → wider Particulars.
  const s = scaleIn;
  layoutScale = s;
  const layoutW = contentWidth / s;
  const cw = computeStandardColWidthsMM(measurePdf, tables, columns, stdVis, layoutW);
  colWidths = [cw.sr, cw.particulars, cw.size, cw.quantity, cw.rate, cw.amount];
  flexColIdx = 1;
  if (isCustomFormat) {
    const customCols = (tables[0]?.columns && tables[0].columns.length > 0)
      ? tables[0].columns
      : [
          { id: "sr", label: columns.sr, kind: "number" as const },
          { id: "particulars", label: columns.particulars, kind: "text" as const },
          { id: "amount", label: columns.amount, kind: "number" as const }
        ];

    const { allCells, modes } = customRowsAndModes(tables);
    colWidths = computeCustomColWidthsMM(measurePdf, customCols, allCells, modes, layoutW);
    const pIdx = customCols.findIndex(c => c.id.toLowerCase().includes("particular") || c.label.toLowerCase().includes("particular"));
    flexColIdx = pIdx !== -1 ? pIdx : customCols.reduce((acc, c, idx) => c.kind === "text" ? idx : acc, customCols.length - 1);
  } else if (isLabourFormat) {
    colWidths = computeLabourColWidthsMM(measurePdf, tables, columns, layoutW);
  }

  // Scale the virtual layout back up to real page width. Snap the flex column so
  // the table spans exactly contentWidth (no rounding gap at the right edge).
  colWidths = colWidths.map(w => w * s);
  const otherSum = colWidths.reduce((acc, w, i) => acc + (i === flexColIdx ? 0 : w), 0);
  colWidths[flexColIdx] = Math.max(contentWidth - otherSum, 10);

  colX = [];
  verticalX = [];
  let cumX = margin;
  for (let i = 0; i < colWidths.length; i++) {
    colX.push(cumX + 2);
    verticalX.push(cumX);
    cumX += colWidths[i];
  }
  verticalX.push(pageWidth - margin);

  srCenterX = margin + colWidths[0] / 2;
  sizeCenterX = margin + colWidths[0] + colWidths[1] + (colWidths[2] ?? 0) / 2;
  qtyCenterX = margin + colWidths[0] + colWidths[1] + (colWidths[2] ?? 0) + (colWidths[3] ?? 0) / 2;
  if (isLabourFormat) {
    const base = margin + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3];
    labourCenterX = base + colWidths[4] / 2;
    labourAmtCenterX = base + colWidths[4] + colWidths[5] / 2;
    materialCenterX = base + colWidths[4] + colWidths[5] + colWidths[6] / 2;
    materialAmtCenterX = base + colWidths[4] + colWidths[5] + colWidths[6] + colWidths[7] / 2;
  }
  rateCenterX = isLabourFormat || isCustomFormat ? 0 : margin + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + colWidths[4] / 2;
  amtCenterX = isLabourFormat || isCustomFormat ? 0 : margin + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + colWidths[4] + colWidths[5] / 2;
  };
  layoutColumns(1);

  const headerHeight = 6.5;
  const minRowHeight = 6;
  const pageBottom = 285;
  const multipleTables = tables.length > 1;

  // Draws a shaded, bordered column-header row starting at the current yPos.
  // Returns the y-coordinate at the top of the header (for vertical line drawing).
  const drawTableHeader = (scale: number = 1, forTable?: BillTable): number => {
    const headerFontSize = (isLabourFormat ? 9.5 : 11) * scale;
    doc.setFont("times", "bold");
    doc.setFontSize(headerFontSize);

    // Build the label list and centres depending on the format.
    // For custom format, use THIS table's columns (not tables[0]) so multiple
    // custom tables with different column schemas each draw their own header.
    const hdrTable = forTable ?? tables[0];
    const customCols = isCustomFormat && hdrTable?.columns?.length ? hdrTable.columns : null;
    const labels = customCols
      ? customCols.map(c => c.label)
      : isLabourFormat
      ? [columns.sr, columns.particulars, columns.size, columns.quantity, columns.labourCharges ?? "Only Labour Charges", columns.labourAmount ?? "Amount", columns.materialCharges ?? "Materials with Labour Charges", columns.materialAmount ?? "Amount"]
      : [columns.sr, columns.particulars, columns.size, columns.quantity, columns.rate, columns.amount];

    // Blank out hidden standard columns so their header label isn't drawn.
    const visLabels = (!isCustomFormat && !isLabourFormat)
      ? [labels[0], labels[1], showSizeCol ? labels[2] : "", showQtyCol ? labels[3] : "", showRateCol ? labels[4] : "", showAmtCol ? labels[5] : ""]
      : labels;
    const labelLines = colWidths.map((w, i) => {
      const text = visLabels[i] || "";
      if (!text) return [""];
      return headerLines(doc, text, Math.max(w - 2 * scale, 6 * scale));
    });
    const maxLines = Math.max(1, ...labelLines.map(l => l.length));
    const hLineSpacing = headerFontSize * 0.42;
    const hH = Math.max(headerHeight * scale, (maxLines - 1) * hLineSpacing + headerFontSize * 0.25 + 3.2 * scale);

    const yTopHeader = yPos - 4 * scale;
    doc.setFillColor(245, 245, 245);
    doc.rect(margin, yTopHeader, pageWidth - 2 * margin, hH, "F");

    // Compute centres per column (Particulars = left-aligned, rest = center).
    let cx = margin;
    const centers = colWidths.map((w) => { const c = cx + w / 2; cx += w; return c; });
    if (!isCustomFormat) {
      centers[1] = margin + colWidths[0] + 2; // Particulars left-aligned
    }

    labelLines.forEach((lines, i) => {
      const n = lines.length;
      const yBase = yTopHeader + hH / 2 - ((n - 1) * hLineSpacing) / 2 + (11 * scale * 0.25) / 2;
      const isPartCol = isCustomFormat && customCols ? customCols[i]?.label.toLowerCase().includes("particular") || i === 1 : i === 1;
      const alignOption = isPartCol ? "left" : "center";
      const posX = isPartCol ? (colX[i] || (margin + 2)) : centers[i];
      doc.text(lines, posX, yBase, { align: alignOption });
    });

    doc.setDrawColor(0);
    doc.setLineWidth(0.2);
    doc.line(margin, yTopHeader, pageWidth - margin, yTopHeader);
    doc.line(margin, yTopHeader + hH, pageWidth - margin, yTopHeader + hH);
    verticalX.forEach(x => doc.line(x, yTopHeader, x, yTopHeader + hH));

    yPos = yTopHeader + hH;
    return yTopHeader;
  };

  // Draw vertical grid lines for a single row segment. For "LS" (lump-sum) rows
  // the Size/Quantity/Rate separators are omitted so those three columns read
  // as one merged cell.
  const drawRowVerticals = (top: number, bottom: number, merged: boolean) => {
    if (merged) {
      // For LS rows, draw only the outer borders and the merge boundaries.
      // Standard: keep 0,1,2 (Sr, Part) then skip Size/Qty/Rate, draw 5,6 (Amt).
      // Labour: keep 0,1,2 then skip Size/Qty/Labour/LabourAmt/Mat, draw last 2 (MatAmt).
      const lastTwo = [verticalX.length - 2, verticalX.length - 1];
      const idxs = [0, 1, 2, ...lastTwo];
      idxs.forEach(i => doc.line(verticalX[i], top, verticalX[i], bottom));
    } else {
      verticalX.forEach(x => doc.line(x, top, x, bottom));
    }
  };

  // Render one section table. Returns its subtotal.
  // Behaviour: never split a table across pages. If a table overflows the page by
  // only a few rows, its rows are shrunk slightly so the whole table fits on one
  // page. If it overflows by more, the whole table moves to the next page (or, if
  // it is genuinely taller than a full page, it flows and splits between rows).
  const drawSectionTable = (table: BillTable, reserveBelow: number = 0, scale: number = 1): number => {
    const fitMode = scale !== 1;

    // Custom format: tables normally share one layout (measured across ALL tables,
    // so every table lines up). Only when a table has a DIFFERENT column schema
    // than the first table do we lay it out separately.
    if (isCustomFormat && table.columns?.length) {
      const baseIds = (tables[0]?.columns ?? []).map(c => c.id).join("|");
      const thisIds = table.columns.map(c => c.id).join("|");
      if (thisIds !== baseIds) {
        const tableMode = (table.mode ?? "template") === "manual" ? "manual" : "template";
        const ls = scale; // same rule as layoutColumns
        const vW = contentWidth / ls;
        const widths = computeCustomColWidthsMM(measurePdf, table.columns, table.rows.map(r => r.cells), table.rows.map(() => tableMode), vW).map(w => w * ls);
        const pIdx = table.columns.findIndex(c => c.id.toLowerCase().includes("particular") || c.label.toLowerCase().includes("particular"));
        const fIdx = pIdx !== -1 ? pIdx : widths.length - 1;
        const others = widths.reduce((a, w, i) => a + (i === fIdx ? 0 : w), 0);
        widths[fIdx] = Math.max(contentWidth - others, 10);
        colWidths = widths;
        colX = []; verticalX = [];
        let cx = margin;
        for (let i = 0; i < colWidths.length; i++) { colX.push(cx + 2); verticalX.push(cx); cx += colWidths[i]; }
        verticalX.push(pageWidth - margin);
      } else {
        layoutColumns(scale);
      }
    } else {
      layoutColumns(scale);
    }

    // Pre-measure each data row's natural height (accounts for multi-line text).
    // Fonts and heights are multiplied by `scale` (1 = normal size).
    // Normal cell font geometry (Sr / Size / Quantity / Rate / Amount).
    const nfs = 11 * scale;
    const nLineSpacing = nfs * 0.405;
    const nCapHeight = nfs * 0.25;
    const heightOf = (n: number, lineSpacing: number, capHeight: number) => (n > 0 ? (n - 1) * lineSpacing + capHeight : 0);

    const measured = table.rows.map((row, index) => {
      const fontSize = (parseInt(row.cells.fontSize) || 11) * scale;
      const isBold = (row as any).bold === true || row.cells.bold === "true";
      const align = (row.cells.align as any) || "left";

      // Particulars (per-row font size / weight, wraps within its column).
      const partColW = (typeof colWidths[1] === "number" && colWidths[1] > 0) ? colWidths[1] : 40;
      const richLines = parseRichLines(row.cells.particulars || "", isBold);
      const wrappedVisualRows: RichLine[] = [];
      for (const rl of richLines) {
        wrappedVisualRows.push(...wrapRichLine(doc, rl, partColW - 4 * scale, fontSize));
      }
      const richSegments = parseRichText(row.cells.particulars || "");
      const plainParticulars = getPlainText(row.cells.particulars || "");
      const lines = wrappedVisualRows.map(r => r.map(s => s.text).join(""));
      const lineSpacing = fontSize * 0.405;
      const capHeight = fontSize * 0.25;
      const textHeight = heightOf(wrappedVisualRows.length, lineSpacing, capHeight);

      // Every other cell wraps too, so no value is ever clipped. Measured at 11pt.
      doc.setFont("times", "normal");
      doc.setFontSize(nfs);
      const sizeRaw = row.cells.size || "";
      const isLSRow = sizeRaw.trim().toUpperCase() === "LS";
      // Apply inch conversion: per-row mode overrides the table's mode.
      const rowMode = row.cells.mode || (table.mode ?? "template");
      const applyInch = rowMode !== "manual";
      const sizeStr = (!isLSRow && applyInch && sizeRaw) ? convertAllPointValues(sizeRaw) : sizeRaw;
      const quantity = parseFloat(row.cells.quantity) || 0;
      const rate = parseFloat(row.cells.rate) || 0;
      const amount = parseFloat(row.cells.amount) || 0;

      // Safe column width lookup — custom tables may have fewer than 6 columns,
      // so guard against undefined widths that would otherwise produce NaN and
      // break splitTextToSize / doc.text ("Invalid arguments passed to jsPDF.text").
      const cw = (i: number, fallback: number) => {
        const w = colWidths[i];
        return (typeof w === "number" && !isNaN(w) && w > 0) ? w : fallback;
      };
      const srLines = doc.splitTextToSize(String(row.cells.sr || index + 1), cw(0, 12) - 2 * scale);
      const sizeLines = sizeStr && !isLSRow ? doc.splitTextToSize(sizeStr, cw(2, 20) - 3 * scale) : [];
      const qtyLines = !isLSRow ? doc.splitTextToSize(quantity > 0 ? pdfNumber(quantity) : "\u2014", cw(3, 16) - 3 * scale) : [];
      const rateLines = !isLSRow ? doc.splitTextToSize(rate > 0 ? pdfNumber(rate) : "\u2014", cw(4, 16) - 3 * scale) : [];
      const amtLines = doc.splitTextToSize(amount > 0 ? pdfCurrency(amount) : "\u2014", cw(5, 22) - 3 * scale);

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

      // Sub-rows (merged sizes)
      let subRowsData: { particulars: string[]; size: string[]; height: number }[] = [];
      let totalGroupHeight = naturalHeight;
      try {
        const subs = JSON.parse(row.cells.subRows || "[]") as { id: string; particulars: string; size: string }[];
        if (subs.length > 0) {
          doc.setFont("times", "normal");
          doc.setFontSize(nfs);
          subRowsData = subs.map(sub => {
            const subPartLines = doc.splitTextToSize(sub.particulars || "", partColW - 4 * scale);
            const subSizeRaw = sub.size || "";
            const subSizeStr = (!isLSRow && applyInch && subSizeRaw) ? convertAllPointValues(subSizeRaw) : subSizeRaw;
            const subSizeLines = subSizeStr ? doc.splitTextToSize(subSizeStr, ((typeof colWidths[2] === "number" && colWidths[2] > 0) ? colWidths[2] : 20) - 3 * scale) : [];
            const subH = Math.max(
              heightOf(subPartLines.length, nLineSpacing, nCapHeight),
              heightOf(subSizeLines.length, nLineSpacing, nCapHeight)
            );
            const subRowHeight = Math.max(subH + 2.5 * scale, minRowHeight * scale);
            return { particulars: subPartLines, size: subSizeLines, height: subRowHeight };
          });
          totalGroupHeight = naturalHeight + subRowsData.reduce((s, sr) => s + sr.height, 0);
        }
      } catch {}

      return {
        row, fontSize, isBold, align, isLS: isLSRow, richSegments, plainParticulars,
        lines, lineSpacing, capHeight, textHeight, maxTextHeight, naturalHeight,
        wrappedVisualRows,
        srLines, sizeLines, qtyLines, rateLines, amtLines,
        subRowsData, totalGroupHeight
      };
    });

    const labelHeight = ((table.title && table.title.trim()) ? 7 : 0) * scale;
    const totalRowHeight = minRowHeight * scale;
    const headerH = headerHeight * scale;
    const fixedHeight = labelHeight + headerH + totalRowHeight;
    const rowsNaturalHeight = measured.reduce((h, m) => h + m.naturalHeight, 0);
    const naturalTableHeight = fixedHeight + rowsNaturalHeight;

    let rowHeights = measured.map(m => m.totalGroupHeight);
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

    drawTableHeader(scale, table);
    let subtotal = 0;

    measured.forEach((m, index) => {
      const isLS = m.isLS;
      const align = m.align;
      const rowHeight = rowHeights[index];

      // Page break only when the table is flowing (a compressed table always fits).
      if (!compressed && yPos + rowHeight > pageBottom) {
        doc.addPage();
        yPos = 20;
        drawTableHeader(scale, table);
      }

      const yTop = yPos;
      const mainH = m.naturalHeight;
      const hasSubRows = m.subRowsData.length > 0;
      // For Sr/Particulars/Size: center within just the main row's height.
      // For Qty/Rate/Amt: center within the full group height (merged look).
      const baselineFor = (n: number, lineSpacing: number, capHeight: number) =>
        yTop + mainH / 2 - ((Math.max(n, 1) - 1) * lineSpacing) / 2 + capHeight / 2;
      const baselineForGroup = (n: number, lineSpacing: number, capHeight: number) =>
        yTop + rowHeight / 2 - ((Math.max(n, 1) - 1) * lineSpacing) / 2 + capHeight / 2;

      if (isCustomFormat && table.columns && table.columns.length > 0) {
        const customBold = m.isBold;
        doc.setFontSize(nfs);
        table.columns.forEach((c, ci) => {
          let rawVal = m.row.cells[c.id] ?? "";
          const isPartCol = c.label.toLowerCase().includes("particular") || ci === 1;
          // A bare "0" in a number column means "not filled" — show it blank.
          if (c.kind === "number" && rawVal.trim() === "0") rawVal = "";
          let valStr = rawVal;
          // Only format as a number when the WHOLE value is a clean number.
          // Values like "15000/NOS" are shown exactly as typed. Empty cells stay blank.
          const isPureNumber = rawVal.trim() !== "" && /^-?\d+(\.\d+)?$/.test(rawVal.trim());
          if (c.label.toLowerCase().includes("size") || c.id === "size") {
            const applyInchM = (table.mode ?? "template") !== "manual";
            valStr = applyInchM && rawVal ? convertAllPointValues(rawVal) : rawVal;
          } else if (c.kind === "number" && isPureNumber) {
            const num = parseFloat(rawVal);
            valStr = c.label.toLowerCase().includes("amount") ? pdfCurrency(num) : pdfNumber(num);
          } else {
            valStr = rawVal; // verbatim text (or empty)
          }
          const cX = (verticalX[ci] + verticalX[ci + 1]) / 2;
          const alignOpt = isPartCol ? (align === "right" ? "right" : align === "center" ? "center" : "left") : "center";
          const drawPosX = isPartCol ? (align === "right" ? verticalX[ci + 1] - 2 : align === "center" ? cX : verticalX[ci] + 2) : cX;

          if (isPartCol) {
            // Use rich text rendering for Particulars column
            const plainVal = getPlainText(rawVal || "");
            if (plainVal.trim() === "") return; // nothing to draw for empty particulars
            const isRowBold = (m.row as any).bold === true || m.row.cells?.bold === "true";
            const richLines = parseRichLines(rawVal || "", isRowBold);
            const wrappedVisualRows: RichLine[] = [];
            const colW = Math.max(colWidths[ci] - 3 * scale, 5);
            for (const rl of richLines) {
              wrappedVisualRows.push(...wrapRichLine(doc, rl, colW, nfs));
            }
            wrappedVisualRows.forEach((vRow: RichSegment[], lineIdx: number) => {
              const lineY = baselineFor(wrappedVisualRows.length, nLineSpacing, nCapHeight) + lineIdx * nLineSpacing;
              drawRichSegments(doc, vRow, drawPosX, lineY, nfs, alignOpt as any);
            });
          } else {
            if (valStr.trim() === "") return; // leave empty cells blank (no em-dash)
            doc.setFont("times", "normal");
            const lines = doc.splitTextToSize(valStr, Math.max(colWidths[ci] - 3 * scale, 5));
            doc.text(lines, drawPosX, baselineFor(lines.length, nLineSpacing, nCapHeight), { align: alignOpt });
          }
        });

        const amtCol = findCustomAmountCol(table.columns);
        subtotal += amtCol ? (parseFloat(m.row.cells[amtCol.id]) || 0) : 0;
      } else {
        // Sr No + Particulars span the whole group (main + sub-rows) as one merged
        // cell, so centre them on the full group height when sub-rows exist;
        // otherwise centre on the single row.
        const srBaseline = hasSubRows ? baselineForGroup : baselineFor;
        doc.setFont("times", "normal");
        doc.setFontSize(nfs);
        doc.text(m.srLines, srCenterX, srBaseline(m.srLines.length, nLineSpacing, nCapHeight), { align: "center" });

        // Particulars — render with inline bold segments, centred on the group
        // when sub-rows exist (matching the merged Sr No cell), else on the row.
        doc.setFontSize(m.fontSize);
        const alignOpt = align === "left" ? "left" : align === "right" ? "right" : "center";
        const drawX = colX[1] + (align === "right" ? colWidths[1] - 4 : align === "center" ? (colWidths[1] - 4) / 2 : 0);
        const baseY = hasSubRows
          ? baselineForGroup(m.wrappedVisualRows.length, m.lineSpacing, m.capHeight)
          : baselineFor(m.wrappedVisualRows.length, m.lineSpacing, m.capHeight);

        m.wrappedVisualRows.forEach((vRow: RichSegment[], lineIdx: number) => {
          const lineY = baseY + lineIdx * m.lineSpacing;
          drawRichSegments(doc, vRow, drawX, lineY, m.fontSize, alignOpt as any);
        });

        // Size / Quantity / Rate (or a single merged "LS" cell).
        doc.setFont("times", "normal");
        doc.setFontSize(nfs);
        if (isLS) {
          // Merge from Size through to the column before the last Amount.
          const mergeStart = verticalX[2];
          const mergeEnd = isLabourFormat ? verticalX[verticalX.length - 2] : (showAmtCol ? verticalX[5] : verticalX[6]);
          doc.text("LS", (mergeStart + mergeEnd) / 2, baselineFor(1, nLineSpacing, nCapHeight), { align: "center" });
        } else {
          if (isLabourFormat || showSizeCol) {
            const sizeLines = m.sizeLines.length > 0 ? m.sizeLines : ["\u2014"];
            doc.text(sizeLines, sizeCenterX, baselineFor(sizeLines.length, nLineSpacing, nCapHeight), { align: "center" });
          }
          if (isLabourFormat || showQtyCol) {
            doc.text(m.qtyLines, qtyCenterX, baselineForGroup(m.qtyLines.length, nLineSpacing, nCapHeight), { align: "center" });
          }
          if (isLabourFormat) {
            // Labour rate + amount, Material rate + amount
            const labourRate = parseFloat(m.row.cells.labourRate) || 0;
            const labourAmt = parseFloat(m.row.cells.labourAmount) || 0;
            const materialRate = parseFloat(m.row.cells.materialRate) || 0;
            const materialAmt = parseFloat(m.row.cells.materialAmount) || 0;
            doc.text(labourRate > 0 ? pdfNumber(labourRate) : "\u2014", labourCenterX, baselineForGroup(1, nLineSpacing, nCapHeight), { align: "center" });
            doc.text(labourAmt > 0 ? pdfNumber(labourAmt) : "\u2014", labourAmtCenterX, baselineForGroup(1, nLineSpacing, nCapHeight), { align: "center" });
            doc.text(materialRate > 0 ? pdfNumber(materialRate) : "\u2014", materialCenterX, baselineForGroup(1, nLineSpacing, nCapHeight), { align: "center" });
            doc.text(materialAmt > 0 ? pdfNumber(materialAmt) : "\u2014", materialAmtCenterX, baselineForGroup(1, nLineSpacing, nCapHeight), { align: "center" });
          } else if (showRateCol) {
            doc.text(m.rateLines, rateCenterX, baselineForGroup(m.rateLines.length, nLineSpacing, nCapHeight), { align: "center" });
          }
        }
        // Amount column (standard format only — labour format draws both amounts above).
        if (!isLabourFormat && showAmtCol) {
          doc.text(m.amtLines, amtCenterX, baselineForGroup(m.amtLines.length, nLineSpacing, nCapHeight), { align: "center" });
        }

        subtotal += isLabourFormat ? (parseFloat(m.row.cells.materialAmount) || 0) : (parseFloat(m.row.cells.amount) || 0);
      }

      // Draw the main row's height, then sub-rows below it.

      if (hasSubRows) {
        // Divider between the main row and the first sub-row: draw ONLY across the
        // Size column (verticalX[2] → verticalX[3]). This keeps Sr No + Particulars
        // as one clean merged cell so their (group-centred) text is never cut.
        yPos += mainH;
        doc.line(verticalX[2], yPos, verticalX[3], yPos);

        // Draw each sub-row (particulars + size only)
        doc.setFont("times", "normal");
        doc.setFontSize(nfs);
        m.subRowsData.forEach((sub, si) => {
          const subTop = yPos;
          const subBaseY = subTop + sub.height / 2 + nCapHeight / 2;
          // Sub-row particulars (rare — usually only Size is used in sub-rows)
          if (sub.particulars.length > 0 && sub.particulars[0]) {
            doc.text(sub.particulars, colX[1], subBaseY, { align: "left" });
          }
          // Sub-row size
          if (sub.size.length > 0) {
            doc.text(sub.size, sizeCenterX, subBaseY, { align: "center" });
          }
          yPos += sub.height;
          // Line after sub-row: full width for the last sub-row (closes the group),
          // Size-only for intermediate sub-rows.
          if (si === m.subRowsData.length - 1) {
            doc.line(margin, yPos, pageWidth - margin, yPos);
          } else {
            doc.line(verticalX[2], yPos, verticalX[3], yPos);
          }
        });
      } else {
        yPos += rowHeight;
        // Draw horizontal grid line below the row
        doc.line(margin, yPos, pageWidth - margin, yPos);
      }
      // Vertical grid lines for the full group height
      drawRowVerticals(yTop, yPos, isLS);
    });

    // In-table Total row(s). For the custom format this can be turned off per table.
    if (isCustomFormat && table.showTableTotal === false) {
      return subtotal;
    }
    // Standard format with the Amount column hidden: no total row to draw.
    if (!isCustomFormat && !isLabourFormat && !showAmtCol) {
      return subtotal;
    }
    const totalRowH = minRowHeight * scale;
    if (!compressed && yPos + totalRowH > pageBottom) { doc.addPage(); yPos = 20; }
    const totalTop = yPos;
    const totalBot = yPos + totalRowH;
    doc.setDrawColor(0);
    doc.setLineWidth(0.2);
    doc.setFont("times", "bold");
    doc.setFontSize(10 * scale);
    const yBaseTotal = totalTop + totalRowH / 2 + 1.25 * scale;

    if (isCustomFormat && table.columns && table.columns.length > 0) {
      const amtCol = findCustomAmountCol(table.columns);
      const amtColIdx = amtCol ? table.columns.findIndex(c => c.id === amtCol.id) : -1;
      const totalColIdx = amtColIdx !== -1 ? amtColIdx : table.columns.length - 1;
      const labelColIdx = Math.max(0, totalColIdx - 1);

      doc.line(verticalX[labelColIdx], totalTop, verticalX[totalColIdx + 1], totalTop);
      doc.line(verticalX[labelColIdx], totalBot, verticalX[totalColIdx + 1], totalBot);
      doc.line(verticalX[labelColIdx], totalTop, verticalX[labelColIdx], totalBot);
      doc.line(verticalX[totalColIdx], totalTop, verticalX[totalColIdx], totalBot);
      doc.line(verticalX[totalColIdx + 1], totalTop, verticalX[totalColIdx + 1], totalBot);

      doc.text("Total", (verticalX[labelColIdx] + verticalX[totalColIdx]) / 2, yBaseTotal, { align: "center" });
      doc.text(pdfCurrency(subtotal), (verticalX[totalColIdx] + verticalX[totalColIdx + 1]) / 2, yBaseTotal, { align: "center" });
    } else if (isLabourFormat) {
      // Two "Total" boxes: one for Labour Amount, one for Material Amount.
      const labourSubtotal = table.rows.reduce((s, r) => s + (parseFloat(r.cells.labourAmount) || 0), 0);
      // Labour total boxes (col 4 = label "Total", col 5 = labour sum)
      doc.line(verticalX[4], totalTop, verticalX[5 + 1], totalTop);
      doc.line(verticalX[4], totalBot, verticalX[5 + 1], totalBot);
      doc.line(verticalX[4], totalTop, verticalX[4], totalBot);
      doc.line(verticalX[5], totalTop, verticalX[5], totalBot);
      doc.line(verticalX[6], totalTop, verticalX[6], totalBot);
      doc.text("Total", (verticalX[4] + verticalX[5]) / 2, yBaseTotal, { align: "center" });
      doc.text(pdfCurrency(labourSubtotal), (verticalX[5] + verticalX[6]) / 2, yBaseTotal, { align: "center" });
      // Material total boxes (col 6 = label "Total", col 7 = material sum)
      doc.line(verticalX[6], totalTop, verticalX[8], totalTop);
      doc.line(verticalX[6], totalBot, verticalX[8], totalBot);
      doc.line(verticalX[7], totalTop, verticalX[7], totalBot);
      doc.line(verticalX[8], totalTop, verticalX[8], totalBot);
      doc.text("Total", (verticalX[6] + verticalX[7]) / 2, yBaseTotal, { align: "center" });
      doc.text(pdfCurrency(subtotal), (verticalX[7] + verticalX[8]) / 2, yBaseTotal, { align: "center" });
    } else if (showAmtCol) {
      // Standard: total value under the Amount column; "Total" label in the last
      // VISIBLE column immediately to its left (rate → qty → size → particulars).
      const valLeftX = verticalX[5];               // Amount column's left edge
      const valRightX = verticalX[6];              // Amount column's right edge
      const labelLeftX = showRateCol ? verticalX[4] : showQtyCol ? verticalX[3] : showSizeCol ? verticalX[2] : verticalX[1];
      doc.line(labelLeftX, totalTop, valRightX, totalTop);
      doc.line(labelLeftX, totalBot, valRightX, totalBot);
      doc.line(labelLeftX, totalTop, labelLeftX, totalBot);
      doc.line(valLeftX, totalTop, valLeftX, totalBot);
      doc.line(valRightX, totalTop, valRightX, totalBot);
      doc.text("Total", (labelLeftX + valLeftX) / 2, yBaseTotal, { align: "center" });
      doc.text(pdfCurrency(subtotal), (valLeftX + valRightX) / 2, yBaseTotal, { align: "center" });
    }
    // If the Amount column is hidden, no in-table total row is drawn.
    yPos = totalBot;

    return subtotal;
  };

  // Grand-total summary footprint (Total + Advance + Balance), reserved below the
  // last page group so it never gets orphaned on its own page.
  // Only reserve space when there's actually something to show.
  const showAdvance = billDetails.showAdvance !== false;
  const showBalance = billDetails.showBalance !== false;
  const showGrandTotal = billDetails.showGrandTotal !== false;
  const summaryCount = (showGrandTotal ? 1 : 0) + (showAdvance ? 1 : 0) + (showBalance ? 1 : 0);
  const GRAND_SUMMARY_RESERVE = summaryCount > 0 ? 14 + summaryCount * 5 + 8 : 0;
  const noteReserve = (billDetails.showNote && billDetails.note) ? 20 : 0;

  // Real printed height of the column-header row (accounts for multi-line wrapped
  // labels, e.g. labour's "Materials with Labour Charges"). Mirrors drawTableHeader.
  const computeHeaderBlockHeight = (scale: number = 1, forTable?: BillTable): number => {
    const headerFontSize = (isLabourFormat ? 9.5 : 11) * scale;
    doc.setFont("times", "bold");
    doc.setFontSize(headerFontSize);
    // Use the passed table's columns for custom format, so each table's own
    // schema drives the header height estimate.
    const tbl = forTable ?? tables[0];
    const customCols = isCustomFormat && tbl?.columns?.length ? tbl.columns : null;
    const labels = customCols
      ? customCols.map(c => c.label)
      : isLabourFormat
      ? [columns.sr, columns.particulars, columns.size, columns.quantity, columns.labourCharges ?? "Only Labour Charges", columns.labourAmount ?? "Amount", columns.materialCharges ?? "Materials with Labour Charges", columns.materialAmount ?? "Amount"]
      : [columns.sr, columns.particulars, columns.size, columns.quantity, columns.rate, columns.amount];
    const labelLines = colWidths.map((w, i) => {
      const text = labels[i] || "";
      // Virtual (unscaled) width so the line count matches the scaled drawing.
      return headerLines(doc, text, Math.max(w / layoutScale - 2, 6));
    });
    const maxLines = Math.max(1, ...labelLines.map(l => l.length));
    const hLineSpacing = headerFontSize * 0.42;
    return Math.max(headerHeight * scale, (maxLines - 1) * hLineSpacing + headerFontSize * 0.25 + 3.2 * scale);
  };

  // Natural (unscaled) printed height of one table.
  const measureTableNatural = (table: BillTable): number => {
    let rowsH = 0;
    table.rows.forEach(row => {
      const fontSize = parseInt(row.cells.fontSize) || 11;
      const isBold = (row as any).bold === true || row.cells.bold === "true";
      const richLines = parseRichLines(row.cells.particulars || "", isBold);
      const wrappedVisualRows: RichLine[] = [];
      for (const rl of richLines) {
        // Measure in the virtual (unscaled) layout: real width / layoutScale.
        wrappedVisualRows.push(...wrapRichLine(doc, rl, colWidths[flexColIdx] / layoutScale - 4, fontSize));
      }
      const lineSpacing = fontSize * 0.405;
      const capHeight = fontSize * 0.25;
      const textHeight = (Math.max(wrappedVisualRows.length, 1) - 1) * lineSpacing + capHeight;
      // Account for wrapped Size lines too.
      const sizeRawM = row.cells.size || "";
      const isLSRowM = sizeRawM.trim().toUpperCase() === "LS";
      const rowModeM = row.cells.mode || (table.mode ?? "template");
      const applyInchM = rowModeM !== "manual";
      const sizeStrM = (!isLSRowM && applyInchM && sizeRawM) ? convertAllPointValues(sizeRawM) : sizeRawM;
      doc.setFont("times", "normal");
      doc.setFontSize(11);
      const sizeLines = sizeStrM && !isLSRowM && !isCustomFormat ? doc.splitTextToSize(sizeStrM, Math.max((colWidths[2] ?? 20) / layoutScale - 3, 5)) : [];
      const sizeTextHeight = sizeLines.length > 0 ? (sizeLines.length - 1) * (11 * 0.405) + 11 * 0.25 : 0;
      rowsH += Math.max(Math.max(textHeight, sizeTextHeight) + 2.5, minRowHeight);
    });
    const labelH = (table.title && table.title.trim()) ? 7 : 0;
    const totalRowH = (isCustomFormat && table.showTableTotal === false) ? 0 : minRowHeight;
    // Header height for the CURRENT layout (labels wrap differently per scale).
    const hdrH = computeHeaderBlockHeight(1, table);
    return labelH + hdrH + rowsH + totalRowH;
  };

  // Partition tables into page groups using their page numbers. Tables that share
  // the same page number group together on one page; whenever the page number
  // CHANGES from the previous table, a new page (group) begins.
  const groups: BillTable[][] = [];
  tables.forEach((t, i) => {
    const thisPage = t.page ?? 1;
    const prevPage = i > 0 ? (tables[i - 1].page ?? 1) : thisPage;
    if (i === 0 || thisPage !== prevPage) groups.push([t]);
    else groups[groups.length - 1].push(t);
  });

  // When enabled, tables are shrunk (row heights + fonts) to fit their page.
  // To keep table sizes CONSISTENT across all pages, we compute the scale each
  // page needs and then apply the SMALLEST (most-shrunk) scale to every page.
  // This means the busiest page (usually page 1, which also carries the header)
  // sets the size, and every other page matches it — no page can overflow since
  // a less-crowded page always fits at a smaller scale.
  const shrinkToFit = options?.fitToOnePage === true;

  // ── Pass 1: determine the single uniform scale ─────────────────────────────
  // For each page-group, compute how much it could scale to EXACTLY fill its
  // available page height (availableForGroup / naturalGroupHeight). Taking the
  // MINIMUM ratio across all groups gives one scale that:
  //   • never overflows any page (the tightest page limits the scale), and
  //   • grows short content UP to fill the page when there's spare room.
  // A cap keeps sparse tables from stretching into absurdly tall rows.
  const MAX_GROW = 1.6;  // never enlarge beyond 1.6× (keeps rows readable)
  const MIN_SHRINK = 0.4; // never shrink below 40%
  let uniformScale = 1;
  if (shrinkToFit) {
    const firstGroupStartY = yPos; // page 1 begins below the letterhead/subject
    // Largest scale at which every page-group fits, for the CURRENT column layout.
    const fitScaleForLayout = (): number => {
      let best = MAX_GROW;
      groups.forEach((group, gi) => {
        const isLastGroup = gi === groups.length - 1;
        const startY = gi === 0 ? firstGroupStartY : 20; // later groups start fresh
        const naturalGroupHeight =
          group.reduce((s, t) => s + measureTableNatural(t), 0) + 15 * Math.max(0, group.length - 1);
        const endLimit = isLastGroup
          ? (billDetails.showSignature ? 236 : pageBottom - 6) - GRAND_SUMMARY_RESERVE - noteReserve
          : pageBottom - 6;
        const availableForGroup = endLimit - startY;
        if (availableForGroup > 0 && naturalGroupHeight > 0) {
          best = Math.min(best, availableForGroup / naturalGroupHeight);
        }
      });
      return Math.max(MIN_SHRINK, Math.min(MAX_GROW, best));
    };
    // Columns depend on the scale (bigger text → wider numeric columns → narrower
    // Particulars → more wrapped lines), so iterate to a scale that truly fits.
    // Natural width each non-flex column wants (layout on an effectively
    // unlimited virtual width, so nothing gets compressed).
    layoutColumns(0.02, true);
    const naturalNeeds = colWidths.map(w => w / 0.02);
    const naturalFlex = flexColIdx;
    // Growing text must never force the numeric columns below what their
    // content needs (that's what made values/totals spill over the lines).
    const compressedAt = (s: number): boolean => {
      layoutColumns(s);
      if (flexColIdx !== naturalFlex || colWidths.length !== naturalNeeds.length) return false;
      return colWidths.some((w, i) => i !== flexColIdx && w / s < naturalNeeds[i] - 0.05);
    };

    layoutColumns(1);
    let s = fitScaleForLayout();
    for (let iter = 0; iter < 6; iter++) {
      layoutColumns(s);
      const next = fitScaleForLayout();
      if (next >= s - 0.005) break; // stable: this layout fits at s
      s = next;
    }
    // Only limit GROWTH (s > 1); at s <= 1 behaviour is unchanged.
    while (s > 1 && compressedAt(s)) s = Math.max(1, s - 0.02);
    uniformScale = s;
    layoutColumns(1); // restore; drawSectionTable lays out at its own scale
  }

  // ── Pass 2: draw every group at the uniform scale ──────────────────────────
  groups.forEach((group, gi) => {
    const isLastGroup = gi === groups.length - 1;
    if (gi > 0) { doc.addPage(); yPos = 20; }

    const groupScale = uniformScale;
    // When shrink-to-fit is on, Pass 1 already sized the group to fit its page
    // (including reserving summary/note space), so draw straight through without
    // per-table reserve/compression. Only reserve at natural size (no fit).
    const groupFitActive = shrinkToFit && groupScale !== 1;

    group.forEach((table, ti) => {
      const isLastTable = ti === group.length - 1;
      // Reserve room for the grand-total summary below the last table of the last
      // group — but only at natural size (the fit path already reserved that space).
      const reserveBelow = (!groupFitActive && isLastGroup && isLastTable) ? GRAND_SUMMARY_RESERVE : 0;
      drawSectionTable(table, reserveBelow, groupScale);
      if (!isLastTable) yPos += 15 * groupScale;
    });
  });

  // Total is always shown; Advance and Balance are optional.
  const summaryEntries: { label: string; value: number; bold: boolean; divider: boolean }[] = [];
  if (showGrandTotal) summaryEntries.push({ label: multipleTables ? "Grand Total:" : "Total:", value: total, bold: true, divider: false });
  if (showAdvance) summaryEntries.push({ label: "Advance:", value: billDetails.advance, bold: false, divider: false });
  if (showBalance) summaryEntries.push({ label: "Balance:", value: balance, bold: true, divider: showAdvance });

  // Only add the gap + draw the summary block when there is something to show.
  // (Avoids leaving dead vertical space when Total/Advance/Balance are all hidden.)
  if (summaryEntries.length > 0) {
    // Gap between the last table and the grand-total summary.
    yPos += 14;

    // Draw left-aligned totals below the tables (no box)
    if (yPos + 25 > pageBottom) { doc.addPage(); yPos = 20; }
    const boxX = margin;
    const boxY = yPos;
    const rowHeight = 4.5;
    const labelX = boxX;
    const valX = boxX + 45;

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
  } else {
    // No summary block — just a small gap after the table.
    yPos += 8;
  }

  // Note
  if (billDetails.showNote && billDetails.note) {
    doc.setFont("times", "bold");
    doc.setFontSize(11);
    doc.text("Note.", margin, yPos);
    yPos += 5;
    // drawRichHtml handles bold segments + <br> line breaks + word wrap in one call.
    yPos = drawRichHtml(doc, billDetails.note, margin, yPos, pageWidth - 40, 4, 11, "left");
    yPos += 4;
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
  columns: ColumnLabels = defaultColumnLabels,
  options?: { format?: "standard" | "labourMaterial" | "custom"; columnVisibility?: { size?: boolean; quantity?: boolean; rate?: boolean; amount?: boolean } }
): Promise<void> {
  const isLabourFormat = options?.format === "labourMaterial";
  const isCustomFormat = options?.format === "custom";
  const xcv = options?.columnVisibility ?? {};
  const xShowSize = xcv.size !== false;
  const xShowQty = xcv.quantity !== false;
  const xShowRate = xcv.rate !== false;
  const xShowAmt = xcv.amount !== false;

  const tableTotal = (t: BillTable) => {
    if (isCustomFormat) {
      const amtCol = t.columns.find(c => c.label.toLowerCase().includes("amount") || c.kind === "number");
      if (!amtCol) return 0;
      return t.rows.reduce((sum, row) => sum + (parseFloat(row.cells[amtCol.id]) || 0), 0);
    }
    if (isLabourFormat) return t.rows.reduce((sum, row) => sum + (parseFloat(row.cells.materialAmount) || 0), 0);
    return t.rows.reduce((sum, row) => sum + (parseFloat(row.cells.amount) || 0), 0);
  };
  const total = tables.reduce((sum, t) => sum + tableTotal(t), 0);
  const balance = total - billDetails.advance;
  const multipleTables = tables.length > 1;

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Bill", {
    pageSetup: {
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      orientation: "portrait",
      margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 }
    }
  });

  const thin = { style: "thin" as const, color: { argb: "FF000000" } };
  const cellBorder = { top: thin, left: thin, bottom: thin, right: thin };
  const headerFill = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFF0F0F0" } };

  let LAST_COL = "F";
  if (isLabourFormat) {
    LAST_COL = "H";
    // Same content-fitted widths as the PDF (mm → Excel char units).
    const lw = computeLabourColWidthsMM(makeTimesMeasurer(), tables, columns, 170);
    ws.columns = lw.map(w => ({ width: Math.max(4, w * 0.62) }));
  } else if (isCustomFormat && tables[0]?.columns?.length) {
    // Custom format: measure content to size each column, matching the PDF.
    const customCols = tables[0].columns;
    const { allCells, modes } = customRowsAndModes(tables);
    const xCW = computeCustomColWidthsMM(makeTimesMeasurer(), customCols, allCells, modes, 170);
    const mmToExcel = (mm: number) => Math.max(4, mm * 0.62);
    const colCount = customCols.length;
    LAST_COL = String.fromCharCode(64 + Math.min(colCount, 26));
    ws.columns = xCW.map(w => ({ width: mmToExcel(w) }));
  } else {
    // Standard format: derive column widths from the SAME mm computation the PDF
    // uses, so Excel proportions match the PDF. mm → Excel char-width units.
    const xStdCW = computeStandardColWidthsMM(
      makeTimesMeasurer(),
      tables,
      columns,
      { size: xShowSize, quantity: xShowQty, rate: xShowRate, amount: xShowAmt },
      170
    );
    const mmToExcel = (mm: number) => Math.max(4, mm * 0.62);
    const stdWidths: { width: number }[] = [{ width: mmToExcel(xStdCW.sr) }, { width: mmToExcel(xStdCW.particulars) }];
    if (xShowSize) stdWidths.push({ width: mmToExcel(xStdCW.size) });
    if (xShowQty) stdWidths.push({ width: mmToExcel(xStdCW.quantity) });
    if (xShowRate) stdWidths.push({ width: mmToExcel(xStdCW.rate) });
    if (xShowAmt) stdWidths.push({ width: mmToExcel(xStdCW.amount) });
    ws.columns = stdWidths;
    LAST_COL = String.fromCharCode(64 + stdWidths.length);
  }

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
    const clientNameVal = parseRichTextForExcel(billDetails.clientName || "", true);
    const cn = ws.addRow([typeof clientNameVal === "string" ? clientNameVal : ""]);
    if (typeof clientNameVal === "object") {
      cn.getCell(1).value = clientNameVal;
    } else {
      cn.getCell(1).font = { bold: true };
    }
    if (billDetails.showClientAddress !== false) {
      const addrVal = parseRichTextForExcel(billDetails.clientAddress || "");
      const addrRow = ws.addRow([typeof addrVal === "string" ? addrVal : ""]);
      if (typeof addrVal === "object") addrRow.getCell(1).value = addrVal;
      addrRow.getCell(1).alignment = { wrapText: true };
    }
  }
  addSpacer();

  if (billDetails.subject && billDetails.subject.trim()) {
    const subVal = parseRichTextForExcel(billDetails.subject);
    const subRow = ws.addRow(["Sub: "]);
    if (typeof subVal === "object" && "richText" in subVal) {
      subRow.getCell(1).value = {
        richText: [{ text: "Sub: ", font: { bold: true } }, ...subVal.richText]
      };
    } else {
      subRow.getCell(1).value = `Sub: ${subVal}`;
    }
    addSpacer();
  }

  tables.forEach((table) => {
    if (table.title && table.title.trim()) {
      const t = ws.addRow([table.title]);
      t.getCell(1).font = { bold: true, size: 12 };
    }

    if (isCustomFormat) {
      const cols = table.columns;
      const hr = ws.addRow(cols.map(c => c.label));
      hr.eachCell(c => {
        c.font = { bold: true };
        c.fill = headerFill;
        c.border = cellBorder;
        c.alignment = { horizontal: "center" };
      });

      table.rows.forEach(row => {
        const isRowBold = (row as any).bold === true || row.cells?.bold === "true";
        const rowVals = cols.map(c => {
          let v = row.cells[c.id] ?? "";
          if (c.kind === "number" && v.trim() === "0") v = ""; // bare 0 = not filled
          // Only format as a number when the WHOLE value is a clean number;
          // otherwise show exactly what was typed (e.g. "15000/NOS").
          const isPureNumber = v.trim() !== "" && /^-?\d+(\.\d+)?$/.test(v.trim());
          if (c.kind === "number" && isPureNumber) {
            const num = parseFloat(v);
            return c.label.toLowerCase().includes("amount") ? `${formatIndianNumber(num)}/-` : num;
          }
          return v;
        });
        const dr = ws.addRow(rowVals);
        cols.forEach((c, cIdx) => {
          const isPartCol = c.label.toLowerCase().includes("particular") || c.id === "particulars";
          if (isPartCol) {
            const rawVal = row.cells[c.id] ?? "";
            const richVal = parseRichTextForExcel(rawVal, isRowBold);
            if (typeof richVal === "object") {
              dr.getCell(cIdx + 1).value = richVal;
            } else if (isRowBold) {
              dr.getCell(cIdx + 1).font = { bold: true };
            }
            dr.getCell(cIdx + 1).alignment = { wrapText: true };
          } else if (isRowBold) {
            dr.getCell(cIdx + 1).font = { bold: true };
          }
        });
        dr.eachCell({ includeEmpty: true }, c => { c.border = cellBorder; });
      });

      if (table.showTableTotal !== false) {
        const totRow = cols.map((col, idx) => {
          if (col.kind === "number") {
            const colSum = table.rows.reduce((s, r) => s + (parseFloat(r.cells[col.id]) || 0), 0);
            return `${formatIndianNumber(colSum)}/-`;
          }
          return idx === 0 ? "Total" : "";
        });
        const tr = ws.addRow(totRow);
        tr.eachCell((c, colNum) => {
          if (cols[colNum - 1]?.kind === "number" || colNum === 1) {
            c.font = { bold: true };
            c.border = cellBorder;
            c.alignment = { horizontal: "center" };
          }
        });
      }
      addSpacer();
      return;
    }

    if (isLabourFormat) {
      const hr = ws.addRow([columns.sr, columns.particulars, columns.size, columns.quantity, columns.labourCharges ?? "Only Labour Charges", columns.labourAmount ?? "Amount", columns.materialCharges ?? "Materials with Labour Charges", columns.materialAmount ?? "Amount"]);
      hr.eachCell(c => {
        c.font = { bold: true };
        c.fill = headerFill;
        c.border = cellBorder;
        c.alignment = { horizontal: "center" };
      });

      table.rows.forEach((row, index) => {
        const isRowBold = (row as any).bold === true || row.cells?.bold === "true";
        const lRate = parseFloat(row.cells.labourRate) || 0;
        const lAmt = parseFloat(row.cells.labourAmount) || 0;
        const mRate = parseFloat(row.cells.materialRate) || 0;
        const mAmt = parseFloat(row.cells.materialAmount) || 0;
        const dr = ws.addRow([
          row.cells.sr || String(index + 1),
          "",
          row.cells.size || "",
          row.cells.quantity || "",
          lRate > 0 ? lRate : "",
          lAmt > 0 ? `${formatIndianNumber(lAmt)}/-` : "",
          mRate > 0 ? mRate : "",
          mAmt > 0 ? `${formatIndianNumber(mAmt)}/-` : ""
        ]);
        const richVal = parseRichTextForExcel(row.cells.particulars || "", isRowBold);
        if (typeof richVal === "object") {
          dr.getCell(2).value = richVal;
        } else {
          dr.getCell(2).value = richVal;
          if (isRowBold) dr.getCell(2).font = { bold: true };
        }
        dr.getCell(2).alignment = { wrapText: true };
        if (isRowBold) {
          [1, 3, 4, 5, 6, 7, 8].forEach(i => { dr.getCell(i).font = { bold: true }; });
        }
        dr.eachCell({ includeEmpty: true }, c => { c.border = cellBorder; });
      });

      const lTotal = table.rows.reduce((s, r) => s + (parseFloat(r.cells.labourAmount) || 0), 0);
      const mTotal = table.rows.reduce((s, r) => s + (parseFloat(r.cells.materialAmount) || 0), 0);
      const tr = ws.addRow(["", "", "", "Total", "Labour Total", `${formatIndianNumber(lTotal)}/-`, "Material Total", `${formatIndianNumber(mTotal)}/-`]);
      [4, 5, 6, 7, 8].forEach(i => {
        tr.getCell(i).font = { bold: true };
        tr.getCell(i).border = cellBorder;
        tr.getCell(i).alignment = { horizontal: "center" };
      });
      addSpacer();
      return;
    }

    // Standard format
    // Build the visible standard column list (Sr + Particulars always shown).
    const stdHeader = [columns.sr, columns.particulars];
    if (xShowSize) stdHeader.push(columns.size);
    if (xShowQty) stdHeader.push(columns.quantity);
    if (xShowRate) stdHeader.push(columns.rate);
    if (xShowAmt) stdHeader.push(columns.amount);
    const partCellIdx = 2; // Particulars is always the 2nd cell (1-based → cell 2)

    const hr = ws.addRow(stdHeader);
    hr.eachCell(c => {
      c.font = { bold: true };
      c.fill = headerFill;
      c.border = cellBorder;
      c.alignment = { horizontal: "center" };
    });

    table.rows.forEach((row, index) => {
      const isRowBold = (row as any).bold === true || row.cells?.bold === "true";
      const amtVal = parseFloat(row.cells.amount) || 0;
      const qty = parseFloat(row.cells.quantity) || 0;
      const rate = parseFloat(row.cells.rate) || 0;
      const isLS = (row.cells.size || "").trim().toUpperCase() === "LS";
      const qtyRounded = Math.round(qty * 100) / 100;
      const rateRounded = Math.round(rate * 100) / 100;
      const rowArr: any[] = [row.cells.sr || String(index + 1), ""];
      if (xShowSize) rowArr.push(isLS ? "LS" : (row.cells.size || ""));
      if (xShowQty) rowArr.push(isLS ? "" : (qty > 0 ? qtyRounded : ""));
      if (xShowRate) rowArr.push(isLS ? "" : (rate > 0 ? rateRounded : ""));
      if (xShowAmt) rowArr.push(amtVal > 0 ? `${formatIndianNumber(amtVal)}/-` : "");
      const dr = ws.addRow(rowArr);
      const richVal = parseRichTextForExcel(row.cells.particulars || "", isRowBold);
      dr.getCell(partCellIdx).value = richVal as any;
      if (typeof richVal !== "object" && isRowBold) dr.getCell(partCellIdx).font = { bold: true };
      dr.getCell(partCellIdx).alignment = { wrapText: true };
      dr.eachCell({ includeEmpty: true }, c => { c.border = cellBorder; });
      for (let i = 1; i <= rowArr.length; i++) {
        if (i === partCellIdx) continue;
        dr.getCell(i).alignment = { horizontal: "center" };
        if (isRowBold) dr.getCell(i).font = { bold: true };
      }
    });

    // Total row: only when the Amount column is visible.
    if (xShowAmt) {
      const sub = tableTotal(table);
      const totArr: any[] = ["", ""];
      if (xShowSize) totArr.push("");
      if (xShowQty) totArr.push("");
      if (xShowRate) totArr.push("Total");
      else totArr[totArr.length - 1] = "Total"; // put label in last col before amount
      totArr.push(`${formatIndianNumber(sub)}/-`);
      const tr = ws.addRow(totArr);
      const lastIdx = totArr.length;
      [lastIdx - 1, lastIdx].forEach(i => {
        tr.getCell(i).font = { bold: true };
        tr.getCell(i).border = cellBorder;
        tr.getCell(i).alignment = { horizontal: "center" };
      });
    }
    addSpacer();
  });

  // Grand totals
  const summaryLines: [string, string][] = [];
  if (billDetails.showGrandTotal !== false) summaryLines.push([multipleTables ? "Grand Total:" : "Total:", `${formatIndianNumber(total)}/-`]);
  if (billDetails.showAdvance !== false) summaryLines.push(["Advance:", `${formatIndianNumber(billDetails.advance)}/-`]);
  if (billDetails.showBalance !== false) summaryLines.push(["Balance:", `${formatIndianNumber(balance)}/-`]);
  summaryLines.forEach(([label, value]) => {
    const stdColCount = 2 + (xShowSize ? 1 : 0) + (xShowQty ? 1 : 0) + (xShowRate ? 1 : 0) + (xShowAmt ? 1 : 0);
    const lastColIdx = isLabourFormat ? 8 : (isCustomFormat && tables[0]?.columns?.length ? tables[0].columns.length : stdColCount);
    const labelColIdx = Math.max(1, lastColIdx - 1);
    const rowArray = Array(lastColIdx).fill("");
    rowArray[labelColIdx - 1] = label;
    rowArray[lastColIdx - 1] = value;
    const r = ws.addRow(rowArray);
    r.getCell(labelColIdx).font = { bold: true };
    r.getCell(lastColIdx).font = { bold: true };
    r.getCell(lastColIdx).alignment = { horizontal: "center" };
  });
  addSpacer();

  // Note
  if (billDetails.showNote && billDetails.note) {
    const n = ws.addRow(["Note."]);
    n.getCell(1).font = { bold: true };
    const noteVal = parseRichTextForExcel(billDetails.note);
    const noteRow = ws.addRow([typeof noteVal === "string" ? noteVal : ""]);
    if (typeof noteVal === "object") noteRow.getCell(1).value = noteVal;
    noteRow.getCell(1).alignment = { wrapText: true };
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

// Full single-line grid, matching the PDF table look.
const WORD_TABLE_BORDERS = {
  top: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
  left: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
  right: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
  insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
  insideVertical: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
};
// No visible grid — used for the right-aligned totals summary (matches PDF).
const WORD_NO_BORDERS = {
  top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  insideHorizontal: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  insideVertical: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
};

export async function exportProfessionalWord(
  header: HeaderTemplate,
  tables: BillTable[],
  billDetails: BillDetails,
  filename: string = "bill",
  columns: ColumnLabels = defaultColumnLabels,
  options?: { format?: "standard" | "labourMaterial" | "custom"; columnVisibility?: { size?: boolean; quantity?: boolean; rate?: boolean; amount?: boolean } }
): Promise<void> {
  const isLabourFormat = options?.format === "labourMaterial";
  const isCustomFormat = options?.format === "custom";
  const wcv = options?.columnVisibility ?? {};
  const wShowSize = wcv.size !== false;
  const wShowQty = wcv.quantity !== false;
  const wShowRate = wcv.rate !== false;
  const wShowAmt = wcv.amount !== false;

  const tableTotalW = (t: BillTable) => {
    if (isCustomFormat) {
      const amtCol = t.columns.find(c => c.label.toLowerCase().includes("amount") || c.kind === "number");
      if (!amtCol) return 0;
      return t.rows.reduce((sum, row) => sum + (parseFloat(row.cells[amtCol.id]) || 0), 0);
    }
    if (isLabourFormat) return t.rows.reduce((sum, row) => sum + (parseFloat(row.cells.materialAmount) || 0), 0);
    return t.rows.reduce((sum, row) => sum + (parseFloat(row.cells.amount) || 0), 0);
  };
  const total = tables.reduce((sum, t) => sum + tableTotalW(t), 0);
  const balance = total - billDetails.advance;
  const multipleTables = tables.length > 1;

  // Column widths that MATCH the PDF: measure content the same way, in mm, then
  // convert to DXA (twips). 1mm = 56.6929 DXA. PDF content width = 210 - 2*20.
  const WORD_CONTENT_MM = 170;
  const mmToDxa = (mm: number) => Math.max(1, Math.round(mm * 56.6929));
  const stdCW = computeStandardColWidthsMM(
    makeTimesMeasurer(),
    tables,
    columns,
    { size: wShowSize, quantity: wShowQty, rate: wShowRate, amount: wShowAmt },
    WORD_CONTENT_MM
  );

  const children: (Paragraph | Table)[] = [];

  const fsName = header.fontSizeName || 24;
  const fsContact = header.fontSizeContact || 11;
  const fsTagline = header.fontSizeTagline || 11;

  if (billDetails.showHeader !== false) {
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
  children.push(new Paragraph({ children: richTextToDocxRuns(billDetails.clientName, 22) }));
  if (billDetails.showClientAddress !== false) {
    children.push(new Paragraph({ children: richTextToDocxRuns(billDetails.clientAddress, 22), spacing: { after: 200 } }));
  } else {
    children.push(new Paragraph({ children: [new TextRun({ text: "", size: 22 })], spacing: { after: 200 } }));
  }

  // Subject
  children.push(
    new Paragraph({
      children: [new TextRun({ text: "Sub: ", size: 22 }), ...richTextToDocxRuns(billDetails.subject, 22)],
      spacing: { after: 200 }
    })
  );

  // Render each section table
  tables.forEach((table, i) => {
    const thisPage = table.page ?? 1;
    const prevPage = i > 0 ? (tables[i - 1].page ?? 1) : thisPage;
    if (i > 0 && thisPage > prevPage) {
      children.push(new Paragraph({ children: [new PageBreak()] }));
    }

    if (table.title && table.title.trim()) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: table.title, bold: true, size: 24 })],
          alignment: AlignmentType.LEFT,
          spacing: { before: 200, after: 60 }
        })
      );
    }

    if (isCustomFormat) {
      const cols = table.columns;
      // Content-measured column widths that match the PDF (mm → DXA).
      const { allCells, modes } = customRowsAndModes([table]);
      const cwMM = computeCustomColWidthsMM(makeTimesMeasurer(), cols, allCells, modes, WORD_CONTENT_MM);
      const colDxa = cwMM.map(w => mmToDxa(w));
      const tableTotalDxaC = colDxa.reduce((s, w) => s + w, 0);

      const customHeaderRow = new TableRow({
        children: cols.map((c, ci) => new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: c.label, bold: true })], alignment: c.kind === "number" ? AlignmentType.CENTER : AlignmentType.LEFT })],
          shading: { fill: "F0F0F0" },
          width: { size: colDxa[ci], type: WidthType.DXA }
        }))
      });

      const tableRows: TableRow[] = [customHeaderRow];

      table.rows.forEach((row) => {
        const isBold = (row as any).bold === true || row.cells?.bold === "true";
        const cells = cols.map(c => {
          let val = row.cells[c.id] ?? "";
          const isNum = c.kind === "number";
          if (isNum && val.trim() === "0") val = ""; // bare 0 = not filled
          // Only format when the whole value is a clean number; else verbatim.
          const isPureNumber = val.trim() !== "" && /^-?\d+(\.\d+)?$/.test(val.trim());
          const displayVal = isNum && isPureNumber
            ? (c.label.toLowerCase().includes("amount") ? formatIndianCurrency(parseFloat(val)) : pdfNumber(parseFloat(val)))
            : val;
          const isPartCol = c.label.toLowerCase().includes("particular") || c.id === "particulars";
          return new TableCell({
            children: [new Paragraph({
              children: isPartCol ? richTextToDocxRuns(val, undefined, isBold) : [new TextRun({ text: displayVal, bold: isBold })],
              alignment: isNum ? AlignmentType.CENTER : AlignmentType.LEFT
            })],
            width: { size: colDxa[cols.indexOf(c)], type: WidthType.DXA }
          });
        });
        tableRows.push(new TableRow({ children: cells }));
      });

      if (table.showTableTotal !== false) {
        const totalCells = cols.map((c, idx) => {
          if (c.kind === "number") {
            const colSum = table.rows.reduce((s, r) => s + (parseFloat(r.cells[c.id]) || 0), 0);
            return new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: `${formatIndianNumber(colSum)}/-`, bold: true })], alignment: AlignmentType.CENTER })],
              width: { size: colDxa[idx], type: WidthType.DXA }
            });
          }
          return new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: idx === 0 ? "Total" : "", bold: true })] })],
            width: { size: colDxa[idx], type: WidthType.DXA }
          });
        });
        tableRows.push(new TableRow({ children: totalCells }));
      }

      children.push(new Table({
        rows: tableRows,
        width: { size: tableTotalDxaC, type: WidthType.DXA },
        columnWidths: colDxa,
        layout: TableLayoutType.FIXED,
        borders: WORD_TABLE_BORDERS
      }));
      return;
    }

    if (isLabourFormat) {
      const lDxa = computeLabourColWidthsMM(makeTimesMeasurer(), tables, columns, WORD_CONTENT_MM).map(w => mmToDxa(w));
      const labourHeaderRow = new TableRow({
        children: [
          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: columns.sr, bold: true })] })], shading: { fill: "F0F0F0" }, width: { size: lDxa[0], type: WidthType.DXA } }),
          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: columns.particulars, bold: true })] })], shading: { fill: "F0F0F0" }, width: { size: lDxa[1], type: WidthType.DXA } }),
          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: columns.size, bold: true })] })], shading: { fill: "F0F0F0" }, width: { size: lDxa[2], type: WidthType.DXA } }),
          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: columns.quantity, bold: true })], alignment: AlignmentType.CENTER })], shading: { fill: "F0F0F0" }, width: { size: lDxa[3], type: WidthType.DXA } }),
          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: columns.labourCharges ?? "Only Labour Charges", bold: true })], alignment: AlignmentType.CENTER })], shading: { fill: "F0F0F0" }, width: { size: lDxa[4], type: WidthType.DXA } }),
          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: columns.labourAmount ?? "Amount", bold: true })], alignment: AlignmentType.CENTER })], shading: { fill: "F0F0F0" }, width: { size: lDxa[5], type: WidthType.DXA } }),
          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: columns.materialCharges ?? "Materials with Labour Charges", bold: true })], alignment: AlignmentType.CENTER })], shading: { fill: "F0F0F0" }, width: { size: lDxa[6], type: WidthType.DXA } }),
          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: columns.materialAmount ?? "Amount", bold: true })], alignment: AlignmentType.CENTER })], shading: { fill: "F0F0F0" }, width: { size: lDxa[7], type: WidthType.DXA } })
        ]
      });

      const tableRows: TableRow[] = [labourHeaderRow];

      table.rows.forEach((row, index) => {
        const isBold = (row as any).bold === true || row.cells?.bold === "true";
        const lRate = parseFloat(row.cells.labourRate) || 0;
        const lAmt = parseFloat(row.cells.labourAmount) || 0;
        const mRate = parseFloat(row.cells.materialRate) || 0;
        const mAmt = parseFloat(row.cells.materialAmount) || 0;
        tableRows.push(new TableRow({
          children: [
            new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: row.cells.sr || String(index + 1), bold: isBold })] })] }),
            new TableCell({ children: [new Paragraph({ children: richTextToDocxRuns(row.cells.particulars || "", undefined, isBold) })] }),
            new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: row.cells.size || "", bold: isBold })] })] }),
            new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: row.cells.quantity || "", bold: isBold })], alignment: AlignmentType.CENTER })] }),
            new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: lRate > 0 ? pdfNumber(lRate) : "—", bold: isBold })], alignment: AlignmentType.CENTER })] }),
            new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: lAmt > 0 ? formatIndianCurrency(lAmt) : "—", bold: isBold })], alignment: AlignmentType.CENTER })] }),
            new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: mRate > 0 ? pdfNumber(mRate) : "—", bold: isBold })], alignment: AlignmentType.CENTER })] }),
            new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: mAmt > 0 ? formatIndianCurrency(mAmt) : "—", bold: isBold })], alignment: AlignmentType.CENTER })] })
          ]
        }));
      });

      const lSub = table.rows.reduce((s, r) => s + (parseFloat(r.cells.labourAmount) || 0), 0);
      const mSub = table.rows.reduce((s, r) => s + (parseFloat(r.cells.materialAmount) || 0), 0);
      tableRows.push(new TableRow({
        children: [
          new TableCell({ children: [new Paragraph({ text: "" })] }),
          new TableCell({ children: [new Paragraph({ text: "" })] }),
          new TableCell({ children: [new Paragraph({ text: "" })] }),
          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Total", bold: true })] })] }),
          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Labour Total", bold: true })] })] }),
          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: `${formatIndianNumber(lSub)}/-`, bold: true })], alignment: AlignmentType.CENTER })] }),
          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Material Total", bold: true })] })] }),
          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: `${formatIndianNumber(mSub)}/-`, bold: true })], alignment: AlignmentType.CENTER })] })
        ]
      }));

      children.push(new Table({ rows: tableRows, width: { size: lDxa.reduce((a, b) => a + b, 0), type: WidthType.DXA }, columnWidths: lDxa, layout: TableLayoutType.FIXED, borders: WORD_TABLE_BORDERS }));
      return;
    }

    // Standard format — column widths MATCH the PDF (converted mm → DXA).
    // Hidden columns already collapsed to 0 (their width folded into Particulars).
    const midVisibleCount = (wShowSize ? 1 : 0) + (wShowQty ? 1 : 0) + (wShowRate ? 1 : 0);
    const srDxa = mmToDxa(stdCW.sr);
    const partDxa = mmToDxa(stdCW.particulars);
    const sizeDxa = mmToDxa(stdCW.size);
    const qtyDxa = mmToDxa(stdCW.quantity);
    const rateDxa = mmToDxa(stdCW.rate);
    const amtDxa = mmToDxa(stdCW.amount);
    // Column-width array for the table (only visible columns, in order).
    const stdColWidthsDxa: number[] = [srDxa, partDxa];
    if (wShowSize) stdColWidthsDxa.push(sizeDxa);
    if (wShowQty) stdColWidthsDxa.push(qtyDxa);
    if (wShowRate) stdColWidthsDxa.push(rateDxa);
    if (wShowAmt) stdColWidthsDxa.push(amtDxa);
    const tableTotalDxa = stdColWidthsDxa.reduce((s, w) => s + w, 0);

    const buildHeaderRow = () => {
      const cells = [
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: columns.sr, bold: true })] })], shading: { fill: "F0F0F0" }, width: { size: srDxa, type: WidthType.DXA } }),
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: columns.particulars, bold: true })] })], shading: { fill: "F0F0F0" }, width: { size: partDxa, type: WidthType.DXA } })
      ];
      if (wShowSize) cells.push(new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: columns.size, bold: true })] })], shading: { fill: "F0F0F0" }, width: { size: sizeDxa, type: WidthType.DXA } }));
      if (wShowQty) cells.push(new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: columns.quantity, bold: true })], alignment: AlignmentType.CENTER })], shading: { fill: "F0F0F0" }, width: { size: qtyDxa, type: WidthType.DXA } }));
      if (wShowRate) cells.push(new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: columns.rate, bold: true })], alignment: AlignmentType.CENTER })], shading: { fill: "F0F0F0" }, width: { size: rateDxa, type: WidthType.DXA } }));
      if (wShowAmt) cells.push(new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: columns.amount, bold: true })], alignment: AlignmentType.CENTER })], shading: { fill: "F0F0F0" }, width: { size: amtDxa, type: WidthType.DXA } }));
      return new TableRow({ children: cells });
    };

    const tableRows: TableRow[] = [buildHeaderRow()];

    table.rows.forEach((row, index) => {
      const qtyVal = parseFloat(row.cells.quantity) || 0;
      const rateVal = parseFloat(row.cells.rate) || 0;
      const amtVal = parseFloat(row.cells.amount) || 0;

      const isBold = (row as any).bold === true || row.cells?.bold === "true";
      const fontSize = parseInt(row.cells.fontSize) || 11;
      const align = (row.cells.align as any) || "left";
      const isLS = (row.cells.size || "").trim().toUpperCase() === "LS";

      let wordAlign: any = AlignmentType.LEFT;
      if (align === "center") wordAlign = AlignmentType.CENTER;
      if (align === "right") wordAlign = AlignmentType.RIGHT;

      const rowCells: TableCell[] = [
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: row.cells.sr || String(index + 1), bold: isBold })] })] }),
        new TableCell({
          children: [new Paragraph({ children: richTextToDocxRuns(row.cells.particulars || "", fontSize * 2, isBold), alignment: wordAlign })]
        })
      ];

      if (isLS && midVisibleCount > 0) {
        rowCells.push(new TableCell({ columnSpan: midVisibleCount, children: [new Paragraph({ children: [new TextRun({ text: "LS", bold: isBold })], alignment: AlignmentType.CENTER })] }));
      } else {
        if (wShowSize) rowCells.push(new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: row.cells.size || "", bold: isBold })] })] }));
        if (wShowQty) rowCells.push(new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: qtyVal > 0 ? pdfNumber(qtyVal) : "—", bold: isBold })], alignment: AlignmentType.CENTER })] }));
        if (wShowRate) rowCells.push(new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: rateVal > 0 ? pdfNumber(rateVal) : "—", bold: isBold })], alignment: AlignmentType.CENTER })] }));
      }
      if (wShowAmt) rowCells.push(new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: amtVal > 0 ? formatIndianCurrency(amtVal) : "—", bold: isBold })], alignment: AlignmentType.CENTER })] }));

      tableRows.push(new TableRow({ children: rowCells }));
    });

    // Total row: only when the Amount column is visible.
    if (wShowAmt) {
      const sub = tableTotalW(table);
      const totCells: TableCell[] = [
        new TableCell({ children: [new Paragraph({ text: "" })] }),
        new TableCell({ children: [new Paragraph({ text: "" })] })
      ];
      // Fill the middle visible columns; put "Total" in the last one before Amount.
      const midLabels: string[] = [];
      if (wShowSize) midLabels.push("");
      if (wShowQty) midLabels.push("");
      if (wShowRate) midLabels.push("");
      if (midLabels.length > 0) midLabels[midLabels.length - 1] = "Total";
      midLabels.forEach(lbl => totCells.push(new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: lbl, bold: true })], alignment: AlignmentType.CENTER })] })));
      if (midLabels.length === 0) {
        // Only Sr + Particulars + Amount visible → put "Total" in Particulars cell.
        totCells[1] = new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Total", bold: true })], alignment: AlignmentType.RIGHT })] });
      }
      totCells.push(new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: `${formatIndianNumber(sub)}/-`, bold: true })], alignment: AlignmentType.CENTER })] }));
      tableRows.push(new TableRow({ children: totCells }));
    }

    children.push(new Table({
      rows: tableRows,
      width: { size: tableTotalDxa, type: WidthType.DXA },
      columnWidths: stdColWidthsDxa,
      layout: TableLayoutType.FIXED,
      borders: WORD_TABLE_BORDERS
    }));
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
      width: { size: SUMMARY_SPACER + SUMMARY_LABEL + SUMMARY_VALUE, type: WidthType.DXA },
      borders: WORD_NO_BORDERS
    })
  );

  // Note
  if (billDetails.showNote && billDetails.note) {
    children.push(new Paragraph({ children: [new TextRun({ text: "Note.", bold: true, size: 22 })], spacing: { before: 400 } }));
    children.push(new Paragraph({ children: richTextToDocxRuns(billDetails.note, 22) }));
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

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: "Times New Roman", size: 22 }
        }
      }
    },
    sections: [{ children }]
  });
  const blob = await Packer.toBlob(doc);
  saveAs(blob, `${filename}.docx`);
}
