/**
 * TransactionFormatting.gs
 * LBA Bingo Inventory Management v1.9
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
    .setNumberFormat('MM/dd/yyyy');

  sheet
    .getRange(
      2,
      headerMap.Timestamp + 1,
      dataRows,
      1
    )
    .setNumberFormat('MM/dd/yyyy hh:mm:ss AM/PM');

  return {
    ok: true,
    effectiveDateFormat: 'MM/dd/yyyy',
    timestampFormat: 'MM/dd/yyyy hh:mm:ss AM/PM'
  };
}
