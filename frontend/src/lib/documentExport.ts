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
  HeadingLevel
} from "docx";
import { saveAs } from "file-saver";
import * as XLSX from "xlsx";
import type { BillTable, HeaderTemplate, BillDetails } from "../types";

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
  doc.setFont("helvetica", "bold");
  doc.text(header.businessName || "Business Name", pageWidth / 2, yPos, { align: "center" });
  yPos += 8;

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
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
    doc.setFont("helvetica", "bold");
    doc.text(table.title, margin, yPos);
    yPos += 8;

    // Table headers
    const colWidth = contentWidth / table.columns.length;
    doc.setFontSize(10);
    doc.setFillColor(240, 240, 240);
    doc.rect(margin, yPos - 4, contentWidth, 8, "F");
    
    table.columns.forEach((col, i) => {
      doc.setFont("helvetica", "bold");
      doc.text(col.label, margin + i * colWidth + 2, yPos);
    });
    yPos += 8;

    // Table rows
    doc.setFont("helvetica", "normal");
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
      
      doc.setFont("helvetica", "bold");
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
  doc.setFont("helvetica", "bold");
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
      { id: qtyColId, label: "Qty", kind: "number" },
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
  return `₹ ${amount.toLocaleString('en-IN')}`;
};

const formatPDFCurrency = (amount: number): string => {
  return `Rs. ${amount.toLocaleString('en-IN')}`;
};

const formatIndianNumber = (amount: number): string => {
  return amount.toLocaleString('en-IN');
};

export async function exportProfessionalPDF(
  header: HeaderTemplate,
  tables: BillTable[],
  billDetails: BillDetails,
  filename: string = "bill"
): Promise<void> {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 20;
  let yPos = 15;

  // Calculate total
  const mainTable = tables[0];
  const total = mainTable?.rows.reduce((sum, row) => {
    return sum + (parseFloat(row.cells.amount) || 0);
  }, 0) || 0;
  const balance = total - billDetails.advance;

  // Top line
  doc.setDrawColor(0);
  doc.setLineWidth(0.5);
  doc.line(margin, yPos, pageWidth - margin, yPos);
  yPos += 8;

  // Business Name
  doc.setFontSize(22);
  doc.setFont("helvetica", "bold");
  doc.text(header.businessName, pageWidth / 2, yPos, { align: "center" });
  yPos += 7;

  // Phone
  doc.setFontSize(11);
  doc.setFont("helvetica", "normal");
  doc.text(`Mobile No. ${header.phone}`, pageWidth / 2, yPos, { align: "center" });
  yPos += 5;

  // Address
  doc.text(header.address, pageWidth / 2, yPos, { align: "center" });
  yPos += 5;

  // Bottom line
  doc.line(margin, yPos, pageWidth - margin, yPos);
  yPos += 5;

  // Tagline
  if (header.tagline) {
    doc.setFontSize(10);
    doc.text(header.tagline, pageWidth / 2, yPos, { align: "center", maxWidth: pageWidth - 40 });
    yPos += 10;
  }

  // Date - Right aligned
  yPos += 5;
  doc.setFontSize(11);
  doc.text(`Date: ${billDetails.date}`, pageWidth - margin, yPos, { align: "right" });
  yPos += 10;

  // Client Details
  doc.setFont("helvetica", "normal");
  doc.text("To,", margin, yPos);
  yPos += 6;
  doc.setFont("helvetica", "bold");
  doc.text(billDetails.clientName || "________________", margin, yPos);
  yPos += 6;
  doc.setFont("helvetica", "normal");
  doc.text(billDetails.clientAddress || "________________", margin, yPos);
  yPos += 12;

  // Subject
  doc.setFont("helvetica", "normal");
  doc.text(`Sub: ${billDetails.subject}`, margin, yPos, { maxWidth: pageWidth - 40 });
  yPos += 12;

  // Table
  const colWidths = [15, pageWidth - 2 * margin - 110, 25, 20, 20, 30];
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

  const tableStartY = yPos - 4;
  
  // Table header
  doc.setFillColor(245, 245, 245);
  doc.rect(margin, yPos - 4, pageWidth - 2 * margin, 8, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  
  doc.text("Sr. No", margin + colWidths[0] / 2, yPos, { align: "center" });
  doc.text("Particulars", margin + colWidths[0] + 2, yPos, { align: "left" });
  doc.text("Size", margin + colWidths[0] + colWidths[1] + colWidths[2] / 2, yPos, { align: "center" });
  doc.text("Qty", margin + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] / 2, yPos, { align: "center" });
  doc.text("Rate", margin + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + colWidths[4] - 2, yPos, { align: "right" });
  doc.text("Amount (Rs.)", pageWidth - margin - 2, yPos, { align: "right" });
  
  // Draw header top and bottom lines
  doc.setDrawColor(0);
  doc.setLineWidth(0.5);
  doc.line(margin, yPos - 4, pageWidth - margin, yPos - 4);
  doc.line(margin, yPos + 4, pageWidth - margin, yPos + 4);
  
  yPos += 10;

  // Table rows
  mainTable?.rows.forEach((row, index) => {
    const particulars = row.cells.particulars || "";
    const size = row.cells.size || "";
    const quantity = parseFloat(row.cells.quantity) || 0;
    const rate = parseFloat(row.cells.rate) || 0;
    const amount = parseFloat(row.cells.amount) || 0;
    
    const isBold = row.cells.bold === "true";
    const fontSize = parseInt(row.cells.fontSize) || 11;
    const align = (row.cells.align as any) || "left";
    
    // Set custom font for particulars
    doc.setFont("helvetica", isBold ? "bold" : "normal");
    doc.setFontSize(fontSize);
    
    // Handle multi-line particulars
    const lines = doc.splitTextToSize(particulars, colWidths[1] - 4);
    const rowHeight = Math.max(lines.length * (fontSize * 0.45), 8);
    
    doc.text(String(row.cells.sr || index + 1), margin + colWidths[0] / 2, yPos, { align: "center" });
    
    // Align particulars correctly
    const alignOpt = align === "left" ? "left" : align === "right" ? "right" : "center";
    const drawX = colX[1] + (align === "right" ? colWidths[1] - 4 : align === "center" ? (colWidths[1] - 4) / 2 : 0);
    doc.text(lines, drawX, yPos, { align: alignOpt });

    // Reset font style for the other cells in the row
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    
    doc.text(size || "—", margin + colWidths[0] + colWidths[1] + colWidths[2] / 2, yPos, { align: "center" });
    doc.text(quantity > 0 ? String(quantity) : "—", margin + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] / 2, yPos, { align: "center" });
    doc.text(rate > 0 ? formatIndianNumber(rate) : "—", margin + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + colWidths[4] - 2, yPos, { align: "right" });
    doc.text(amount > 0 ? formatPDFCurrency(amount) : "—", pageWidth - margin - 2, yPos, { align: "right" });
    
    yPos += rowHeight + 2;
    // Draw horizontal grid line below the row
    doc.line(margin, yPos - 6, pageWidth - margin, yPos - 6);
  });

  const tableEndY = yPos - 6;

  // Draw vertical grid lines for the items table
  verticalX.forEach(x => {
    doc.line(x, tableStartY, x, tableEndY);
  });

  // Totals Section
  yPos = tableEndY;
  
  // Total Row
  yPos += 6;
  doc.setFont("helvetica", "bold");
  doc.text("Total", verticalX[5] - 2, yPos, { align: "right" });
  doc.text(formatPDFCurrency(total), pageWidth - margin - 2, yPos, { align: "right" });
  doc.line(margin, yPos + 2, pageWidth - margin, yPos + 2);
  
  // Advance Row
  yPos += 6;
  doc.setFont("helvetica", "normal");
  doc.text("Advance", verticalX[5] - 2, yPos, { align: "right" });
  doc.text(formatPDFCurrency(billDetails.advance), pageWidth - margin - 2, yPos, { align: "right" });
  doc.line(margin, yPos + 2, pageWidth - margin, yPos + 2);
  
  // Balance Row
  yPos += 6;
  doc.setFont("helvetica", "bold");
  doc.text("Balance", verticalX[5] - 2, yPos, { align: "right" });
  doc.text(formatPDFCurrency(balance), pageWidth - margin - 2, yPos, { align: "right" });
  doc.line(margin, yPos + 2, pageWidth - margin, yPos + 2);

  const totalsEndY = yPos + 2;

  // Draw vertical borders around Totals section
  doc.line(margin, tableEndY, margin, totalsEndY); // Left border
  doc.line(pageWidth - margin, tableEndY, pageWidth - margin, totalsEndY); // Right border
  doc.line(verticalX[5], tableEndY, verticalX[5], totalsEndY); // Divider before Amount column

  yPos = totalsEndY + 12;

  // Note
  if (billDetails.showNote && billDetails.note) {
    doc.setFont("helvetica", "bold");
    doc.text("Note.", margin, yPos);
    yPos += 5;
    doc.setFont("helvetica", "normal");
    doc.text(billDetails.note, margin, yPos, { maxWidth: pageWidth - 40 });
    yPos += 15;
  }

  // Signature
  if (billDetails.showSignature) {
    yPos = Math.max(yPos, 240); // Push signature to bottom
    doc.setFont("helvetica", "normal");
    doc.text(`Proprietor: ${billDetails.proprietorName}`, pageWidth - margin - 60, yPos, { align: "center" });
    yPos += 15;
    doc.text("Authorised Signatory", pageWidth - margin - 60, yPos, { align: "center" });
  }

  doc.save(`${filename}.pdf`);
}

export async function exportProfessionalExcel(
  header: HeaderTemplate,
  tables: BillTable[],
  billDetails: BillDetails,
  filename: string = "bill"
): Promise<void> {
  const wb = XLSX.utils.book_new();
  const wsData: (string | number)[][] = [];

  const mainTable = tables[0];
  const total = mainTable?.rows.reduce((sum, row) => sum + (parseFloat(row.cells.amount) || 0), 0) || 0;
  const balance = total - billDetails.advance;

  // Header
  wsData.push([header.businessName]);
  wsData.push([`Mobile No. ${header.phone}`]);
  wsData.push([header.address]);
  if (header.tagline) wsData.push([header.tagline]);
  wsData.push([]);
  wsData.push([`Date: ${billDetails.date}`]);
  wsData.push([]);
  wsData.push(["To,"]);
  wsData.push([billDetails.clientName]);
  wsData.push([billDetails.clientAddress]);
  wsData.push([]);
  wsData.push([`Sub: ${billDetails.subject}`]);
  wsData.push([]);

  // Table header
  wsData.push(["Sr. No", "Particulars", "Size", "Quantity", "Rate", "Amount (₹)"]);

  // Table rows
  mainTable?.rows.forEach((row, index) => {
    wsData.push([
      row.cells.sr || String(index + 1),
      row.cells.particulars || "",
      row.cells.size || "",
      parseFloat(row.cells.quantity) || 0,
      parseFloat(row.cells.rate) || 0,
      parseFloat(row.cells.amount) || 0
    ]);
  });

  // Totals
  wsData.push(["", "", "", "", "Total", total]);
  wsData.push(["", "", "", "", "Advance", billDetails.advance]);
  wsData.push(["", "", "", "", "Balance", balance]);
  wsData.push([]);

  // Note
  if (billDetails.showNote && billDetails.note) {
    wsData.push(["Note."]);
    wsData.push([billDetails.note]);
    wsData.push([]);
  }

  // Signature
  if (billDetails.showSignature) {
    wsData.push([`Proprietor: ${billDetails.proprietorName}`]);
    wsData.push(["Authorised Signatory"]);
  }

  const ws = XLSX.utils.aoa_to_sheet(wsData);
  ws["!cols"] = [{ wch: 10 }, { wch: 45 }, { wch: 15 }, { wch: 12 }, { wch: 12 }, { wch: 15 }];
  
  XLSX.utils.book_append_sheet(wb, ws, "Bill");
  XLSX.writeFile(wb, `${filename}.xlsx`);
}

export async function exportProfessionalWord(
  header: HeaderTemplate,
  tables: BillTable[],
  billDetails: BillDetails,
  filename: string = "bill"
): Promise<void> {
  const mainTable = tables[0];
  const total = mainTable?.rows.reduce((sum, row) => sum + (parseFloat(row.cells.amount) || 0), 0) || 0;
  const balance = total - billDetails.advance;

  const children: (Paragraph | Table)[] = [];

  // Header
  children.push(
    new Paragraph({
      children: [new TextRun({ text: header.businessName, bold: true, size: 40 })],
      alignment: AlignmentType.CENTER,
      border: { top: { style: BorderStyle.SINGLE, size: 6 }, bottom: { style: BorderStyle.SINGLE, size: 6 } },
      spacing: { after: 100 }
    })
  );

  children.push(
    new Paragraph({
      children: [new TextRun({ text: `Mobile No. ${header.phone}`, size: 22 })],
      alignment: AlignmentType.CENTER
    })
  );

  children.push(
    new Paragraph({
      children: [new TextRun({ text: header.address, size: 22 })],
      alignment: AlignmentType.CENTER
    })
  );

  if (header.tagline) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: header.tagline, size: 20, italics: true })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 200 }
      })
    );
  }

  // Date
  children.push(
    new Paragraph({
      children: [new TextRun({ text: `Date: ${billDetails.date}`, size: 22 })],
      alignment: AlignmentType.RIGHT,
      spacing: { before: 200 }
    })
  );

  // Client
  children.push(new Paragraph({ children: [new TextRun({ text: "To,", size: 22 })], spacing: { before: 200 } }));
  children.push(new Paragraph({ children: [new TextRun({ text: billDetails.clientName, bold: true, size: 22 })] }));
  children.push(new Paragraph({ children: [new TextRun({ text: billDetails.clientAddress, size: 22 })], spacing: { after: 200 } }));

  // Subject
  children.push(
    new Paragraph({
      children: [new TextRun({ text: `Sub: ${billDetails.subject}`, size: 22 })],
      spacing: { after: 200 }
    })
  );

  // Table
  const tableRows: TableRow[] = [];

  // Header row
  tableRows.push(
    new TableRow({
      children: [
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Sr. No", bold: true })] })], shading: { fill: "F0F0F0" }, width: { size: 8, type: WidthType.PERCENTAGE } }),
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Particulars", bold: true })] })], shading: { fill: "F0F0F0" }, width: { size: 42, type: WidthType.PERCENTAGE } }),
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Size", bold: true })] })], shading: { fill: "F0F0F0" }, width: { size: 15, type: WidthType.PERCENTAGE } }),
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Quantity", bold: true })] })], shading: { fill: "F0F0F0" }, width: { size: 10, type: WidthType.PERCENTAGE } }),
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Rate", bold: true })] })], shading: { fill: "F0F0F0" }, width: { size: 10, type: WidthType.PERCENTAGE } }),
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Amount (₹)", bold: true })] })], shading: { fill: "F0F0F0" }, width: { size: 15, type: WidthType.PERCENTAGE } })
      ]
    })
  );

  // Data rows
  mainTable?.rows.forEach((row, index) => {
    const qtyVal = parseFloat(row.cells.quantity) || 0;
    const rateVal = parseFloat(row.cells.rate) || 0;
    const amtVal = parseFloat(row.cells.amount) || 0;
    
    const isBold = row.cells.bold === "true";
    const fontSize = parseInt(row.cells.fontSize) || 11;
    const align = (row.cells.align as any) || "left";
    
    let wordAlign: any = AlignmentType.LEFT;
    if (align === "center") wordAlign = AlignmentType.CENTER;
    if (align === "right") wordAlign = AlignmentType.RIGHT;
    
    tableRows.push(
      new TableRow({
        children: [
          new TableCell({ children: [new Paragraph({ text: row.cells.sr || String(index + 1) })] }),
          new TableCell({
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: row.cells.particulars || "",
                    bold: isBold,
                    size: fontSize * 2
                  })
                ],
                alignment: wordAlign
              })
            ]
          }),
          new TableCell({ children: [new Paragraph({ text: row.cells.size || "" })] }),
          new TableCell({ children: [new Paragraph({ text: qtyVal > 0 ? String(qtyVal) : "—", alignment: AlignmentType.RIGHT })] }),
          new TableCell({ children: [new Paragraph({ text: rateVal > 0 ? formatIndianNumber(rateVal) : "—", alignment: AlignmentType.RIGHT })] }),
          new TableCell({ children: [new Paragraph({ text: amtVal > 0 ? formatIndianCurrency(amtVal) : "—", alignment: AlignmentType.RIGHT })] })
        ]
      })
    );
  });

  // Total rows
  tableRows.push(
    new TableRow({
      children: [
        new TableCell({ children: [new Paragraph({ text: "" })] }),
        new TableCell({ children: [new Paragraph({ text: "" })] }),
        new TableCell({ children: [new Paragraph({ text: "" })] }),
        new TableCell({ children: [new Paragraph({ text: "" })] }),
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Total", bold: true })], alignment: AlignmentType.RIGHT })] }),
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: formatIndianCurrency(total), bold: true })], alignment: AlignmentType.RIGHT })] })
      ]
    })
  );

  tableRows.push(
    new TableRow({
      children: [
        new TableCell({ children: [new Paragraph({ text: "" })] }),
        new TableCell({ children: [new Paragraph({ text: "" })] }),
        new TableCell({ children: [new Paragraph({ text: "" })] }),
        new TableCell({ children: [new Paragraph({ text: "" })] }),
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Advance", bold: true })], alignment: AlignmentType.RIGHT })] }),
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: formatIndianCurrency(billDetails.advance), bold: true })], alignment: AlignmentType.RIGHT })] })
      ]
    })
  );

  tableRows.push(
    new TableRow({
      children: [
        new TableCell({ children: [new Paragraph({ text: "" })] }),
        new TableCell({ children: [new Paragraph({ text: "" })] }),
        new TableCell({ children: [new Paragraph({ text: "" })] }),
        new TableCell({ children: [new Paragraph({ text: "" })] }),
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Balance", bold: true })], alignment: AlignmentType.RIGHT })] }),
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: formatIndianCurrency(balance), bold: true })], alignment: AlignmentType.RIGHT })] })
      ]
    })
  );

  children.push(new Table({ rows: tableRows, width: { size: 100, type: WidthType.PERCENTAGE } }));

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
