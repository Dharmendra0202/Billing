import type { BillTable, HeaderTemplate } from "../types";

export const initialHeader: HeaderTemplate = {
  businessName: "JYOTI INTERIORS",
  address: "Sairaj Apt Sadguru Nagar Diva, Thane",
  phone: "9029537078",
  gstNumber: ""
};

export const initialTables: BillTable[] = [
  {
    id: "table-a",
    title: "A",
    columns: [
      { id: "sr", label: "Sr No", kind: "number" },
      { id: "particulars", label: "Particulars", kind: "text" },
      { id: "qty", label: "Qty", kind: "number" },
      { id: "rate", label: "Rate", kind: "number" },
      { id: "amount", label: "Amount", kind: "number" }
    ],
    rows: [
      { id: "row-1", cells: { sr: "1", particulars: "Material bill", qty: "1", rate: "0", amount: "=qty*rate" } },
      { id: "row-2", cells: { sr: "2", particulars: "Labour bill", qty: "1", rate: "0", amount: "=qty*rate" } }
    ]
  },
  {
    id: "table-b",
    title: "Advance",
    columns: [
      { id: "date", label: "Date", kind: "text" },
      { id: "name", label: "Name", kind: "text" },
      { id: "amount", label: "Amount", kind: "number" }
    ],
    rows: [{ id: "row-3", cells: { date: "", name: "", amount: "0" } }]
  }
];
