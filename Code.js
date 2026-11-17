/**
 * Code.gs
 * LBA Bingo Inventory Management
 * Version 1.8
 *
 * Common application infrastructure:
 * - Web-app routing
 * - HTML includes
 * - Spreadsheet access
 * - Generic record reading
 * - Native-table-aware record appending
 * - Generic row updates
 * - ID generation
 * - Common validation and normalization utilities
 */


/**
 * Serves the main Inventory Management application.
 */
function doGet() {

  const template = HtmlService.createTemplateFromFile('Index');

  template.appConfig = getPublicAppConfig_();

  return template
    .evaluate()
    .setTitle(template.appConfig.appName)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag(
      'viewport',
      'width=device-width, initial-scale=1'
    );
}


/**
 * Includes another HTML file inside a template.
 *
 * Example:
 *
 * <?!= include_('AppCommon'); ?>
 *
 * @param {string} filename Apps Script HTML filename without .html.
 * @return {string} HTML content.
 */
function include_(filename) {

  return HtmlService
    .createHtmlOutputFromFile(filename)
    .getContent();
}


/**
 * Returns the spreadsheet to which this Apps Script project is bound.
 *
 * @return {GoogleAppsScript.Spreadsheet.Spreadsheet}
 */
function getInventorySpreadsheet_() {

  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();

  if (!spreadsheet) {

    throw new Error(
      'The bound inventory spreadsheet is unavailable.'
    );
  }

  return spreadsheet;
}


/**
 * Returns a required worksheet.
 *
 * Throws an explicit error rather than allowing later code to fail
 * against a null sheet reference.
 *
 * @param {string} sheetName
 * @return {GoogleAppsScript.Spreadsheet.Sheet}
 */
function getSheetOrThrow_(sheetName) {

  const spreadsheet = getInventorySpreadsheet_();

  const sheet = spreadsheet.getSheetByName(sheetName);

  if (!sheet) {

    throw new Error(
      `Missing required sheet: ${sheetName}`
    );
  }

  return sheet;
}


/**
 * Builds a map between header names and zero-based column indices.
 *
 * Example:
 *
 * {
 *   PT_Game_ID: 0,
 *   Game_Name: 1,
 *   Game_Type: 2
 * }
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @return {Object}
 */
function getHeaderMap_(sheet) {

  const lastColumn = sheet.getLastColumn();

  if (lastColumn < 1) {

    throw new Error(
      `Sheet ${sheet.getName()} has no headers.`
    );
  }

  const headers = sheet
    .getRange(
      1,
      1,
      1,
      lastColumn
    )
    .getDisplayValues()[0];

  return Object.fromEntries(
    headers.map(
      (header, index) => [
        header,
        index
      ]
    )
  );
}


/**
 * Reads all populated records from a worksheet.
 *
 * The returned objects include _rowNumber so that a record can later
 * be updated without depending on hard-coded row positions.
 *
 * @param {string} sheetName
 * @return {Object[]}
 */
function getRecords_(sheetName) {

  const sheet = getSheetOrThrow_(sheetName);

  const lastRow = sheet.getLastRow();

  const lastColumn = sheet.getLastColumn();

  if (
    lastRow < 2 ||
    lastColumn < 1
  ) {

    return [];
  }

  const headers = sheet
    .getRange(
      1,
      1,
      1,
      lastColumn
    )
    .getDisplayValues()[0];

  const values = sheet
    .getRange(
      2,
      1,
      lastRow - 1,
      lastColumn
    )
    .getValues();

  /*
   * Every inventory data table uses column A as its permanent record ID.
   * A formula-only row is not a record when column A is blank.
   */
  return values
    .map(
      (row, rowOffset) => {

        return {
          row: row,
          rowNumber: rowOffset + 2
        };
      }
    )
    .filter(
      (entry) => {

        return normalizeText_(entry.row[0]) !== '';
      }
    )
    .map(
      (entry) => {

        const record = {
          _rowNumber: entry.rowNumber
        };

        headers.forEach(
          (header, index) => {

            record[header] = entry.row[index];
          }
        );

        return record;
      }
    );
}


/**
 * Appends a record to a worksheet using the Google Sheets API.
 *
 * VERSION 1.3 CHANGE:
 *
 * Previous versions used:
 *
 *     sheet.appendRow(row);
 *
 * That can place data below a native Google Sheets Table without
 * extending the Table range. The application could subsequently read
 * the row, but the row would not appear within the visible Table.
 *
 * This implementation uses Sheets.Spreadsheets.Values.append().
 * Google searches the supplied sheet range for its logical table and
 * appends the new row after the existing table data.
 *
 * The Advanced Google Sheets service must remain enabled.
 *
 * @param {string} sheetName
 * @param {Object} record
 * @return {number} Worksheet row number containing the appended record.
 */
function appendRecord_(sheetName, record) {

  const sheet = getSheetOrThrow_(sheetName);

  const lastColumn = sheet.getLastColumn();

  if (lastColumn < 1) {

    throw new Error(
      `Cannot append to ${sheetName}: the sheet has no header columns.`
    );
  }

  const headers = sheet
    .getRange(
      1,
      1,
      1,
      lastColumn
    )
    .getDisplayValues()[0];

  const primaryHeader = headers[0];

  const primaryValue =
    Object.prototype.hasOwnProperty.call(
      record,
      primaryHeader
    )
      ? normalizeText_(record[primaryHeader])
      : '';

  if (!primaryValue) {

    throw new Error(
      `Cannot append to ${sheetName}: ${primaryHeader} is required.`
    );
  }

  const table = getNativeTableForSheet_(sheet);

  if (!table) {

    throw new Error(
      `No native Google Sheets Table was found on ${sheetName}.`
    );
  }

  const targetRow = findFirstEmptyTableRow_(
    sheet,
    table
  );

  const rowValues = headers.map(
    (header) => {

      if (
        Object.prototype.hasOwnProperty.call(
          record,
          header
        )
      ) {

        return record[header];
      }

      return '';
    }
  );

  sheet
    .getRange(
      targetRow,
      1,
      1,
      headers.length
    )
    .setValues([rowValues]);

  SpreadsheetApp.flush();

  return targetRow;
}





/**
 * Returns the native Google Sheets Table defined on a worksheet.
 *
 * Inventory data sheets are designed to contain one native Table each.
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @return {Object|null}
 */
function getNativeTableForSheet_(sheet) {

  const spreadsheet = getInventorySpreadsheet_();

  const apiSpreadsheet = Sheets.Spreadsheets.get(
    spreadsheet.getId(),
    {
      includeGridData: false
    }
  );

  const apiSheet =
    (apiSpreadsheet.sheets || [])
      .find(
        (candidate) => {

          return (
            candidate.properties.sheetId ===
            sheet.getSheetId()
          );
        }
      );

  if (
    !apiSheet ||
    !(apiSheet.tables || []).length
  ) {

    return null;
  }

  return apiSheet.tables[0];
}


/**
 * Finds the first blank permanent-ID row inside a native Table.
 *
 * If the Table contains no empty data row, the Table is expanded by twenty
 * rows and the first newly available row is returned.
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {Object} table
 * @return {number}
 */
function findFirstEmptyTableRow_(sheet, table) {

  /*
   * GridRange indices are zero-based and endRowIndex is exclusive.
   * The worksheet's first data row is one row below the Table header.
   */
  const firstDataRow =
    table.range.startRowIndex + 2;

  const lastTableWorksheetRow =
    table.range.endRowIndex;

  const availableRows =
    lastTableWorksheetRow -
    firstDataRow +
    1;

  if (availableRows > 0) {

    const primaryIds = sheet
      .getRange(
        firstDataRow,
        1,
        availableRows,
        1
      )
      .getDisplayValues();

    const emptyOffset = primaryIds.findIndex(
      (row) => {

        return normalizeText_(row[0]) === '';
      }
    );

    if (emptyOffset >= 0) {

      return firstDataRow + emptyOffset;
    }
  }

  const expansionRows = 20;

  const firstNewWorksheetRow =
    lastTableWorksheetRow + 1;

  const expandedLastWorksheetRow =
    lastTableWorksheetRow +
    expansionRows;

  ensureSheetRowCapacity_(
    sheet,
    expandedLastWorksheetRow
  );

  resizeNativeTable_(
    table,
    expandedLastWorksheetRow
  );

  return firstNewWorksheetRow;
}


/**
 * Changes only the ending row of a native Google Sheets Table.
 *
 * @param {Object} table
 * @param {number} newEndRowIndex
 */
function resizeNativeTable_(
  table,
  newEndRowIndex
) {

  const spreadsheet = getInventorySpreadsheet_();

  const updatedTable =
    JSON.parse(
      JSON.stringify(table)
    );

  updatedTable.range.endRowIndex =
    newEndRowIndex;

  Sheets.Spreadsheets.batchUpdate(
    {
      requests: [
        {
          updateTable: {
            table: updatedTable,
            fields: 'range'
          }
        }
      ]
    },
    spreadsheet.getId()
  );
}


/**
 * Adds worksheet rows when a native Table needs additional capacity.
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {number} requiredRows
 */
function ensureSheetRowCapacity_(
  sheet,
  requiredRows
) {

  const currentRows = sheet.getMaxRows();

  if (currentRows < requiredRows) {

    sheet.insertRowsAfter(
      currentRows,
      requiredRows - currentRows
    );
  }
}

/**
 * Converts a positive column number into its A1 column letters.
 *
 * Examples:
 *
 *   1  -> A
 *   21 -> U
 *   27 -> AA
 *
 * @param {number} columnNumber
 * @return {string}
 */
function columnNumberToLetter_(columnNumber) {

  let number = Number(columnNumber);

  if (
    !Number.isInteger(number) ||
    number < 1
  ) {

    throw new Error(
      `Invalid column number: ${columnNumber}`
    );
  }

  let columnLetters = '';

  while (number > 0) {

    const remainder =
      (number - 1) % 26;

    columnLetters =
      String.fromCharCode(
        65 + remainder
      ) +
      columnLetters;

    number =
      Math.floor(
        (number - 1) / 26
      );
  }

  return columnLetters;
}


/**
 * Extracts the first worksheet row number from an A1 range.
 *
 * Examples:
 *
 *   PT_Catalog!A21:U21 -> 21
 *   'PT Catalog'!A5:U5 -> 5
 *
 * @param {string} a1Range
 * @return {number|null}
 */
function extractFirstRowNumberFromA1_(a1Range) {

  if (!a1Range) {

    return null;
  }

  const cellRange =
    String(a1Range)
      .split('!')
      .pop();

  const firstCell =
    cellRange
      .split(':')[0];

  const match =
    firstCell.match(
      /(\d+)$/
    );

  if (!match) {

    return null;
  }

  return Number(
    match[1]
  );
}


/**
 * Updates specific fields on an existing record row.
 *
 * @param {string} sheetName
 * @param {number} rowNumber
 * @param {Object} updates
 */
function updateRecordRow_(
  sheetName,
  rowNumber,
  updates
) {

  const sheet =
    getSheetOrThrow_(sheetName);

  const headerMap =
    getHeaderMap_(sheet);


  Object.entries(updates).forEach(
    ([header, value]) => {

      if (!(header in headerMap)) {

        throw new Error(
          `Unknown ${sheetName} column: ${header}`
        );
      }


      sheet
        .getRange(
          rowNumber,
          headerMap[header] + 1
        )
        .setValue(value);
    }
  );
}


/**
 * Generates a persistent unique application ID.
 *
 * Counts are maintained in Script Properties rather than being
 * calculated from worksheet contents. Deleting an old record therefore
 * cannot cause an identifier to be reused.
 *
 * Examples:
 *
 *   generateId_('PT_GAME', 'PT', 4)
 *     -> PT0001
 *
 *   generateId_('TRANSACTION', 'TX-', 7)
 *     -> TX-0000001
 *
 * @param {string} counterName
 * @param {string} prefix
 * @param {number} digits
 * @return {string}
 */
function generateId_(
  counterName,
  prefix,
  digits
) {

  const lock =
    LockService.getScriptLock();

  lock.waitLock(30000);

  try {

    const properties =
      PropertiesService.getScriptProperties();

    const propertyKey =
      `ID_COUNTER_${counterName}`;

    const currentValue =
      Number(
        properties.getProperty(
          propertyKey
        ) || 0
      );

    const nextValue =
      currentValue + 1;


    properties.setProperty(
      propertyKey,
      String(nextValue)
    );


    return (
      prefix +
      String(nextValue).padStart(
        digits,
        '0'
      )
    );

  } finally {

    lock.releaseLock();
  }
}


/**
 * Normalizes general user-entered text.
 *
 * @param {*} value
 * @return {string}
 */
function normalizeText_(value) {

  return String(
    value == null
      ? ''
      : value
  ).trim();
}


/**
 * Normalizes a PT Form Number.
 *
 * Form numbers are stored consistently in uppercase.
 *
 * @param {*} value
 * @return {string}
 */
function normalizeFormNumber_(value) {

  return normalizeText_(
    value
  ).toUpperCase();
}


/**
 * Converts the comma-separated Alternate Form Number field into a
 * normalized, de-duplicated array.
 *
 * @param {*} value
 * @return {string[]}
 */
function splitAlternateForms_(value) {

  const forms =
    normalizeText_(value)
      .split(',')
      .map(
        (formNumber) =>
          normalizeFormNumber_(
            formNumber
          )
      )
      .filter(Boolean);


  return [
    ...new Set(forms)
  ];
}


/**
 * Converts a supplied value into a validated integer.
 *
 * @param {*} value
 * @param {string} label
 * @param {Object=} options
 * @return {number}
 */
function integerOrThrow_(
  value,
  label,
  options
) {

  const number =
    Number(value);

  const allowZero =
    !options ||
    options.allowZero !== false;


  const invalidInteger =
    !Number.isInteger(number);

  const invalidPositiveValue =
    !allowZero &&
    number <= 0;

  const invalidNonnegativeValue =
    allowZero &&
    number < 0;


  if (
    invalidInteger ||
    invalidPositiveValue ||
    invalidNonnegativeValue
  ) {

    throw new Error(
      `${label} must be ` +
      `${allowZero ? 'a nonnegative' : 'a positive'} ` +
      'whole number.'
    );
  }


  return number;
}


/**
 * Converts a supplied value into a validated nonnegative number.
 *
 * @param {*} value
 * @param {string} label
 * @return {number}
 */
function numberOrThrow_(
  value,
  label
) {

  const number =
    Number(value);


  if (
    !Number.isFinite(number) ||
    number < 0
  ) {

    throw new Error(
      `${label} must be a nonnegative number.`
    );
  }


  return number;
}


/**
 * Returns the current date/time.
 *
 * Keeping this behind a common function makes later date-handling
 * changes easier and keeps business modules consistent.
 *
 * @return {Date}
 */
function now_() {

  return new Date();
}


/**
 * One-time V1.3 recovery helper.
 *
 * The first test PT game was written below the original PT_Catalog
 * native Table because the pre-V1.3 appendRecord_() used appendRow().
 *
 * This helper expands the PT_Catalog native table sufficiently to
 * include all currently populated worksheet rows.
 *
 * Run this ONCE after installing V1.3 if PT_Catalog contains a record
 * below the current native Table range.
 *
 * This helper does not move, modify, or duplicate any catalog data.
 */
function recoverPTCatalogTableRangeV13() {

  const spreadsheet =
    getInventorySpreadsheet_();

  const sheet =
    getSheetOrThrow_(
      'PT_Catalog'
    );

  const lastDataRow =
    sheet.getLastRow();


  if (lastDataRow < 2) {

    return {
      changed: false,
      message: 'PT_Catalog contains no data rows to recover.'
    };
  }


  const apiSpreadsheet =
    Sheets.Spreadsheets.get(

      spreadsheet.getId(),

      {
        includeGridData: false
      }
    );


  const apiSheet =
    (apiSpreadsheet.sheets || [])
      .find(
        (candidate) => {

          return (
            candidate.properties.sheetId ===
            sheet.getSheetId()
          );
        }
      );


  if (!apiSheet) {

    throw new Error(
      'PT_Catalog API sheet metadata could not be found.'
    );
  }


  const table =
    (apiSheet.tables || [])
      .find(
        (candidate) => {

          return (
            candidate.name ===
            'PT_Catalog_Table'
          );
        }
      );


  if (!table) {

    throw new Error(
      'PT_Catalog_Table could not be found.'
    );
  }


  /*
   * API table ranges use an exclusive endRowIndex.
   *
   * Worksheet row 21 therefore requires endRowIndex >= 21.
   */
  const currentEndRowIndex =
    table.range.endRowIndex || 0;


  if (
    currentEndRowIndex >=
    lastDataRow
  ) {

    return {
      changed: false,
      message:
        'PT_Catalog_Table already includes all populated rows.'
    };
  }


  const updatedTable =
    JSON.parse(
      JSON.stringify(table)
    );


  updatedTable.range.endRowIndex =
    lastDataRow;


  Sheets.Spreadsheets.batchUpdate(

    {
      requests: [
        {
          updateTable: {
            table: updatedTable,
            fields: 'range'
          }
        }
      ]
    },

    spreadsheet.getId()
  );


  return {
    changed: true,
    lastDataRow: lastDataRow,
    message:
      `PT_Catalog_Table was expanded through worksheet row ${lastDataRow}.`
  };
}
