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

export type BillRow = {
  id: string;
  cells: Record<string, string>;
};

export type BillTable = {
  id: string;
  title: string;
  columns: BillColumn[];
  rows: BillRow[];
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
  bold?: boolean;
  fontSize?: number;
  align?: "left" | "center" | "right";
};

// A bill can contain multiple independent tables ("sections").
// Each section has an optional label (shown at the top-right of the table),
// e.g. "Master Bedroom", "Bedroom". The number of sections is not fixed.
export type BillSection = {
  id: string;
  title: string;
  rows: EditorRow[];
  // "template" = apply inch-conversion chart to sizes (e.g. .6 → .50)
  // "manual"   = treat sizes as plain decimals / math (no conversion)
  // Defaults to "template" when missing (backward compatible).
  mode?: "template" | "manual";
};
