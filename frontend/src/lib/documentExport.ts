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
import type { BillTable, HeaderTemplate } from "../types";

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
