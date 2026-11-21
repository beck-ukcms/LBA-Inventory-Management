/**
 * One-time V1.15 schema expansion and balance initialization.
 *
 * The function is idempotent. It may be rerun after a prior interrupted
 * attempt. Existing V1.15 columns are retained and balances are rebuilt from
 * the authoritative Transactions ledger.
 */
function applySchemaV115Patch() {
  const additions = {
    PT_Catalog: [
      { header: 'Qty_Unbundled', width: 110, format: '0' },
      { header: 'Qty_Bundled', width: 110, format: '0' },
      { header: 'Qty_Open', width: 95, format: '0' },
      { header: 'Qty_On_Hand', width: 110, format: '0' },
      {
        header: 'Balance_Updated_At',
        width: 155,
        format: 'm/d/yyyy h:mm:ss am/pm'
      }
    ],
    Paper_Catalog: [
      { header: 'Qty_On_Hand', width: 110, format: '0' },
      {
        header: 'Balance_Updated_At',
        width: 155,
        format: 'm/d/yyyy h:mm:ss am/pm'
      }
    ],
    Paper_Cases: [
      { header: 'Current_Packs', width: 110, format: '0' },
      {
        header: 'Balance_Updated_At',
        width: 155,
        format: 'm/d/yyyy h:mm:ss am/pm'
      }
    ]
  };

  const addedHeaders = {};

  Object.entries(additions).forEach(([sheetName, definitions]) => {
    const sheet = getSheetOrThrow_(sheetName);
    const existingHeaders = sheet
      .getRange(1, 1, 1, sheet.getLastColumn())
      .getDisplayValues()[0];

    const missingDefinitions = definitions.filter((definition) => {
      return !existingHeaders.includes(definition.header);
    });

    if (missingDefinitions.length) {
      const firstNewColumn = existingHeaders.length + 1;
      const requiredColumnCount =
        existingHeaders.length + missingDefinitions.length;

      if (sheet.getMaxColumns() < requiredColumnCount) {
        sheet.insertColumnsAfter(
          sheet.getMaxColumns(),
          requiredColumnCount - sheet.getMaxColumns()
        );
      }

      sheet
        .getRange(
          1,
          firstNewColumn,
          1,
          missingDefinitions.length
        )
        .setValues([
          missingDefinitions.map((definition) => definition.header)
        ])
        .setFontWeight('bold')
        .setFontColor('#ffffff')
        .setBackground('#1f4e78')
        .setHorizontalAlignment('center')
        .setWrap(true);

      missingDefinitions.forEach((definition, offset) => {
        const column = firstNewColumn + offset;
        sheet.setColumnWidth(column, definition.width);
        sheet
          .getRange(2, column, sheet.getMaxRows() - 1, 1)
          .setNumberFormat(definition.format);
      });

      const table = getNativeTableForSheet_(sheet);

      if (!table) {
        throw new Error(
          `${sheetName} native Table was not found. ` +
          'The worksheet columns were added, but the Table must be repaired.'
        );
      }

      const updatedTable = JSON.parse(JSON.stringify(table));
      updatedTable.range.endColumnIndex = requiredColumnCount;
      updatedTable.columnProperties = [
        ...(updatedTable.columnProperties || []),
        ...missingDefinitions.map((definition, index) => {
          return {
            columnIndex: existingHeaders.length + index,
            columnName: definition.header
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

      addedHeaders[sheetName] = missingDefinitions.map(
        (definition) => definition.header
      );
    }

    const currentHeaderMap = getHeaderMap_(sheet);

    definitions.forEach((definition) => {
      const zeroBasedColumn = currentHeaderMap[definition.header];

      if (zeroBasedColumn == null) {
        throw new Error(
          `${sheetName}.${definition.header} is unavailable after migration.`
        );
      }

      const column = zeroBasedColumn + 1;
      sheet.setColumnWidth(column, definition.width);
      sheet
        .getRange(2, column, sheet.getMaxRows() - 1, 1)
        .setNumberFormat(definition.format);
    });
  });

  SpreadsheetApp.flush();

  const result = initializeCurrentBalancesV115();
  result.addedHeaders = addedHeaders;
  return result;
}
