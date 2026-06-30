import type { BillTable, HeaderTemplate } from "../types";
import type { AICommand } from "./aiService";
import { makeId } from "./billMath";
import * as XLSX from "xlsx";

export function executeCommands(
  commands: AICommand[],
  header: HeaderTemplate,
  tables: BillTable[]
): { header: HeaderTemplate; tables: BillTable[] } {
  let newHeader = { ...header };
  let newTables = [...tables];

  for (const command of commands) {
    const result = executeCommand(command, newHeader, newTables);
    newHeader = result.header;
    newTables = result.tables;
  }

  return { header: newHeader, tables: newTables };
}

function executeCommand(
  command: AICommand,
  header: HeaderTemplate,
  tables: BillTable[]
): { header: HeaderTemplate; tables: BillTable[] } {
  const { action, params } = command;

  switch (action) {
    case "UPDATE_HEADER":
      return {
        header: { ...header, [params.field]: params.value },
        tables
      };

    case "ADD_TABLE": {
      const amountId = makeId("col");
      const newTable: BillTable = {
        id: makeId("table"),
        title: params.title || `Table ${tables.length + 1}`,
        columns: [
          { id: makeId("col"), label: "Particulars", kind: "text" },
          { id: amountId, label: "Amount", kind: "number" }
        ],
        rows: [{ id: makeId("row"), cells: { [amountId]: "0" } }]
      };
      return { header, tables: [...tables, newTable] };
    }

    case "DELETE_TABLE": {
      const newTables = tables.filter((_, i) => i !== params.tableIndex);
      return { header, tables: newTables };
    }

    case "RENAME_TABLE": {
      const newTables = tables.map((table, i) =>
        i === params.tableIndex ? { ...table, title: params.newTitle } : table
      );
      return { header, tables: newTables };
    }

    case "ADD_ROW": {
      const table = tables[params.tableIndex];
      if (!table) return { header, tables };

      const newRow = {
        id: makeId("row"),
        cells: params.data || {}
      };

      const newTables = tables.map((t, i) =>
        i === params.tableIndex ? { ...t, rows: [...t.rows, newRow] } : t
      );
      return { header, tables: newTables };
    }

    case "DELETE_ROW": {
      const table = tables[params.tableIndex];
      if (!table) return { header, tables };

      const newTables = tables.map((t, i) =>
        i === params.tableIndex
          ? { ...t, rows: t.rows.filter((_, ri) => ri !== params.rowIndex) }
          : t
      );
      return { header, tables: newTables };
    }

    case "UPDATE_CELL": {
      const table = tables[params.tableIndex];
      if (!table) return { header, tables };

      const newTables = tables.map((t, i) => {
        if (i !== params.tableIndex) return t;

        const newRows = t.rows.map((row, ri) => {
          if (ri !== params.rowIndex) return row;
          return {
            ...row,
            cells: { ...row.cells, [params.columnId]: params.value }
          };
        });

        return { ...t, rows: newRows };
      });

      return { header, tables: newTables };
    }

    case "ADD_COLUMN": {
      const table = tables[params.tableIndex];
      if (!table) return { header, tables };

      const newColumnId = makeId("col");
      const newColumn = {
        id: newColumnId,
        label: params.label,
        kind: params.kind || "text"
      };

      const newTables = tables.map((t, i) =>
        i === params.tableIndex
          ? { ...t, columns: [...t.columns, newColumn] }
          : t
      );

      return { header, tables: newTables };
    }

    case "EXPORT_EXCEL": {
      exportToExcel(header, tables, params.filename || "bill.xlsx");
      return { header, tables };
    }

    case "CALCULATE": {
      // Handle calculations like GST, discounts, etc.
      return handleCalculation(params, header, tables);
    }

    default:
      console.warn(`Unknown command: ${action}`);
      return { header, tables };
  }
}

function handleCalculation(
  params: any,
  header: HeaderTemplate,
  tables: BillTable[]
): { header: HeaderTemplate; tables: BillTable[] } {
  // Add GST calculation logic here
  if (params.operation === "gst") {
    const gstRate = params.rate || 18;
    // Add GST row to the last table or create new calculation table
    // Implementation depends on your requirements
  }

  return { header, tables };
}

export function exportToExcel(
  header: HeaderTemplate,
  tables: BillTable[],
  filename: string
): void {
  const wb = XLSX.utils.book_new();

  // Create header sheet
  const headerData = [
    ["Business Name", header.businessName],
    ["Address", header.address],
    ["Phone", header.phone],
    ["GST Number", header.gstNumber],
    [""],
    ["Bill Date", new Date().toLocaleDateString()],
    ["Bill No", "Draft"]
  ];

  tables.forEach((table, tableIndex) => {
    headerData.push([""]);
    headerData.push([table.title]);
    headerData.push([""]);

    // Column headers
    const headers = table.columns.map((col) => col.label);
    headerData.push(headers);

    // Data rows
    table.rows.forEach((row) => {
      const rowData = table.columns.map((col) => row.cells[col.id] || "");
      headerData.push(rowData);
    });

    // Total row
    const totalRow = table.columns.map((col, i) => {
      if (col.kind === "number") {
        const sum = table.rows.reduce((acc, row) => {
          const value = parseFloat(row.cells[col.id] || "0");
          return acc + (isNaN(value) ? 0 : value);
        }, 0);
        return sum.toString();
      }
      return i === 0 ? "Total" : "";
    });
    headerData.push(totalRow);
  });

  const ws = XLSX.utils.aoa_to_sheet(headerData);
  XLSX.utils.book_append_sheet(wb, ws, "Bill");

  // Generate Excel file
  XLSX.writeFile(wb, filename);
}
