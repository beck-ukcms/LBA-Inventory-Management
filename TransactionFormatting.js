/**
 * TransactionFormatting.gs
 * LBA Bingo Inventory Management v1.10
 *
 * Ensures Transactions.Effective_Date displays as a date and
 * Transactions.Timestamp displays full date and time.
 */

function applyTransactionTimestampFormattingV19() {
  const sheet = getSheetOrThrow_('Transactions');
  const headerMap = getHeaderMap_(sheet);

  if (!('Effective_Date' in headerMap)) {
    throw new Error('Transactions.Effective_Date column was not found.');
  }

  if (!('Timestamp' in headerMap)) {
    throw new Error('Transactions.Timestamp column was not found.');
  }

  const dataRows = Math.max(
    sheet.getMaxRows() - 1,
    1
  );

  sheet
    .getRange(
      2,
      headerMap.Effective_Date + 1,
      dataRows,
      1
    )
    .setNumberFormat('ddd mmm dd');

  sheet
    .getRange(
      2,
      headerMap.Timestamp + 1,
      dataRows,
      1
    )
    .setNumberFormat('ddd mmm dd HH:mm:ss');

  return {
    ok: true,
    effectiveDateFormat: 'ddd mmm dd',
    timestampFormat: 'ddd mmm dd HH:mm:ss'
  };
}



/** Version-specific entry point for applying the V1.10 display formats. */
function applyTransactionTimestampFormattingV110() {
  return applyTransactionTimestampFormattingV19();
}
