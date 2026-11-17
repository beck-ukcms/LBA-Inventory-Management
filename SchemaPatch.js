/**
 * Pre-production schema patch for Inventory Management v1.2.
 *
 * This version is safe when a previous patch attempt removed the contents of
 * Transactions or Inventory_Issues while replacing their native Sheets tables.
 *
 * Run applySchemaV12Patch() once before recording inventory transactions.
 */

function applySchemaV12Patch() {
  ensureV12LedgerHeaders_();

  const transactions = getRecords_('Transactions');

  if (transactions.length > 0) {
    throw new Error(
      'The V1.2 pre-production patch requires an empty Transactions sheet.'
    );
  }

  ensureApplicationSettings();

  upsertV12Setting_(
    'App_Version',
    '1.2',
    'Current integrated application version.'
  );

  rebuildV12TypedTables_();

  return {
    ok: true,
    version: '1.2'
  };
}


/**
 * Restores the two table headers touched by the V1.2 patch if a previous
 * failed patch attempt left either sheet blank.
 *
 * This is intentionally limited to empty sheets so existing data cannot be
 * overwritten accidentally.
 */
function ensureV12LedgerHeaders_() {
  const requiredHeaders = {
    Transactions: [
      'Transaction_ID',
      'Effective_Date',
      'Timestamp',
      'Inventory_Type',
      'Product_ID',
      'Item_ID',
      'Form_Number',
      'Serial_Number',
      'Transaction_Type',
      'Quantity_Change',
      'Unit',
      'Session_ID',
      'Source',
      'Reconciliation_ID',
      'Notes'
    ],

    Inventory_Issues: [
      'Issue_ID',
      'Timestamp',
      'Inventory_Type',
      'Issue_Type',
      'Product_ID',
      'Item_ID',
      'Form_Number',
      'Serial_Number',
      'Session_ID',
      'Expected_Quantity',
      'Reported_Quantity',
      'Discrepancy_Amount',
      'Status',
      'Reconciliation_ID',
      'Notes'
    ]
  };

  Object.entries(requiredHeaders).forEach(([sheetName, headers]) => {
    const sheet = getSheetOrThrow_(sheetName);

    if (sheet.getLastColumn() === 0 || sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      return;
    }

    const existingHeaders = sheet
      .getRange(1, 1, 1, Math.min(sheet.getLastColumn(), headers.length))
      .getDisplayValues()[0];

    const sheetHasContent = existingHeaders.some((value) => value !== '');

    if (!sheetHasContent) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    }
  });

  SpreadsheetApp.flush();
}


function upsertV12Setting_(name, value, description) {
  const existing = getRecords_('Settings').find(
    (record) => String(record.Setting) === name
  );

  if (existing) {
    updateRecordRow_('Settings', existing._rowNumber, {
      Value: value,
      Description: description
    });
    return;
  }

  appendRecord_('Settings', {
    Setting: name,
    Value: value,
    Description: description
  });
}


/**
 * Rebuilds only the Transactions and Inventory_Issues native Tables.
 *
 * Google Sheets DeleteTableRequest deletes the table contents as well as the
 * table object. Therefore this routine captures the header row BEFORE deleting
 * each table, immediately restores the headers, and only operates while the
 * pre-production Transactions ledger is empty.
 */
function rebuildV12TypedTables_() {
  const spreadsheet = getInventorySpreadsheet_();

  const tableDefinitions = {
    Transactions_Table: {
      sheetName: 'Transactions',
      dropdowns: {
        Inventory_Type: ['PT', 'Paper'],
        Transaction_Type: [
          'Initial Inventory',
          'Received',
          'Bundled',
          'Opened',
          'Sold',
          'Adjustment',
          'Returned',
          'Destroyed'
        ],
        Unit: ['Deal', 'Pack'],
        Source: [
          'Inventory Reconciliation',
          'Inventory Ordering',
          'Session Paperwork Processing',
          'PT Processing',
          'Paper Processing',
          'Admin Manual'
        ]
      }
    },

    Inventory_Issues_Table: {
      sheetName: 'Inventory_Issues',
      dropdowns: {
        Inventory_Type: ['PT', 'Paper'],
        Issue_Type: [
          'Unknown Serial',
          'Insufficient Inventory',
          'Paper Type Mismatch',
          'Unknown Deal',
          'Unexpected Deal',
          'Duplicate Sale',
          'Form Mismatch',
          'Unavailable Deal'
        ],
        Status: ['Open', 'Resolved', 'Dismissed']
      }
    }
  };

  const apiSpreadsheet = Sheets.Spreadsheets.get(
    spreadsheet.getId(),
    { includeGridData: false }
  );

  Object.entries(tableDefinitions).forEach(([tableName, definition]) => {
    rebuildOneV12Table_(
      spreadsheet,
      apiSpreadsheet,
      tableName,
      definition
    );
  });
}


function rebuildOneV12Table_(
  spreadsheet,
  apiSpreadsheet,
  tableName,
  definition
) {
  const sheet = getSheetOrThrow_(definition.sheetName);
  const columnCount = sheet.getLastColumn();

  if (columnCount < 1) {
    throw new Error(
      `${definition.sheetName} has no header columns. ` +
      'Run ensureV12LedgerHeaders_() before rebuilding the table.'
    );
  }

  const headers = sheet
    .getRange(1, 1, 1, columnCount)
    .getDisplayValues()[0];

  if (headers.some((header) => !header)) {
    throw new Error(
      `${definition.sheetName} contains a blank header cell. ` +
      'The V1.2 table cannot be rebuilt safely.'
    );
  }

  const sheetApi = (apiSpreadsheet.sheets || []).find(
    (candidate) => candidate.properties.sheetId === sheet.getSheetId()
  );

  const existingTable = sheetApi
    ? (sheetApi.tables || []).find((table) => table.name === tableName)
    : null;

  if (existingTable) {
    Sheets.Spreadsheets.batchUpdate(
      {
        requests: [
          {
            deleteTable: {
              tableId: existingTable.tableId
            }
          }
        ]
      },
      spreadsheet.getId()
    );

    // DeleteTableRequest removes the table data as well. Restore the captured
    // header row immediately before creating the replacement table.
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    SpreadsheetApp.flush();
  }

  const columnProperties = headers.map((header, columnIndex) => {
    const property = {
      columnIndex: columnIndex,
      columnName: header
    };

    const dropdownValues = definition.dropdowns[header];

    if (dropdownValues) {
      property.columnType = 'DROPDOWN';
      property.dataValidationRule = {
        condition: {
          type: 'ONE_OF_LIST',
          values: dropdownValues.map((dropdownValue) => ({
            userEnteredValue: dropdownValue
          }))
        }
      };
    }

    return property;
  });

  Sheets.Spreadsheets.batchUpdate(
    {
      requests: [
        {
          addTable: {
            table: {
              name: tableName,
              range: {
                sheetId: sheet.getSheetId(),
                startRowIndex: 0,
                endRowIndex: 20,
                startColumnIndex: 0,
                endColumnIndex: headers.length
              },
              columnProperties: columnProperties
            }
          }
        }
      ]
    },
    spreadsheet.getId()
  );
}
