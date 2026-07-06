export type HeaderTemplate = {
  businessName: string;
  address: string;
  phone: string;
  gstNumber: string;
  logoUrl?: string;
  tagline?: string; // "Specialist In All Interiors Works..."
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
  proprietorName: string;
};
