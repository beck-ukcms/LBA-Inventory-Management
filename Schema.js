/**
 * Schema.gs
 * LBA Bingo Inventory schema v1
 *
 * This module permanently defines, initializes, and validates the v1 schema.
 * It requires the Advanced Google Sheets service (Sheets API v4):
 * Apps Script editor > Services > + > Google Sheets API > Add.
 *
 * IMPORTANT:
 * - initializeInventoryWorkbook() is intended for a new/blank workbook.
 * - It will not overwrite an existing schema sheet.
 * - Do not rerun initialization against a live inventory workbook.
 * - Use future migration functions for structural changes after go-live.
 */

const INVENTORY_SCHEMA_V1 = Object.freeze({
  version: '1',
  tableRows: 500,

  sheets: Object.freeze({
    Dashboard: {
      tableName: null,
      headers: [],
      widths: [],
    },

    PT_Catalog: {
      tableName: 'PT_Catalog_Table',
      headers: [
        'PT_Game_ID',
        'Game_Name',
        'Game_Type',
        'Primary_Form_Number',
        'Alternate_Form_Numbers',
        'Active',
        'Display_Order',
        'Cards_Per_Deal',
        'Deals_Per_Case',
        'Price_Per_Card',
        'Payout_Per_Deal',
        'Manufacturer_Cost_Per_Deal',
        'Gross_Receipts_Per_Deal',
        'Gaming_Income_Before_Cost',
        'Net_Income_Per_Deal',
        'Net_Income_Per_Patron_Dollar',
        'Manufacturer_Cost_Per_Patron_Dollar',
        'Manufacturer_Cost_Per_Case',
        'Target_On_Hand',
        'Target_Bundled',
        'Notes',
        'Qty_Unbundled',
        'Qty_Bundled',
        'Qty_Open',
        'Qty_On_Hand',
        'Balance_Updated_At',
      ],
      widths: [110, 180, 110, 145, 190, 75, 95, 110, 110, 105, 120, 150, 145, 165, 135, 175, 210, 165, 120, 120, 240, 110, 110, 95, 110, 155],
      dropdowns: {
        Game_Type: ['Daub', 'Horse Race', 'Under Seal', 'Mixed', 'Other'],
      },
      checkboxes: ['Active'],
      integers: ['Display_Order', 'Cards_Per_Deal', 'Deals_Per_Case', 'Target_On_Hand', 'Target_Bundled', 'Qty_Unbundled', 'Qty_Bundled', 'Qty_Open', 'Qty_On_Hand'],
      decimals: [],
      currency: ['Price_Per_Card', 'Payout_Per_Deal', 'Manufacturer_Cost_Per_Deal', 'Gross_Receipts_Per_Deal', 'Gaming_Income_Before_Cost', 'Net_Income_Per_Deal', 'Manufacturer_Cost_Per_Case'],
      percent: ['Net_Income_Per_Patron_Dollar', 'Manufacturer_Cost_Per_Patron_Dollar'],
      timestamps: ['Balance_Updated_At'],
      // Catalog-derived fields are materialized by Catalog.js.
      // They are stored values, not worksheet formulas.
      formulas: {},
    },

    Paper_Catalog: {
      tableName: 'Paper_Catalog_Table',
      headers: [
        'Paper_ID',
        'Short_Name',
        'Description',
        'Active',
        'Display_Order',
        'Packs_Per_Box',
        'Boxes_Per_Case',
        'Packs_Per_Case',
        'Manufacturer_Cost_Per_Case',
        'Manufacturer_Cost_Per_Pack',
        'Sales_Price_Per_Pack',
        'Net_Income_Per_Pack',
        'Net_Income_Per_Patron_Dollar',
        'Manufacturer_Cost_Per_Patron_Dollar',
        'Target_On_Hand',
        'Notes',
        'Qty_On_Hand',
        'Balance_Updated_At',
      ],
      widths: [95, 115, 210, 75, 95, 110, 115, 115, 165, 165, 135, 135, 175, 210, 120, 240, 110, 155],
      dropdowns: {},
      checkboxes: ['Active'],
      integers: ['Display_Order', 'Boxes_Per_Case', 'Packs_Per_Case', 'Target_On_Hand'],
      decimals: ['Packs_Per_Box'],
      currency: ['Manufacturer_Cost_Per_Case', 'Manufacturer_Cost_Per_Pack', 'Sales_Price_Per_Pack', 'Net_Income_Per_Pack'],
      percent: ['Net_Income_Per_Patron_Dollar', 'Manufacturer_Cost_Per_Patron_Dollar'],
      timestamps: ['Balance_Updated_At'],
      // Catalog-derived fields are materialized by Catalog.js.
      // They are stored values, not worksheet formulas.
      formulas: {},
    },

    PT_Deals: {
      tableName: 'PT_Deals_Table',
      headers: [
        'PT_Deal_ID',
        'PT_Game_ID',
        'Form_Number',
        'Serial_Number',
        'Received_Date',
        'Deal_Status',
        'Bundled_Date',
        'Expended_Date',
        'Expended_Session_ID',
        'Notes',
      ],
      widths: [115, 105, 135, 135, 110, 115, 110, 115, 165, 240],
      dropdowns: {
        Deal_Status: ['Unbundled', 'Bundled', 'Open', 'Sold', 'Damaged', 'Returned', 'Destroyed', 'Missing'],
      },
      checkboxes: [], integers: [], decimals: [], currency: [], percent: [], formulas: {},
      dates: ['Received_Date', 'Bundled_Date', 'Expended_Date'],
    },

    Paper_Cases: {
      tableName: 'Paper_Cases_Table',
      headers: [
        'Paper_Case_ID',
        'Paper_ID',
        'Serial_Number',
        'Received_Date',
        'Case_Status',
        'Opened_Date',
        'Expended_Date',
        'Notes',
        'Current_Packs',
        'Balance_Updated_At',
      ],
      widths: [125, 95, 140, 110, 110, 110, 115, 240, 110, 155],
      dropdowns: {
        Case_Status: ['Unopened', 'Opened', 'Expended', 'Missing'],
      },
      checkboxes: [], integers: ['Current_Packs'], decimals: [], currency: [], percent: [], formulas: {},
      dates: ['Received_Date', 'Opened_Date', 'Expended_Date'],
      timestamps: ['Balance_Updated_At'],
    },

    Transactions: {
      tableName: 'Transactions_Table',
      headers: [
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
        'Notes',
      ],
      widths: [125, 110, 155, 105, 105, 125, 135, 135, 145, 120, 85, 150, 205, 155, 260],
      dropdowns: {
        Inventory_Type: ['PT', 'Paper', 'System'],
        Transaction_Type: ['Initial Inventory', 'Received', 'Bundled', 'Opened', 'Sold', 'Adjustment', 'Returned', 'Destroyed', 'Session Processing Started', 'Session Processed', 'Session Processing Failed'],
        Unit: ['Deal', 'Pack', 'Session'],
        Source: ['Initialization', 'Session Paperwork Processing', 'Inventory Ordering', 'PT Processing', 'Inventory Reconciliation', 'Admin Manual'],
      },
      checkboxes: [],
      integers: ['Quantity_Change'],
      decimals: [], currency: [], percent: [], formulas: {},
      dates: ['Effective_Date'],
      timestamps: ['Timestamp'],
    },

    Inventory_Issues: {
      tableName: 'Inventory_Issues_Table',
      headers: [
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
        'Notes',
        'Resolved_At',
        'Resolution_Notes',
      ],
      widths: [115, 155, 100, 175, 105, 125, 135, 135, 150, 135, 140, 150, 100, 155, 280, 155, 300],
      dropdowns: {
        Inventory_Type: ['PT', 'Paper'],
        Issue_Type: ['Unknown Serial', 'Insufficient Inventory', 'Paper Type Mismatch', 'Unknown Deal', 'Duplicate Sale', 'Form Mismatch', 'Unavailable Deal', 'Unexpected Deal'],
        Status: ['Open', 'Resolved', 'Dismissed'],
      },
      checkboxes: [],
      integers: ['Expected_Quantity', 'Reported_Quantity', 'Discrepancy_Amount'],
      decimals: [], currency: [], percent: [], formulas: {},
      timestamps: ['Timestamp', 'Resolved_At'],
    },

    Reconciliation_Records: {
      tableName: 'Reconciliation_Records_Table',
      headers: [
        'Reconciliation_ID',
        'Timestamp',
        'Inventory_Type',
        'Product_ID',
        'Item_ID',
        'Form_Number',
        'Serial_Number',
        'Reconciliation_Type',
        'Expected_Quantity',
        'Observed_Quantity',
        'Correction_Amount',
        'Observed_PT_Status',
        'Issue_ID',
        'Correction_Transaction_ID',
        'Notes',
      ],
      widths: [145, 155, 100, 105, 125, 135, 135, 165, 135, 135, 135, 150, 115, 190, 280],
      dropdowns: {
        Inventory_Type: ['PT', 'Paper'],
        Reconciliation_Type: ['Inventory Check', 'Paperwork Adjustment', 'Other'],
        Observed_PT_Status: ['Unbundled', 'Bundled', 'Open', 'Sold', 'Damaged', 'Returned', 'Destroyed', 'Missing'],
      },
      checkboxes: [],
      integers: ['Expected_Quantity', 'Observed_Quantity', 'Correction_Amount'],
      decimals: [], currency: [], percent: [], formulas: {},
      timestamps: ['Timestamp'],
    },

    Settings: {
      tableName: 'Settings_Table',
      headers: ['Setting', 'Value', 'Description'],
      widths: [245, 390, 420],
      dropdowns: {}, checkboxes: [], integers: [], decimals: [], currency: [], percent: [], formulas: {},
      initialRows: [
        ['Schema_Version', '1', 'Current inventory workbook schema version.'],
        ['Inventory_Admin', 'bingo@lafayetteband.org', 'Administrative account for the LBA Bingo inventory system.'],
        ['Inventory_Start_Date', '', 'Go-live date for automated inventory tracking.'],
        ['Default_Usage_Window', '10', 'Default number of recent sessions used for moving usage averages.'],
        ['SignIn_Spreadsheet_ID', '1mUkoA8XtHxVlr_IupvCz4fMx7ejsGug6ior_onF4qa8', 'Spreadsheet used by the volunteer Sign-In system.'],
        ['SignInSessions_Sheet_Name', 'Sessions', 'Session-registry sheet in the Sign-In spreadsheet.'],
        ['Archive_Parent_Folder_ID', '1YjU8UpNcbSW7EkUrI0THzhhftHvHLTNe', 'Parent folder containing quarterly fiscal-year archive subfolders.'],
        ['Archive_Subfolder_Scheme', 'Q#FY##', 'Quarterly fiscal-year archive folder naming scheme, for example Q4FY26.'],
        ['Thursday_Paperwork_Folder_ID', '', 'Active Thursday session-paperwork folder.'],
        ['Friday_Paperwork_Folder_ID', '', 'Active Friday session-paperwork folder.'],
        ['Sunday_Paperwork_Folder_ID', '', 'Active Sunday session-paperwork folder.'],
        ['Paperwork_Template_Folder_ID', '', 'Folder containing Bingo paperwork templates.'],
      ],
    },
  }),
});

/**
 * Creates the complete v1 inventory workbook schema in the bound spreadsheet.
 * Safe initialization: aborts rather than overwriting any existing schema sheet.
 */
function initializeInventoryWorkbook() {
  assertAdvancedSheetsService_();

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('No active spreadsheet. Run this function from the bound inventory workbook.');

  const schemaNames = Object.keys(INVENTORY_SCHEMA_V1.sheets);
  const existingSchemaSheets = schemaNames.filter(name => ss.getSheetByName(name));
  if (existingSchemaSheets.length) {
    throw new Error(
      'Initialization stopped. These schema sheets already exist: ' + existingSchemaSheets.join(', ') +
      '. Do not rerun initialization against an existing inventory workbook.'
    );
  }

  const existingSheets = ss.getSheets();
  const reusableBlankSheet = existingSheets.length === 1 && isSheetBlank_(existingSheets[0])
    ? existingSheets[0]
    : null;

  const created = [];
  try {
    schemaNames.forEach((name, index) => {
      let sheet;
      if (index === 0 && reusableBlankSheet) {
        sheet = reusableBlankSheet;
        sheet.setName(name);
      } else {
        sheet = ss.insertSheet(name);
      }
      created.push(sheet);
      initializeOneSheet_(sheet, name, INVENTORY_SCHEMA_V1.sheets[name]);
    });

    ss.setActiveSheet(ss.getSheetByName('Dashboard'));
    SpreadsheetApp.flush();

    createNativeTables_();
    applyCalculatedColumns_();
    SpreadsheetApp.flush();

    const report = validateInventorySchemaV1(false);
    if (!report.valid) {
      throw new Error('Initialization completed but validation failed:\n' + report.errors.join('\n'));
    }

    tryShowSchemaDialog_('LBA Bingo Inventory', 'Schema v1 was initialized and validated successfully.');
    return report;
  } catch (error) {
    throw new Error('Inventory schema initialization failed: ' + error.message);
  }
}

/**
 * Validates the workbook against schema v1 without changing data.
 * @param {boolean=} showDialog Whether to show a summary dialog. Defaults to true.
 * @return {{valid:boolean, version:string, errors:string[], warnings:string[]}}
 */
/**
 * Repairs v1 validation/format rules on an already initialized workbook.
 * This is safe for the validation failure seen after native Table creation;
 * it does not recreate sheets or alter inventory records.
 */
function repairInventorySchemaV1Validation() {
  rebuildNativeTablesWithTypedColumns_();
  restoreMissingV1Settings_();
  applyCalculatedColumns_();
  SpreadsheetApp.flush();
  return validateInventorySchemaV1(false);
}

function validateInventorySchemaV1(showDialog = true) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const errors = [];
  const warnings = [];

  Object.entries(INVENTORY_SCHEMA_V1.sheets).forEach(([sheetName, definition]) => {
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      errors.push(`Missing sheet: ${sheetName}`);
      return;
    }

    if (definition.headers.length) {
      const actual = sheet.getRange(1, 1, 1, definition.headers.length).getDisplayValues()[0];
      definition.headers.forEach((expected, i) => {
        if (actual[i] !== expected) {
          errors.push(`${sheetName}: expected header ${expected} in column ${i + 1}; found ${actual[i] || '(blank)'}.`);
        }
      });

      const extraHeader = sheet.getRange(1, definition.headers.length + 1).getDisplayValue();
      if (extraHeader) warnings.push(`${sheetName}: unexpected extra header after the defined v1 columns: ${extraHeader}.`);

      validateConfiguredColumns_(sheet, sheetName, definition, errors, warnings);
    }
  });

  validateSettings_(ss, errors, warnings);
  validateNativeTables_(ss, errors, warnings);

  const report = {
    valid: errors.length === 0,
    version: INVENTORY_SCHEMA_V1.version,
    errors,
    warnings,
  };

  console.log(JSON.stringify(report, null, 2));

  if (showDialog) {
    const title = report.valid ? 'Schema v1 validation passed' : 'Schema v1 validation failed';
    const body = [
      report.valid ? 'No schema errors were found.' : `${errors.length} error(s) were found.`,
      warnings.length ? `${warnings.length} warning(s) were found.` : 'No warnings were found.',
      '',
      errors.slice(0, 12).join('\n'),
      errors.length > 12 ? `\n...and ${errors.length - 12} more error(s). See the execution log.` : '',
      warnings.length ? '\nWarnings:\n' + warnings.slice(0, 8).join('\n') : '',
    ].join('\n');
    tryShowSchemaDialog_(title, body);
  }

  return report;
}

function initializeOneSheet_(sheet, sheetName, definition) {
  sheet.clear();
  sheet.clearConditionalFormatRules();

  if (sheetName === 'Dashboard') {
    sheet.getRange('A1').setValue('LBA Bingo Inventory Dashboard')
      .setFontSize(18).setFontWeight('bold').setFontColor('#ffffff').setBackground('#1f4e78');
    sheet.getRange('A3').setValue('Dashboard formulas and layout will be added after catalog and opening inventory data are established.')
      .setFontStyle('italic').setFontColor('#666666');
    sheet.setColumnWidth(1, 820);
    sheet.setFrozenRows(1);
    sheet.setTabColor('#1f4e78');
    return;
  }

  const headers = definition.headers;
  ensureSheetSize_(sheet, INVENTORY_SCHEMA_V1.tableRows, Math.max(headers.length, 3));
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length)
    .setFontWeight('bold')
    .setFontColor('#ffffff')
    .setBackground('#1f4e78')
    .setHorizontalAlignment('center')
    .setWrap(true);
  sheet.setFrozenRows(1);
  sheet.setTabColor(sheetName.includes('Catalog') ? '#6aa84f' : sheetName === 'Settings' ? '#999999' : '#3d85c6');

  definition.widths.forEach((width, i) => sheet.setColumnWidth(i + 1, width));
  sheet.getRange(2, 1, INVENTORY_SCHEMA_V1.tableRows - 1, headers.length).setVerticalAlignment('middle');

  applyDefinitionValidation_(sheet, definition);
  applyDefinitionFormats_(sheet, definition);

  if (definition.initialRows && definition.initialRows.length) {
    sheet.getRange(2, 1, definition.initialRows.length, definition.headers.length).setValues(definition.initialRows);
  }
}

function applyDefinitionValidation_(sheet, definition) {
  const totalDataRows = INVENTORY_SCHEMA_V1.tableRows - 1;

  Object.entries(definition.dropdowns || {}).forEach(([header, options]) => {
    const col = columnIndex_(definition.headers, header);
    if (!col) return;
    const rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(options, true)
      .setAllowInvalid(false)
      .setHelpText(`Choose one of: ${options.join(', ')}`)
      .build();
    sheet.getRange(2, col, totalDataRows, 1).setDataValidation(rule);
  });

  (definition.checkboxes || []).forEach(header => {
    const col = columnIndex_(definition.headers, header);
    if (col) sheet.getRange(2, col, totalDataRows, 1).insertCheckboxes();
  });

  (definition.integers || []).forEach(header => {
    const col = columnIndex_(definition.headers, header);
    if (!col) return;
    const range = sheet.getRange(2, col, totalDataRows, 1);
    const rule = SpreadsheetApp.newDataValidation()
      .requireFormulaSatisfied(`=OR(${range.getCell(1, 1).getA1Notation()}="",AND(ISNUMBER(${range.getCell(1, 1).getA1Notation()}),MOD(${range.getCell(1, 1).getA1Notation()},1)=0))`)
      .setAllowInvalid(false)
      .setHelpText('Enter a whole number. Transaction quantities must always be integers.')
      .build();
    range.setDataValidation(rule);
  });
}

function applyDefinitionFormats_(sheet, definition) {
  const rows = INVENTORY_SCHEMA_V1.tableRows - 1;
  formatColumns_(sheet, definition, definition.integers || [], '0', rows);
  formatColumns_(sheet, definition, definition.decimals || [], '0.0###', rows);
  formatColumns_(sheet, definition, definition.currency || [], '$#,##0.00', rows);
  formatColumns_(sheet, definition, definition.percent || [], '0.00%', rows);
  formatColumns_(sheet, definition, definition.dates || [], 'm/d/yyyy', rows);
  formatColumns_(sheet, definition, definition.timestamps || [], 'm/d/yyyy h:mm:ss am/pm', rows);
}

function formatColumns_(sheet, definition, headers, format, rows) {
  headers.forEach(header => {
    const col = columnIndex_(definition.headers, header);
    if (col) sheet.getRange(2, col, rows, 1).setNumberFormat(format);
  });
}

function applyCalculatedColumns_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.entries(INVENTORY_SCHEMA_V1.sheets).forEach(([sheetName, definition]) => {
    if (!definition.formulas) return;
    const sheet = ss.getSheetByName(sheetName);
    Object.entries(definition.formulas).forEach(([header, formula]) => {
      const col = columnIndex_(definition.headers, header);
      if (col) sheet.getRange(2, col).setFormula(formula);
    });
  });
}

function createNativeTables_() {
  addNativeTablesWithTypedColumns_(false);
}

function rebuildNativeTablesWithTypedColumns_() {
  addNativeTablesWithTypedColumns_(true);
}

function addNativeTablesWithTypedColumns_(replaceExisting) {
  assertAdvancedSheetsService_();
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  if (replaceExisting) {
    const current = Sheets.Spreadsheets.get(ss.getId(), {includeGridData: false});
    const deleteRequests = [];
    (current.sheets || []).forEach(apiSheet => {
      (apiSheet.tables || []).forEach(table => {
        deleteRequests.push({deleteTable: {tableId: table.tableId}});
      });
    });
    if (deleteRequests.length) {
      Sheets.Spreadsheets.batchUpdate({requests: deleteRequests}, ss.getId());
    }
  }

  const requests = [];
  Object.entries(INVENTORY_SCHEMA_V1.sheets).forEach(([sheetName, definition]) => {
    if (!definition.tableName || !definition.headers.length) return;
    const sheet = ss.getSheetByName(sheetName);
    const rowCount = Math.max(definition.initialRows ? definition.initialRows.length + 2 : 20, 20);
    const columnProperties = buildTableColumnProperties_(definition);
    requests.push({
      addTable: {
        table: {
          name: definition.tableName,
          range: {
            sheetId: sheet.getSheetId(),
            startRowIndex: 0,
            endRowIndex: rowCount,
            startColumnIndex: 0,
            endColumnIndex: definition.headers.length,
          },
          columnProperties: columnProperties,
        },
      },
    });
  });
  if (requests.length) Sheets.Spreadsheets.batchUpdate({requests}, ss.getId());
}

function buildTableColumnProperties_(definition) {
  return definition.headers.map((header, zeroBasedIndex) => {
    const property = {
      columnIndex: zeroBasedIndex,
      columnName: header,
    };
    if ((definition.dropdowns || {})[header]) {
      property.columnType = 'DROPDOWN';
      property.dataValidationRule = {
        condition: {
          type: 'ONE_OF_LIST',
          values: definition.dropdowns[header].map(value => ({userEnteredValue: value})),
        },
      };
    } else if ((definition.checkboxes || []).includes(header)) {
      // The Sheets REST API does not currently accept CHECKBOX as a
      // TableColumnProperties ColumnType. Leave the native table column
      // untyped, then ordinary checkbox validation is applied only to
      // cells OUTSIDE the native table range by Apps Script. For Active
      // catalog fields, TRUE/FALSE values remain valid in the table itself.
    }
    return property;
  });
}

function validateConfiguredColumns_(sheet, sheetName, definition, errors, warnings) {
  Object.keys(definition.formulas || {}).forEach(header => {
    const col = columnIndex_(definition.headers, header);
    if (!sheet.getRange(2, col).getFormula()) {
      errors.push(`${sheetName}.${header}: missing calculated-column formula in row 2.`);
    }
  });
}

function restoreMissingV1Settings_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Settings');
  if (!sheet) throw new Error('Missing required sheet: Settings');

  const lastRow = sheet.getLastRow();
  const existingValues = lastRow > 1
    ? sheet.getRange(2, 1, lastRow - 1, 3).getValues()
    : [];
  const existing = new Set(existingValues.filter(row => row[0]).map(row => String(row[0])));
  const missing = INVENTORY_SCHEMA_V1.sheets.Settings.initialRows.filter(row => !existing.has(row[0]));

  if (missing.length) {
    const startRow = Math.max(sheet.getLastRow() + 1, 2);
    sheet.getRange(startRow, 1, missing.length, 3).setValues(missing);
  }
}

function validateSettings_(ss, errors, warnings) {
  const sheet = ss.getSheetByName('Settings');
  if (!sheet) return;

  const dataRowCount = Math.max(0, sheet.getLastRow() - 1);
  const values = dataRowCount > 0
    ? sheet.getRange(2, 1, dataRowCount, 2).getDisplayValues()
    : [];
  const settings = Object.fromEntries(values.filter(row => row[0]).map(row => [row[0], row[1]]));

  const required = INVENTORY_SCHEMA_V1.sheets.Settings.initialRows.map(row => row[0]);
  required.forEach(key => {
    if (!(key in settings)) errors.push(`Settings: missing required setting ${key}.`);
  });

  if (settings.Schema_Version !== INVENTORY_SCHEMA_V1.version) {
    errors.push(`Settings.Schema_Version: expected ${INVENTORY_SCHEMA_V1.version}; found ${settings.Schema_Version || '(blank)'}.`);
  }

  ['Inventory_Start_Date', 'Thursday_Paperwork_Folder_ID', 'Friday_Paperwork_Folder_ID', 'Sunday_Paperwork_Folder_ID', 'Paperwork_Template_Folder_ID']
    .forEach(key => {
      if (key in settings && !settings[key]) warnings.push(`Settings.${key} is currently blank.`);
    });
}

function validateNativeTables_(ss, errors, warnings) {
  try {
    assertAdvancedSheetsService_();
    const response = Sheets.Spreadsheets.get(ss.getId(), {includeGridData: false});
    const found = new Set();
    (response.sheets || []).forEach(apiSheet => {
      (apiSheet.tables || []).forEach(table => found.add(table.name));
    });

    Object.values(INVENTORY_SCHEMA_V1.sheets).forEach(definition => {
      if (definition.tableName && !found.has(definition.tableName)) {
        errors.push(`Missing native Google Sheets table: ${definition.tableName}.`);
      }
    });
  } catch (error) {
    warnings.push('Native table validation could not run: ' + error.message);
  }
}

function tryShowSchemaDialog_(title, body) {
  try {
    const ui = SpreadsheetApp.getUi();
    ui.alert(title, body, ui.ButtonSet.OK);
  } catch (error) {
    console.log(`${title}: ${body}`);
  }
}

function assertAdvancedSheetsService_() {
  if (typeof Sheets === 'undefined' || !Sheets.Spreadsheets) {
    throw new Error(
      'The Advanced Google Sheets service is not enabled. In Apps Script, open Services, click +, add Google Sheets API, and rerun.'
    );
  }
}

function columnIndex_(headers, header) {
  const index = headers.indexOf(header);
  return index < 0 ? 0 : index + 1;
}

function ensureSheetSize_(sheet, rows, columns) {
  if (sheet.getMaxRows() < rows) sheet.insertRowsAfter(sheet.getMaxRows(), rows - sheet.getMaxRows());
  if (sheet.getMaxColumns() < columns) sheet.insertColumnsAfter(sheet.getMaxColumns(), columns - sheet.getMaxColumns());
}

function isSheetBlank_(sheet) {
  return sheet.getLastRow() === 1 && sheet.getLastColumn() === 1 && sheet.getRange('A1').isBlank();
}
