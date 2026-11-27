/**
 * SchemaPatchV210.js
 * One-time v2.1 migration for session-summary settings and PT ticket totals.
 */
function applySchemaV210Patch() {
  assertAdvancedSheetsService_();
  const sessions = getSheetOrThrow_('Sessions');
  const headerMap = getHeaderMap_(sessions);
  if ('PT_Deals_Sold' in headerMap) {
    sessions.getRange(1, headerMap.PT_Deals_Sold + 1).setValue('PT_Tickets_Sold');
    invalidateInventoryHeaderCache_(sessions);
    invalidateRecordCache_('Sessions');
    const table = getNativeTableForSheet_(sessions);
    if (!table) throw new Error('Sessions native Table was not found.');
    const updatedTable = JSON.parse(JSON.stringify(table));
    const property = (updatedTable.columnProperties || []).find((item) => {
      return Number(item.columnIndex) === Number(headerMap.PT_Deals_Sold);
    });
    if (property) property.columnName = 'PT_Tickets_Sold';
    Sheets.Spreadsheets.batchUpdate({requests: [{updateTable: {
      table: updatedTable,
      fields: 'columnProperties'
    }}]}, getInventorySpreadsheet_().getId());
  }
  restoreMissingV1Settings_();
  const schemaVersion = getRecords_('Settings').find((row) => {
    return String(row.Setting) === 'Schema_Version';
  });
  if (!schemaVersion) throw new Error('Settings.Schema_Version was not found.');
  updateRecordRow_('Settings', schemaVersion._rowNumber, {Value: '2.1'});
  SpreadsheetApp.flush();
  return {ok: true, version: '2.1'};
}
