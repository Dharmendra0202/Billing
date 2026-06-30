export type HeaderTemplate = {
  businessName: string;
  address: string;
  phone: string;
  gstNumber: string;
  logoUrl?: string;
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
