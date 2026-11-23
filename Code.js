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
const EXECUTION_RECORD_CACHE_ = Object.create(null);
let EXECUTION_NATIVE_TABLE_CACHE_ = null;
function invalidateRecordCache_(sheetName) {
  delete EXECUTION_RECORD_CACHE_[sheetName];
}
function getRecords_(sheetName) {
  if (EXECUTION_RECORD_CACHE_[sheetName]) {
    return EXECUTION_RECORD_CACHE_[sheetName].map((record) => {
      return Object.assign({}, record);
    });
  }
  const sheet = getSheetOrThrow_(sheetName);
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  if (lastRow < 2 || lastColumn < 1) {
    EXECUTION_RECORD_CACHE_[sheetName] = [];
    return [];
  }
  const headers = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0];
  const values = sheet.getRange(2, 1, lastRow - 1, lastColumn).getValues();
  const records = values
    .map((row, rowOffset) => {
      return { row: row, rowNumber: rowOffset + 2 };
    })
    .filter((entry) => normalizeText_(entry.row[0]) !== '')
    .map((entry) => {
      const record = { _rowNumber: entry.rowNumber };
      headers.forEach((header, index) => {
        record[header] = entry.row[index];
      });
      return record;
    });
  EXECUTION_RECORD_CACHE_[sheetName] = records;
  return records.map((record) => Object.assign({}, record));
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
    return appendRecords_(sheetName, [record])[0];
  }
  function appendRecords_(sheetName, records) {
    if (!Array.isArray(records) || records.length === 0) {
      return [];
    }
    const sheet = getSheetOrThrow_(sheetName);
    const lastColumn = sheet.getLastColumn();
    if (lastColumn < 1) {
      throw new Error(
        `Cannot append to ${sheetName}: the sheet has no header columns.`
      );
    }
    const headers = sheet
      .getRange(1, 1, 1, lastColumn)
      .getDisplayValues()[0];
    const primaryHeader = headers[0];
    records.forEach((record) => {
      const primaryValue = Object.prototype.hasOwnProperty.call(
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
    });
    const table = getNativeTableForSheet_(sheet);
    if (!table) {
      throw new Error(
        `No native Google Sheets Table was found on ${sheetName}.`
      );
    }
    const targetRows = reserveEmptyTableRows_(sheet, table, records.length);
    const rowValues = records.map((record) => {
      return headers.map((header) => {
        return Object.prototype.hasOwnProperty.call(record, header)
          ? record[header]
          : '';
      });
    });
    let groupStart = 0;
    while (groupStart < targetRows.length) {
      let groupEnd = groupStart + 1;
      while (
        groupEnd < targetRows.length &&
        targetRows[groupEnd] === targetRows[groupEnd - 1] + 1
      ) {
        groupEnd += 1;
      }
      sheet
        .getRange(
          targetRows[groupStart],
          1,
          groupEnd - groupStart,
          headers.length
        )
        .setValues(rowValues.slice(groupStart, groupEnd));
      groupStart = groupEnd;
    }
    SpreadsheetApp.flush();
    invalidateRecordCache_(sheetName);
    return targetRows;
  }
  function reserveEmptyTableRows_(sheet, table, count) {
    const firstDataRow = table.range.startRowIndex + 2;
    const lastTableRow = table.range.endRowIndex;
    const availableRows = Math.max(0, lastTableRow - firstDataRow + 1);
    const ids = availableRows
      ? sheet.getRange(firstDataRow, 1, availableRows, 1).getDisplayValues()
      : [];
    const rows = [];
    ids.forEach((row, offset) => {
      if (rows.length < count && normalizeText_(row[0]) === '') {
        rows.push(firstDataRow + offset);
      }
    });
    if (rows.length < count) {
      const expansionRows = Math.max(20, count - rows.length);
      const expandedLastRow = lastTableRow + expansionRows;
      ensureSheetRowCapacity_(sheet, expandedLastRow);
      resizeNativeTable_(table, expandedLastRow);
      for (let row = lastTableRow + 1; rows.length < count; row += 1) {
        rows.push(row);
      }
    }
    return rows;
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
  if (!EXECUTION_NATIVE_TABLE_CACHE_) {
    const spreadsheet = getInventorySpreadsheet_();
    const response = Sheets.Spreadsheets.get(
      spreadsheet.getId(),
      { includeGridData: false }
    );
    EXECUTION_NATIVE_TABLE_CACHE_ = new Map();
    (response.sheets || []).forEach((apiSheet) => {
      const table = (apiSheet.tables || [])[0] || null;
      EXECUTION_NATIVE_TABLE_CACHE_.set(
        String(apiSheet.properties.sheetId),
        table
      );
    });
  }
  const table = EXECUTION_NATIVE_TABLE_CACHE_.get(String(sheet.getSheetId()));
  return table ? JSON.parse(JSON.stringify(table)) : null;
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
    if (EXECUTION_NATIVE_TABLE_CACHE_) {
      EXECUTION_NATIVE_TABLE_CACHE_.set(
        String(updatedTable.range.sheetId),
        JSON.parse(JSON.stringify(updatedTable))
      );
    }
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
 * Updates specific fields on an existing record row.
 *
 * @param {string} sheetName
 * @param {number} rowNumber
 * @param {Object} updates
 */
function updateRecordRow_(sheetName, rowNumber, updates) {
  updateRecordRows_(sheetName, [
    { rowNumber: rowNumber, updates: updates }
  ]);
}

/**
 * Applies sparse row updates through one rectangular read and one write.
 */
function updateRecordRows_(sheetName, rowUpdates) {
  const updatesToApply = Array.isArray(rowUpdates)
    ? rowUpdates.filter((item) => {
        return item && Number(item.rowNumber) >= 2 && item.updates &&
          Object.keys(item.updates).length;
      })
    : [];
  if (!updatesToApply.length) return;
  const sheet = getSheetOrThrow_(sheetName);
  const headerMap = getHeaderMap_(sheet);
  const rowsByNumber = new Map();
  updatesToApply.forEach((item) => {
    const rowNumber = Number(item.rowNumber);
    const merged = rowsByNumber.get(rowNumber) || {};
    Object.entries(item.updates).forEach(([header, value]) => {
      if (!(header in headerMap)) {
        throw new Error(`Unknown ${sheetName} column: ${header}`);
      }
      merged[header] = value;
    });
    rowsByNumber.set(rowNumber, merged);
  });
  const sortedRows = [...rowsByNumber.keys()].sort((a, b) => a - b);
  const groups = [];
  sortedRows.forEach((rowNumber) => {
    const current = groups[groups.length - 1];
    if (!current || rowNumber !== current[current.length - 1] + 1) {
      groups.push([rowNumber]);
    } else {
      current.push(rowNumber);
    }
  });
  groups.forEach((rows) => {
    let minColumn = Infinity;
    let maxColumn = 0;
    rows.forEach((rowNumber) => {
      Object.keys(rowsByNumber.get(rowNumber)).forEach((header) => {
        const column = headerMap[header] + 1;
        minColumn = Math.min(minColumn, column);
        maxColumn = Math.max(maxColumn, column);
      });
    });
    const firstRow = rows[0];
    const range = sheet.getRange(
      firstRow,
      minColumn,
      rows.length,
      maxColumn - minColumn + 1
    );
    const values = range.getValues();
    rows.forEach((rowNumber) => {
      Object.entries(rowsByNumber.get(rowNumber)).forEach(([header, value]) => {
        values[rowNumber - firstRow][headerMap[header] + 1 - minColumn] = value;
      });
    });
    range.setValues(values);
  });
  invalidateRecordCache_(sheetName);
}


/**
 * Reads selected Transaction columns from newest to oldest in bounded chunks.
 * The visitor returns true when enough history has been collected.
 */
function visitTransactionsNewestFirst_(columnNames, visitor, chunkSize = 500) {
  const sheet = getSheetOrThrow_('Transactions');
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  const headerMap = getHeaderMap_(sheet);
  const columns = columnNames.map((name) => {
    if (!(name in headerMap)) throw new Error(`Unknown Transactions column: ${name}`);
    return headerMap[name] + 1;
  });
  const firstColumn = Math.min(...columns);
  const lastColumn = Math.max(...columns);
  for (let endRow = lastRow; endRow >= 2;) {
    const startRow = Math.max(2, endRow - chunkSize + 1);
    const values = sheet.getRange(
      startRow,
      firstColumn,
      endRow - startRow + 1,
      lastColumn - firstColumn + 1
    ).getValues();
    for (let index = values.length - 1; index >= 0; index -= 1) {
      const source = values[index];
      const record = {};
      columnNames.forEach((name, columnIndex) => {
        record[name] = source[columns[columnIndex] - firstColumn];
      });
      if (visitor(record, startRow + index) === true) return;
    }
    endRow = startRow - 1;
  }
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
  function generateId_(counterName, prefix, digits) {
    return generateIds_(counterName, prefix, digits, 1)[0];
  }
  function generateIds_(counterName, prefix, digits, count) {
    const idCount = integerOrThrow_(
      count,
      'ID count',
      { allowZero: false }
    );
    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      const properties = PropertiesService.getScriptProperties();
      const propertyKey = `ID_COUNTER_${counterName}`;
      const currentValue = Number(
        properties.getProperty(propertyKey) || 0
      );
      properties.setProperty(
        propertyKey,
        String(currentValue + idCount)
      );
      return Array.from(
        { length: idCount },
        (_, index) => {
          return prefix + String(currentValue + index + 1).padStart(digits, '0');
        }
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
