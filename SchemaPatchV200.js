/**
 * SchemaPatchV200.js
 * One-time v2.0 migration for archived Sessions analytics.
 */
function applySchemaV200Patch() {
  assertAdvancedSheetsService_();
  const spreadsheet = getInventorySpreadsheet_();
  if (spreadsheet.getSheetByName('Sessions')) {
    return {ok: true, changed: false, message: 'Sessions already exists.'};
  }
  const definition = INVENTORY_SCHEMA_V1.sheets.Sessions;
  const sheet = spreadsheet.insertSheet('Sessions');
  initializeOneSheet_(sheet, 'Sessions', definition);
  SpreadsheetApp.flush();
  const columnProperties = buildTableColumnProperties_(definition);
  Sheets.Spreadsheets.batchUpdate({requests: [{addTable: {table: {
    name: definition.tableName,
    range: {
      sheetId: sheet.getSheetId(),
      startRowIndex: 0,
      endRowIndex: 20,
      startColumnIndex: 0,
      endColumnIndex: definition.headers.length
    },
    columnProperties: columnProperties
  }}}]}, spreadsheet.getId());
  const settings = getRecords_('Settings').find((row) => {
    return String(row.Setting) === 'Schema_Version';
  });
  if (settings) updateRecordRow_('Settings', settings._rowNumber, {Value: '2.0'});
  SpreadsheetApp.flush();
  return {ok: true, changed: true, message: 'v2.0 Sessions sheet created.'};
}
