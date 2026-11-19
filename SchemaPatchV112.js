/**
 * One-time V1.12 transaction dropdown update.
 */
function applySchemaV112Patch() {
  const sheet = getSheetOrThrow_('Transactions');
  const table = getNativeTableForSheet_(sheet);

  if (!table) {
    throw new Error('Transactions native Table was not found.');
  }

  const updatedTable = JSON.parse(JSON.stringify(table));
  const columns = updatedTable.columnProperties || [];

  const dropdowns = {
    Inventory_Type: ['PT', 'Paper', 'System'],
    Transaction_Type: [
      'Initial Inventory',
      'Received',
      'Bundled',
      'Opened',
      'Sold',
      'Adjustment',
      'Returned',
      'Destroyed',
      'Session Processing Started',
      'Session Processed',
      'Session Processing Failed'
    ],
    Unit: ['Deal', 'Pack', 'Session'],
    Source: [
      'Inventory Reconciliation',
      'Inventory Ordering',
      'Session Paperwork Processing',
      'PT Processing',
      'Paper Processing',
      'Admin Manual'
    ]
  };

  columns.forEach((column) => {
    const values = dropdowns[column.columnName];

    if (!values) {
      return;
    }

    column.columnType = 'DROPDOWN';
    column.dataValidationRule = {
      condition: {
        type: 'ONE_OF_LIST',
        values: values.map((value) => {
          return { userEnteredValue: value };
        })
      }
    };
  });

  Sheets.Spreadsheets.batchUpdate(
    {
      requests: [
        {
          updateTable: {
            table: updatedTable,
            fields: 'columnProperties'
          }
        }
      ]
    },
    getInventorySpreadsheet_().getId()
  );

  return {
    ok: true,
    version: '1.12'
  };
}
