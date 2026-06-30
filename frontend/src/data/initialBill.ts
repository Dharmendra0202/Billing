import type { BillTable, HeaderTemplate, BillDetails } from "../types";

// Your fixed business header - stays same for all bills
export const initialHeader: HeaderTemplate = {
  businessName: "DHARMENDRA VISHWAKARMA",
  address: "Sairaj Apt Sadguru Nagar Diva, Thane",
  phone: "9029537078",
  gstNumber: "",
  tagline: "Specialist In All Interiors Works Plumbing, Painting, P.O.P, Fabricating And Civil Work"
};

// Default bill details - editable per bill
export const initialBillDetails: BillDetails = {
  date: new Date().toLocaleDateString('en-IN'),
  clientName: "",
  clientAddress: "",
  subject: "Bill for Carpentry Work – Materials and Labour Charges",
  advance: 0,
  note: "GST 18% will be provided by the client.",
  showSignature: true,
  showNote: true,
  proprietorName: "Mr. Dharmendra Vishwakarma"
};

// Default table structure for bills
export const initialTables: BillTable[] = [
  {
    id: "table-main",
    title: "Bill Items",
    columns: [
      { id: "sr", label: "Sr. No", kind: "number" },
      { id: "particulars", label: "Particulars", kind: "text" },
      { id: "amount", label: "Amount", kind: "number" }
    ],
    rows: [
      { id: "row-1", cells: { sr: "1", particulars: "", amount: "0" } }
    ]
  }
];
