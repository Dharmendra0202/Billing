import { HyperFormula } from "hyperformula";
import type { BillTable } from "../types";
import { convertAllPointValues } from "./inchConversion";

type Workbook = {
  engine: HyperFormula;
  sheetNames: Map<string, string>;
};

export function formatIndianBillNumber(value: number): string {
  const num = Number(value);
  if (!Number.isFinite(num)) return "0";
  if (num % 1 === 0) {
    return num.toLocaleString('en-IN');
  } else {
    return num.toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }
}

export function money(value: number) {
  const num = Number(value);
  return "₹ " + formatIndianBillNumber(Number.isFinite(num) ? num : 0) + "/-";
}

export function formatNumber(value: number) {
  const num = Number(value);
  return formatIndianBillNumber(Number.isFinite(num) ? num : 0);
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

// Safely evaluate a basic arithmetic expression (supporting + - * / and
// parentheses) WITHOUT using eval / new Function — those are blocked by the
// Content-Security-Policy in packaged Electron builds, which previously made
// +, - and brackets silently fail. Returns null if the expression is invalid.
function evaluateArithmetic(expr: string): number | null {
  let pos = 0;
  const input = expr;

  const skipSpaces = () => { while (pos < input.length && /\s/.test(input[pos])) pos++; };

  // expression := term (('+' | '-') term)*
  const parseExpression = (): number | null => {
    let value = parseTerm();
    if (value === null) return null;
    for (;;) {
      skipSpaces();
      const op = input[pos];
      if (op === "+" || op === "-") {
        pos++;
        const rhs = parseTerm();
        if (rhs === null) return null;
        value = op === "+" ? value + rhs : value - rhs;
      } else {
        return value;
      }
    }
  };

  // term := factor (('*' | '/') factor)*
  const parseTerm = (): number | null => {
    let value = parseFactor();
    if (value === null) return null;
    for (;;) {
      skipSpaces();
      const op = input[pos];
      if (op === "*" || op === "/") {
        pos++;
        const rhs = parseFactor();
        if (rhs === null) return null;
        if (op === "/") {
          if (rhs === 0) return null;
          value = value / rhs;
        } else {
          value = value * rhs;
        }
      } else {
        return value;
      }
    }
  };

  // factor := ('+' | '-')? ( number | '(' expression ')' )
  const parseFactor = (): number | null => {
    skipSpaces();
    const sign = input[pos];
    if (sign === "+" || sign === "-") {
      pos++;
      const v = parseFactor();
      if (v === null) return null;
      return sign === "-" ? -v : v;
    }
    if (input[pos] === "(") {
      pos++;
      const v = parseExpression();
      if (v === null) return null;
      skipSpaces();
      if (input[pos] !== ")") return null; // unbalanced
      pos++;
      return v;
    }
    // number (integer or decimal)
    const start = pos;
    while (pos < input.length && /[0-9.]/.test(input[pos])) pos++;
    if (pos === start) return null;
    const num = parseFloat(input.slice(start, pos));
    return Number.isFinite(num) ? num : null;
  };

  const result = parseExpression();
  skipSpaces();
  // Reject if we couldn't consume the whole string (leftover garbage).
  if (result === null || pos !== input.length) return null;
  return Number.isFinite(result) ? result : null;
}

// Convert inch-marked values (e.g. 81" x 48") to feet by dividing each number
// followed by " by 12, then evaluate the resulting expression.
// Example: "81\" x 48\"" → "6.75 x 4" → 27
export function convertInchesToFeet(size: string): string {
  // Replace each number followed by " (inch mark) with number/12
  return size.replace(/(\d+(?:\.\d+)?)\s*["″'']/g, (_match, num) => {
    const feet = parseFloat(num) / 12;
    // Round to 4 decimal places to avoid float noise
    return String(Math.round(feet * 10000) / 10000);
  });
}

export function parseSize(size: string, applyInchConversion: boolean = true, mode?: "template" | "manual" | "inches"): number {
  const clean = size.trim();
  if (!clean) return 1;

  // Handle units: RFT (running feet) → divide by 12 to get feet.
  // NOS/PCS/NO → just extract the number as-is.
  const rftMatch = clean.match(/^([\d.+\-*/x×()\s]+)\s*RFT$/i);
  if (rftMatch) {
    const numStr = rftMatch[1].trim()
      .replace(/[x×]/gi, '*')
      .replace(/[^0-9+\-*/().\s]/g, '')
      .trim();
    const val = evaluateArithmetic(numStr);
    return val !== null ? val / 12 : (parseFloat(numStr) || 1) / 12;
  }

  const nosMatch = clean.match(/^([\d.+\-*/x×()\s]+)\s*(?:NOS|PCS|NO|Nos|Pcs|No)$/i);
  if (nosMatch) {
    const numStr = nosMatch[1].trim()
      .replace(/[x×]/gi, '*')
      .replace(/[^0-9+\-*/().\s]/g, '')
      .trim();
    const val = evaluateArithmetic(numStr);
    return val !== null ? val : (parseFloat(numStr) || 1);
  }

  // Convert point notation values first (e.g. 5.6 -> 5.50) — only in template mode.
  // In inches mode, convert numbers with " to feet first (÷12).
  let converted: string;
  if (mode === "inches") {
    converted = convertInchesToFeet(clean);
  } else {
    converted = applyInchConversion ? convertAllPointValues(clean) : clean;
  }

  // Replace multiplication characters with standard *
  const sanitized = converted
    .replace(/[x×]/gi, '*')
    // Remove any characters that are not digits, operators, dots, parenthesis, or spaces
    .replace(/[^0-9+\-*/().\s]/g, '')
    .trim();

  if (!sanitized) return 1;

  // Evaluate with the CSP-safe arithmetic parser (handles + - * / and brackets).
  const result = evaluateArithmetic(sanitized);
  if (result !== null) return result;

  // Fallback parsing (similar to old parseFloat behavior)
  const match = sanitized.match(/^[0-9.]+/);
  if (match) {
    const val = parseFloat(match[0]);
    return Number.isFinite(val) ? val : 1;
  }
  return 1;
}


// Title-case a string (capitalise the first letter of each word), while
// preserving acronyms / all-caps words (TV, AC, POP, NOS, RFT, LS, P.O.P, etc.).
// e.g. "door frame" -> "Door Frame", "tv panel" -> "Tv Panel", "TV panel" -> "TV Panel".
export function toTitleCase(input: string): string {
  return input.replace(/\S+/g, (word) => {
    const letters = word.replace(/[^A-Za-z]/g, "");
    // Keep words that are already all-uppercase letters (acronyms like TV, POP).
    if (letters.length > 0 && letters === letters.toUpperCase()) return word;
    // Otherwise capitalise the first alphabetic character; leave the rest as typed.
    return word.replace(/[A-Za-z]/, (c) => c.toUpperCase());
  });
}
