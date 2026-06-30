import { Plus, Trash2, Settings, Eye, EyeOff } from "lucide-react";
import { useState, useMemo } from "react";
import type { BillTable, HeaderTemplate, BillDetails } from "../types";
import { makeId } from "../lib/billMath";

type Props = {
  header: HeaderTemplate;
  tables: BillTable[];
  billDetails: BillDetails;
  onHeaderChange: (header: HeaderTemplate) => void;
  onTablesChange: (tables: BillTable[]) => void;
  onBillDetailsChange: (details: BillDetails) => void;
};

export function ProfessionalBillEditor({
  header,
  tables,
  billDetails,
  onHeaderChange,
  onTablesChange,
  onBillDetailsChange
}: Props) {
  const [showHeaderSettings, setShowHeaderSettings] = useState(false);

  // Calculate total from all tables
  const total = useMemo(() => {
    return tables.reduce((sum, table) => {
      const amountCol = table.columns.find(c => c.label.toLowerCase().includes('amount'));
      if (!amountCol) return sum;
      return sum + table.rows.reduce((rowSum, row) => {
        return rowSum + (parseFloat(row.cells[amountCol.id]) || 0);
      }, 0);
    }, 0);
  }, [tables]);

  const balance = total - billDetails.advance;

  // Get the main table (first one)
  const mainTable = tables[0];

  const addRow = () => {
    if (!mainTable) return;
    const newRowNum = mainTable.rows.length + 1;
    const newRow = {
      id: makeId("row"),
      cells: {
        sr: String(newRowNum),
        particulars: "",
        amount: "0"
      }
    };
    const updatedTable = { ...mainTable, rows: [...mainTable.rows, newRow] };
    onTablesChange([updatedTable, ...tables.slice(1)]);
  };

  const deleteRow = (rowIndex: number) => {
    if (!mainTable || mainTable.rows.length <= 1) return;
    const newRows = mainTable.rows.filter((_, i) => i !== rowIndex);
    // Re-number the rows
    const renumberedRows = newRows.map((row, i) => ({
      ...row,
      cells: { ...row.cells, sr: String(i + 1) }
    }));
    const updatedTable = { ...mainTable, rows: renumberedRows };
    onTablesChange([updatedTable, ...tables.slice(1)]);
  };

  const updateCell = (rowIndex: number, colId: string, value: string) => {
    if (!mainTable) return;
    const newRows = mainTable.rows.map((row, i) => {
      if (i === rowIndex) {
        return { ...row, cells: { ...row.cells, [colId]: value } };
      }
      return row;
    });
    const updatedTable = { ...mainTable, rows: newRows };
    onTablesChange([updatedTable, ...tables.slice(1)]);
  };

  return (
    <div className="professionalBillEditor">
      {/* Header Section - Fixed Template */}
      <div className="billSection headerSection">
        <div className="sectionHeader">
          <h3>📋 Business Header (Template)</h3>
          <button 
            className="miniButton" 
            onClick={() => setShowHeaderSettings(!showHeaderSettings)}
            title="Edit header template"
          >
            <Settings size={16} />
          </button>
        </div>
        
        {showHeaderSettings && (
          <div className="headerSettings">
            <label>
              Business Name
              <input
                type="text"
                value={header.businessName}
                onChange={(e) => onHeaderChange({ ...header, businessName: e.target.value })}
              />
            </label>
            <label>
              Phone Number
              <input
                type="text"
                value={header.phone}
                onChange={(e) => onHeaderChange({ ...header, phone: e.target.value })}
              />
            </label>
            <label>
              Address
              <input
                type="text"
                value={header.address}
                onChange={(e) => onHeaderChange({ ...header, address: e.target.value })}
              />
            </label>
            <label>
              Tagline / Services
              <textarea
                value={header.tagline || ""}
                onChange={(e) => onHeaderChange({ ...header, tagline: e.target.value })}
                placeholder="Specialist In All Interiors Works..."
              />
            </label>
          </div>
        )}
        
        <div className="headerPreview">
          <h2>{header.businessName}</h2>
          <p>Mobile No. {header.phone}</p>
          <p>{header.address}</p>
          {header.tagline && <p className="tagline">{header.tagline}</p>}
        </div>
      </div>

      {/* Bill Details - Editable per bill */}
      <div className="billSection detailsSection">
        <h3>📝 Bill Details</h3>
        
        <div className="detailsGrid">
          <label>
            Date
            <input
              type="text"
              value={billDetails.date}
              onChange={(e) => onBillDetailsChange({ ...billDetails, date: e.target.value })}
              placeholder="DD/MM/YYYY"
            />
          </label>
          
          <label>
            Client Name (To)
            <input
              type="text"
              value={billDetails.clientName}
              onChange={(e) => onBillDetailsChange({ ...billDetails, clientName: e.target.value })}
              placeholder="e.g., Atharv Palace"
            />
          </label>
          
          <label>
            Client Address
            <input
              type="text"
              value={billDetails.clientAddress}
              onChange={(e) => onBillDetailsChange({ ...billDetails, clientAddress: e.target.value })}
              placeholder="e.g., Vile Parle East"
            />
          </label>
          
          <label className="fullWidth">
            Subject
            <input
              type="text"
              value={billDetails.subject}
              onChange={(e) => onBillDetailsChange({ ...billDetails, subject: e.target.value })}
              placeholder="Bill for Carpentry Work – Materials and Labour Charges"
            />
          </label>
        </div>
      </div>

      {/* Items Table - Editable */}
      <div className="billSection tableSection">
        <div className="sectionHeader">
          <h3>📊 Bill Items</h3>
          <button className="primaryButton compact" onClick={addRow}>
            <Plus size={16} /> Add Row
          </button>
        </div>
        
        <div className="itemsTableWrapper">
          <table className="billItemsTable">
            <thead>
              <tr>
                <th style={{ width: "60px" }}>Sr. No</th>
                <th>Particulars</th>
                <th style={{ width: "120px" }}>Amount (₹)</th>
                <th style={{ width: "50px" }}></th>
              </tr>
            </thead>
            <tbody>
              {mainTable?.rows.map((row, rowIndex) => (
                <tr key={row.id}>
                  <td>
                    <input
                      type="text"
                      value={row.cells.sr || (rowIndex + 1)}
                      onChange={(e) => updateCell(rowIndex, "sr", e.target.value)}
                      className="srInput"
                    />
                  </td>
                  <td>
                    <textarea
                      value={row.cells.particulars || ""}
                      onChange={(e) => updateCell(rowIndex, "particulars", e.target.value)}
                      className="particularsInput"
                      placeholder="Enter item description..."
                      rows={2}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      value={row.cells.amount || "0"}
                      onChange={(e) => updateCell(rowIndex, "amount", e.target.value)}
                      className="amountInput"
                    />
                  </td>
                  <td>
                    <button 
                      className="miniButton danger" 
                      onClick={() => deleteRow(rowIndex)}
                      disabled={mainTable.rows.length <= 1}
                      title="Delete row"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Totals Section */}
        <div className="totalsSection">
          <div className="totalRow">
            <span>Total</span>
            <span className="totalValue">₹ {total.toLocaleString('en-IN')}</span>
          </div>
          <div className="totalRow">
            <span>Advance</span>
            <input
              type="number"
              value={billDetails.advance}
              onChange={(e) => onBillDetailsChange({ ...billDetails, advance: parseFloat(e.target.value) || 0 })}
              className="advanceInput"
            />
          </div>
          <div className="totalRow balanceRow">
            <span>Balance</span>
            <span className="balanceValue">₹ {balance.toLocaleString('en-IN')}</span>
          </div>
        </div>
      </div>

      {/* Optional Sections */}
      <div className="billSection optionalSection">
        <h3>⚙️ Optional Sections</h3>
        
        <div className="optionToggles">
          <label className="toggleOption">
            <input
              type="checkbox"
              checked={billDetails.showNote}
              onChange={(e) => onBillDetailsChange({ ...billDetails, showNote: e.target.checked })}
            />
            {billDetails.showNote ? <Eye size={16} /> : <EyeOff size={16} />}
            <span>Show Note</span>
          </label>
          
          <label className="toggleOption">
            <input
              type="checkbox"
              checked={billDetails.showSignature}
              onChange={(e) => onBillDetailsChange({ ...billDetails, showSignature: e.target.checked })}
            />
            {billDetails.showSignature ? <Eye size={16} /> : <EyeOff size={16} />}
            <span>Show Signature</span>
          </label>
        </div>

        {billDetails.showNote && (
          <label>
            Note
            <textarea
              value={billDetails.note}
              onChange={(e) => onBillDetailsChange({ ...billDetails, note: e.target.value })}
              placeholder="GST 18% will be provided by the client."
              rows={2}
            />
          </label>
        )}

        {billDetails.showSignature && (
          <label>
            Proprietor Name
            <input
              type="text"
              value={billDetails.proprietorName}
              onChange={(e) => onBillDetailsChange({ ...billDetails, proprietorName: e.target.value })}
              placeholder="Mr. Dharmendra Vishwakarma"
            />
          </label>
        )}
      </div>
    </div>
  );
}
