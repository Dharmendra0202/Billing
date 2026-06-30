import { HyperFormula } from "hyperformula";
import type { BillTable } from "../types";

type Workbook = {
  engine: HyperFormula;
  sheetNames: Map<string, string>;
};

export function money(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2
  }).format(Number.isFinite(value) ? value : 0);
}

export function makeId(prefix: string) {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

function key(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function numberFrom(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(String(value ?? "").replace(/[₹,\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function columnLetter(index: number) {
  let value = "";
  let current = index + 1;

  while (current > 0) {
    const remainder = (current - 1) % 26;
    value = String.fromCharCode(65 + remainder) + value;
    current = Math.floor((current - 1) / 26);
  }

  return value;
}

function safeSheetName(name: string, fallback: string, used: Set<string>) {
  const base = (name || fallback).replace(/[:\\/?*[\]]/g, " ").trim().slice(0, 28) || fallback;
  let candidate = base;
  let index = 2;

  while (used.has(candidate)) {
    candidate = `${base.slice(0, 25)} ${index}`;
    index += 1;
  }

  used.add(candidate);
  return candidate;
}

function findTable(tables: BillTable[], tableName: string) {
  const tableKey = key(tableName);
  return tables.find((table) => key(table.title) === tableKey || key(table.id) === tableKey);
}

function findColumn(table: BillTable, columnName: string) {
  const columnKey = key(columnName);
  return table.columns.find((column) => key(column.label) === columnKey || key(column.id) === columnKey);
}

function rangeFor(table: BillTable, columnId: string, sheetNames: Map<string, string>) {
  const columnIndex = table.columns.findIndex((column) => column.id === columnId);
  const letter = columnLetter(Math.max(columnIndex, 0));
  const lastRow = Math.max(table.rows.length, 1);
  const sheetName = sheetNames.get(table.id) ?? table.title;
  return `'${sheetName}'!${letter}1:${letter}${lastRow}`;
}

function cellFor(table: BillTable, rowIndex: number, columnId: string, sheetNames?: Map<string, string>) {
  const columnIndex = table.columns.findIndex((column) => column.id === columnId);
  const letter = columnLetter(Math.max(columnIndex, 0));
  const address = `${letter}${rowIndex + 1}`;

  if (!sheetNames) return address;
  return `'${sheetNames.get(table.id) ?? table.title}'!${address}`;
}

function rewriteFormula(raw: string, table: BillTable, rowIndex: number, tables: BillTable[], sheetNames: Map<string, string>) {
  let formula = raw.trim();
  if (!formula.startsWith("=")) return raw;

  formula = formula.replace(/SUM\(([^)]+)\)/gi, (_match, target: string) => {
    const parts = target.split(".").map((part) => part.trim());
    const targetTable = parts.length > 1 ? findTable(tables, parts[0]) : table;
    const targetColumn = targetTable ? findColumn(targetTable, parts[parts.length - 1] ?? "") : undefined;
    return targetTable && targetColumn ? `SUM(${rangeFor(targetTable, targetColumn.id, sheetNames)})` : "SUM(0)";
  });

  formula = formula.replace(/\b([A-Za-z_][A-Za-z0-9_]*)(?:\.([A-Za-z_][A-Za-z0-9_]*))?\b/g, (match, first, second) => {
    const upper = match.toUpperCase();
    if (["SUM", "ROUND", "IF", "MAX", "MIN", "AVERAGE", "ABS", "INT", "TODAY", "DATE"].includes(upper)) {
      return match;
    }

    if (second) {
      const targetTable = findTable(tables, first);
      const targetColumn = targetTable ? findColumn(targetTable, second) : undefined;
      return targetTable && targetColumn ? `SUM(${rangeFor(targetTable, targetColumn.id, sheetNames)})` : "0";
    }

    const sameRowColumn = findColumn(table, first);
    return sameRowColumn ? cellFor(table, rowIndex, sameRowColumn.id) : match;
  });

  return formula;
}

function buildWorkbook(tables: BillTable[]): Workbook {
  const usedNames = new Set<string>();
  const sheetNames = new Map<string, string>();

  tables.forEach((table, index) => {
    sheetNames.set(table.id, safeSheetName(table.title, `Table ${index + 1}`, usedNames));
  });

  const sheets = Object.fromEntries(
    tables.map((table) => {
      const sheetRows = table.rows.map((row, rowIndex) =>
        table.columns.map((column) => {
          const raw = row.cells[column.id] ?? "";
          if (String(raw).trim().startsWith("=")) {
            return rewriteFormula(String(raw), table, rowIndex, tables, sheetNames);
          }
          return column.kind === "number" ? numberFrom(raw) : raw;
        })
      );

      return [sheetNames.get(table.id) ?? table.title, sheetRows.length ? sheetRows : [[""]]];
    })
  );

  return {
    engine: HyperFormula.buildFromSheets(sheets, { licenseKey: "gpl-v3" }),
    sheetNames
  };
}

function readCell(workbook: Workbook, table: BillTable, rowIndex: number, columnId: string) {
  const sheetName = workbook.sheetNames.get(table.id);
  const sheet = sheetName ? workbook.engine.getSheetId(sheetName) : undefined;
  const col = table.columns.findIndex((column) => column.id === columnId);

  if (sheet === undefined || sheet === null || col < 0) return "";

  const value = workbook.engine.getCellValue({ sheet, row: rowIndex, col });
  if (typeof value === "object" && value !== null) return String(value);
  return value ?? "";
}

export function displayValue(table: BillTable, rowId: string, columnId: string, tables: BillTable[]) {
  const rowIndex = table.rows.findIndex((row) => row.id === rowId);
  if (rowIndex < 0) return "";
  const workbook = buildWorkbook(tables);
  return readCell(workbook, table, rowIndex, columnId);
}

export function columnTotal(table: BillTable, columnId: string, tables: BillTable[] = [table]) {
  const workbook = buildWorkbook(tables);
  return table.rows.reduce((sum, row, rowIndex) => {
    const value = readCell(workbook, table, rowIndex, columnId);
    return sum + numberFrom(value);
  }, 0);
}

export function grandTotal(tables: BillTable[]) {
  return tables.reduce((sum, table) => {
    const amountColumn =
      table.columns.find((column) => /amount|total|price|rate|balance/i.test(column.label)) ??
      table.columns.find((column) => column.kind === "number");

    return amountColumn ? sum + columnTotal(table, amountColumn.id, tables) : sum;
  }, 0);
}
