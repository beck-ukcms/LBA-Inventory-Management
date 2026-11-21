/** One-time V1.15 schema expansion and balance initialization. */
function applySchemaV115Patch() {
  const additions = {
    PT_Catalog: ['Qty_Unbundled','Qty_Bundled','Qty_Open','Qty_On_Hand','Balance_Updated_At'],
    Paper_Catalog: ['Qty_On_Hand','Balance_Updated_At'],
    Paper_Cases: ['Current_Packs','Balance_Updated_At']
  };
  Object.entries(additions).forEach(([sheetName,headers]) => {
    const sheet=getSheetOrThrow_(sheetName);
    const existing=sheet.getRange(1,1,1,sheet.getLastColumn()).getDisplayValues()[0];
    const missing=headers.filter(header=>!existing.includes(header));
    if (!missing.length) return;
    const required=existing.length+missing.length;
    if (sheet.getMaxColumns()<required) sheet.insertColumnsAfter(sheet.getMaxColumns(),required-sheet.getMaxColumns());
    sheet.getRange(1,existing.length+1,1,missing.length).setValues([missing]);
    const table=getNativeTableForSheet_(sheet);
    const updated=JSON.parse(JSON.stringify(table));
    updated.range.endColumnIndex=required;
    updated.columnProperties=[...(updated.columnProperties||[]),...missing.map((header,index)=>({columnIndex:existing.length+index,columnName:header}))];
    Sheets.Spreadsheets.batchUpdate({requests:[{updateTable:{table:updated,fields:'range,columnProperties'}}]},getInventorySpreadsheet_().getId());
  });
  SpreadsheetApp.flush();
  return initializeCurrentBalancesV115();
}
