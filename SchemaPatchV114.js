/**
 * One-time V1.14 migration for Inventory_Issues resolution history.
 */
function applySchemaV114Patch() {
  const sheet = getSheetOrThrow_('Inventory_Issues');
  const currentHeaders = sheet
    .getRange(1, 1, 1, sheet.getLastColumn())
    .getDisplayValues()[0];

  const requiredHeaders = [
    'Resolved_At',
    'Resolution_Notes'
  ];

  const missingHeaders = requiredHeaders.filter((header) => {
    return !currentHeaders.includes(header);
  });

  if (!missingHeaders.length) {
    return {
      ok: true,
      changed: false,
      message: 'V1.14 Inventory_Issues columns already exist.'
    };
  }

  const firstNewColumn = currentHeaders.length + 1;
  const requiredColumnCount = currentHeaders.length + missingHeaders.length;

  if (sheet.getMaxColumns() < requiredColumnCount) {
    sheet.insertColumnsAfter(
      sheet.getMaxColumns(),
      requiredColumnCount - sheet.getMaxColumns()
    );
  }

  sheet
    .getRange(1, firstNewColumn, 1, missingHeaders.length)
    .setValues([missingHeaders])
    .setFontWeight('bold')
    .setFontColor('#ffffff')
    .setBackground('#1f4e78')
    .setHorizontalAlignment('center')
    .setWrap(true);

  missingHeaders.forEach((header, offset) => {
    const column = firstNewColumn + offset;

    sheet.setColumnWidth(
      column,
      header === 'Resolved_At' ? 155 : 300
    );

    if (header === 'Resolved_At') {
      sheet
        .getRange(2, column, sheet.getMaxRows() - 1, 1)
        .setNumberFormat('m/d/yyyy h:mm:ss am/pm');
    }
  });

  const table = getNativeTableForSheet_(sheet);

  if (!table) {
    throw new Error(
      'Inventory_Issues native Table was not found. ' +
      'The worksheet columns were added, but the Table must be repaired.'
    );
  }

  const updatedTable = JSON.parse(JSON.stringify(table));
  updatedTable.range.endColumnIndex = requiredColumnCount;
  updatedTable.columnProperties = [
    ...(updatedTable.columnProperties || []),
    ...missingHeaders.map((header, offset) => {
      return {
        columnIndex: firstNewColumn - 1 + offset,
        columnName: header
      };
    })
  ];

  Sheets.Spreadsheets.batchUpdate(
    {
      requests: [
        {
          updateTable: {
            table: updatedTable,
            fields: 'range,columnProperties'
          }
        }
      ]
    },
    getInventorySpreadsheet_().getId()
  );

  SpreadsheetApp.flush();

  return {
    ok: true,
    changed: true,
    addedHeaders: missingHeaders,
    message: 'V1.14 Inventory_Issues columns were added.'
  };
}
