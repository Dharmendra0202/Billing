export type HeaderTemplate = {
  businessName: string;
  address: string;
  phone: string;
  gstNumber: string;
  logoUrl?: string;
  tagline?: string; // "Specialist In All Interiors Works..."
  fontSizeName?: number;
  fontSizeContact?: number;
  fontSizeTagline?: number;
};

export type BillColumn = {
  id: string;
  label: string;
  kind: "text" | "number";
};

// Editable labels for the fixed six columns of the bill editor. Shared across all
// tables and used in the editor, live preview, and PDF/Excel/Word exports.
export type ColumnLabels = {
  sr: string;
  particulars: string;
  size: string;
  quantity: string;
  rate: string;
  amount: string;
};

export type ColumnVisibility = {
  sr: boolean;
  particulars: boolean;
  size: boolean;
  quantity: boolean;
  rate: boolean;
  amount: boolean;
};

export const defaultColumnVisibility: ColumnVisibility = {
  sr: true,
  particulars: true,
  size: true,
  quantity: true,
  rate: true,
  amount: true
};

export const defaultColumnLabels: ColumnLabels = {
  sr: "Sr. No",
  particulars: "Particulars",
  size: "Size",
  quantity: "Quantity",
  rate: "Rate",
  amount: "Amount"
};

export type BillRow = {
  id: string;
  cells: Record<string, string>;
};

export type BillTable = {
  id: string;
  title: string;
  columns: BillColumn[];
  rows: BillRow[];
  // Which page this table prints on (see BillSection.page).
  page?: number;
  // "template" | "manual" — controls whether size values are shown with inch
  // conversion in exports. Default "template".
  mode?: "template" | "manual";
};

// Bill details that change per bill
export type BillDetails = {
  date: string;
  clientName: string;
  clientAddress: string;
  subject: string;
  advance: number;
  note: string;
  showSignature: boolean;
  showNote: boolean;
  // Total is always shown; Advance and Balance can be hidden (default: shown).
  showAdvance?: boolean;
  showBalance?: boolean;
  showGrandTotal?: boolean;
  showClientAddress?: boolean;
  showClientDetails?: boolean;
  showGST?: boolean;
  showHeader?: boolean;
  showDate?: boolean;
  proprietorName: string;
};


// A single editable row in the center-panel bill editor
export type EditorRow = {
  id: string;
  sr: number;
  particulars: string;
  size: string;
  quantity: number;
  rate: number;
  amount: number;
  // Labour + Material format fields (default 0 when unused)
  labourRate?: number;
  labourAmount?: number;
  materialRate?: number;
  materialAmount?: number;
  bold?: boolean;
  fontSize?: number;
  align?: "left" | "center" | "right";
  // Per-row override for template/manual mode. When set, overrides the table's mode.
  // undefined = inherit from the table's mode (default behavior).
  mode?: "template" | "manual";
};

export type BillFormat = "standard" | "labourMaterial" | "custom";

// A bill can contain multiple independent tables ("sections").
// Each section has an optional label (shown at the top-right of the table),
// e.g. "Master Bedroom", "Bedroom". The number of sections is not fixed.
export type BillSection = {
  id: string;
  title: string;
  rows: EditorRow[];
  // Dynamic columns and custom rows for "custom" format
  columns?: BillColumn[];
  customRows?: BillRow[];
  // "template" = apply inch-conversion chart to sizes (e.g. .6 → .50)
  // "manual"   = treat sizes as plain decimals / math (no conversion)
  // Defaults to "template" when missing (backward compatible).
  mode?: "template" | "manual";
  // Which page this table prints on. Tables sharing a number group on the same
  // page; a higher number than the previous table starts a new page. Default 1.
  page?: number;
};

