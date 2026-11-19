/**
 * SessionInventoryProcessing.js
 * LBA Bingo Inventory Management v1.12
 *
 * Parses completed state paperwork immediately before archival. Processing is
 * attempted once. A Started or Failed marker prevents automatic retry and the
 * paperwork remains in the weekly folder for human recovery.
 */

const SESSION_PROCESSING_SOURCE = 'Session Paperwork Processing';
const SESSION_MARKER_TYPES = [
  'Session Processing Started',
  'Session Processed',
  'Session Processing Failed'
];

const PAPER_ROWS_BY_SESSION = {
  Thursday: [9, 10, 12, 13, 15, 16, 18, 19, 21, 22],
  Friday: [9, 10, 12, 13, 15, 16, 18, 19, 21, 22],
  Sunday: [9, 10, 12, 13, 15, 16, 18, 19, 21, 22, 24, 25, 27, 28]
};

const COMPLETED_PT_RANGES = [
  { sheetName: 'WS-06 PTs (Main)', firstRow: 8, lastRow: 25 },
  { sheetName: 'WS-06 PTs (Flash)', firstRow: 6, lastRow: 17 },
  { sheetName: 'WS-07 Prog PTs', rows: [7, 8, 14, 15, 16, 17, 18, 19, 20, 21, 29, 30] }
];

const CARRYOVER_START_ROWS = [33, 50, 67];


function processSessionInventoryBeforeArchive_(context) {
  const sessionId = normalizeText_(context.sessionId);

  if (!sessionId) {
    return {
      ok: false,
      message: 'No authoritative SessionID could be resolved.'
    };
  }

  const state = getSessionProcessingState_(sessionId);

  if (state === 'Session Processed') {
    return {
      ok: true,
      alreadyProcessed: true,
      message: 'Session inventory was already processed.'
    };
  }

  if (
    state === 'Session Processing Started' ||
    state === 'Session Processing Failed'
  ) {
    return {
      ok: false,
      message:
        `Session inventory has state "${state}". ` +
        'Automatic retry is disabled; manual recovery is required.'
    };
  }

  const dateCode = formatPaperworkMMDDYY_(context.date);
  const file = findUniquePaperworkSheet_(
    context.folder,
    `LBA-Bingo_${dateCode}`
  );

  if (!file) {
    return {
      ok: false,
      message: 'The completed paperwork spreadsheet could not be found.'
    };
  }

  postSessionProcessingMarker_(
    sessionId,
    context.date,
    'Session Processing Started',
    `Started inventory processing from ${file.getName()} (${file.getId()}).`
  );

  try {
    const spreadsheet = SpreadsheetApp.openById(file.getId());

    const paperCount = processSessionPaper_(
      spreadsheet,
      context,
      file
    );

    const ptResult = processSessionPT_(
      spreadsheet,
      context,
      file
    );

    postSessionProcessingMarker_(
      sessionId,
      context.date,
      'Session Processed',
      `Completed inventory processing from ${file.getName()}. ` +
      `${paperCount} Paper transaction(s); ` +
      `${ptResult.transactions} PT transaction(s); ` +
      `${ptResult.issues} issue(s).`
    );

    return {
      ok: true,
      paperTransactions: paperCount,
      ptTransactions: ptResult.transactions,
      issues: ptResult.issues,
      message: 'Session inventory processing completed.'
    };
  } catch (error) {
    try {
      postSessionProcessingMarker_(
        sessionId,
        context.date,
        'Session Processing Failed',
        `Inventory processing failed: ${error.message}`
      );
    } catch (markerError) {
      console.error(
        'Unable to record Session Processing Failed marker:',
        markerError
      );
    }

    return {
      ok: false,
      message:
        `Inventory processing failed: ${error.message}`
    };
  }
}


function getSessionProcessingState_(sessionId) {
  const markers = getRecords_('Transactions')
    .filter((transaction) => {
      return (
        String(transaction.Inventory_Type) === 'System' &&
        String(transaction.Session_ID) === String(sessionId) &&
        String(transaction.Source) === SESSION_PROCESSING_SOURCE &&
        SESSION_MARKER_TYPES.includes(
          String(transaction.Transaction_Type)
        )
      );
    });

  return markers.length
    ? String(markers[markers.length - 1].Transaction_Type)
    : '';
}


function postSessionProcessingMarker_(
  sessionId,
  effectiveDate,
  transactionType,
  notes
) {
  return postInventoryTransaction_({
    effectiveDate: effectiveDate,
    inventoryType: 'System',
    productId: '',
    itemId: '',
    formNumber: '',
    serialNumber: '',
    transactionType: transactionType,
    quantityChange: 0,
    unit: 'Session',
    sessionId: sessionId,
    source: SESSION_PROCESSING_SOURCE,
    notes: notes
  });
}


function processSessionPaper_(spreadsheet, context, sourceFile) {
  const sheet = spreadsheet.getSheetByName('WS-01 Paper');

  if (!sheet) {
    throw new Error('Required worksheet WS-01 Paper is missing.');
  }

  let transactionCount = 0;

  PAPER_ROWS_BY_SESSION[context.label].forEach((rowNumber) => {
    const description = normalizeText_(sheet.getRange(rowNumber, 2).getDisplayValue());
    const serialNumber = normalizeText_(sheet.getRange(rowNumber, 3).getDisplayValue());
    const quantity = Number(sheet.getRange(rowNumber, 6).getValue() || 0);

    if (!serialNumber && quantity === 0) {
      return;
    }

    if (!serialNumber || !Number.isInteger(quantity) || quantity < 0) {
      throw new Error(
        `Invalid Paper entry on WS-01 row ${rowNumber}.`
      );
    }

    if (quantity === 0) {
      return;
    }

    const paperCase = getPaperCases_().find((candidate) => {
      return normalizeText_(candidate.Serial_Number) === serialNumber;
    });

    if (!paperCase) {
      createInventoryIssue_({
        inventoryType: 'Paper',
        issueType: 'Unknown Serial',
        productId: '',
        itemId: '',
        serialNumber: serialNumber,
        sessionId: context.sessionId,
        expectedQuantity: 0,
        reportedQuantity: quantity,
        discrepancyAmount: quantity,
        notes:
          `WS-01 row ${rowNumber}: ${description}. ` +
          `Source file ${sourceFile.getId()}.`
      });
      return;
    }

    const balance = getPaperCasePackBalance_(paperCase.Paper_Case_ID);

    if (quantity > balance) {
      createInventoryIssue_({
        inventoryType: 'Paper',
        issueType: 'Insufficient Inventory',
        productId: paperCase.Paper_ID,
        itemId: paperCase.Paper_Case_ID,
        serialNumber: serialNumber,
        sessionId: context.sessionId,
        expectedQuantity: balance,
        reportedQuantity: quantity,
        discrepancyAmount: quantity - balance,
        notes:
          `Paperwork reports ${quantity} packs used from a ledger balance ` +
          `of ${balance}. WS-01 row ${rowNumber}.`
      });
    }

    postInventoryTransaction_({
      effectiveDate: context.date,
      inventoryType: 'Paper',
      productId: paperCase.Paper_ID,
      itemId: paperCase.Paper_Case_ID,
      serialNumber: serialNumber,
      transactionType: 'Sold',
      quantityChange: -quantity,
      unit: 'Pack',
      sessionId: context.sessionId,
      source: SESSION_PROCESSING_SOURCE,
      notes:
        `${description}; WS-01 row ${rowNumber}; ` +
        `source file ${sourceFile.getId()}.`
    });

    const remaining = balance - quantity;
    const updates = {};

    if (remaining <= 0) {
      updates.Case_Status = 'Expended';
      updates.Expended_Date = context.date;
    } else if (String(paperCase.Case_Status) === 'Unopened') {
      updates.Case_Status = 'Opened';
      updates.Opened_Date = context.date;
    }

    if (Object.keys(updates).length) {
      updateRecordRow_(
        'Paper_Cases',
        paperCase._rowNumber,
        updates
      );
    }

    transactionCount += 1;
  });

  return transactionCount;
}


function processSessionPT_(spreadsheet, context, sourceFile) {
  let transactions = 0;
  let issues = 0;

  COMPLETED_PT_RANGES.forEach((definition) => {
    const sheet = spreadsheet.getSheetByName(definition.sheetName);

    if (!sheet) {
      throw new Error(`Required worksheet ${definition.sheetName} is missing.`);
    }

    const rows = definition.rows || createIntegerRange_(
      definition.firstRow,
      definition.lastRow
    );

    rows.forEach((rowNumber) => {
      const serialNumber = normalizeText_(sheet.getRange(rowNumber, 4).getDisplayValue());
      const formNumber = normalizeFormNumber_(sheet.getRange(rowNumber, 5).getDisplayValue());

      if (!serialNumber || !formNumber || /^#N\/A$/i.test(serialNumber)) {
        return;
      }

      const result = processCompletedPTDeal_(
        formNumber,
        serialNumber,
        context,
        definition.sheetName,
        rowNumber,
        sourceFile
      );

      transactions += result.transaction ? 1 : 0;
      issues += result.issue ? 1 : 0;
    });
  });

  const main = spreadsheet.getSheetByName('WS-06 PTs (Main)');

  CARRYOVER_START_ROWS.forEach((startRow) => {
    const result = processCarryoverPTDeal_(
      main,
      startRow,
      context,
      sourceFile
    );

    transactions += result.transaction ? 1 : 0;
    issues += result.issue ? 1 : 0;
  });

  return {
    transactions: transactions,
    issues: issues
  };
}


function processCompletedPTDeal_(
  formNumber,
  serialNumber,
  context,
  sheetName,
  rowNumber,
  sourceFile
) {
  const deal = findPTDeal_(formNumber, serialNumber);

  if (!deal) {
    createPTPaperworkIssue_(
      'Unknown Deal',
      null,
      formNumber,
      serialNumber,
      context,
      `${sheetName} row ${rowNumber}; source file ${sourceFile.getId()}.`
    );

    return { transaction: false, issue: true };
  }

  const status = String(deal.Deal_Status);

  if (status === 'Sold') {
    createPTPaperworkIssue_(
      'Duplicate Sale',
      deal,
      formNumber,
      serialNumber,
      context,
      `${sheetName} row ${rowNumber}.`
    );

    return { transaction: false, issue: true };
  }

  const quantityChange = status === 'Open' ? 0 : -1;

  if (!['Bundled', 'Open'].includes(status)) {
    createPTPaperworkIssue_(
      'Unavailable Deal',
      deal,
      formNumber,
      serialNumber,
      context,
      `Deal status was ${status}; ${sheetName} row ${rowNumber}.`
    );

    return { transaction: false, issue: true };
  }

  updateRecordRow_('PT_Deals', deal._rowNumber, {
    Deal_Status: 'Sold',
    Expended_Date: context.date,
    Expended_Session_ID: context.sessionId
  });

  postInventoryTransaction_({
    effectiveDate: context.date,
    inventoryType: 'PT',
    productId: deal.PT_Game_ID,
    itemId: deal.PT_Deal_ID,
    formNumber: formNumber,
    serialNumber: serialNumber,
    transactionType: 'Sold',
    quantityChange: quantityChange,
    unit: 'Deal',
    sessionId: context.sessionId,
    source: SESSION_PROCESSING_SOURCE,
    notes: `${sheetName} row ${rowNumber}; source file ${sourceFile.getId()}.`
  });

  return { transaction: true, issue: false };
}


function processCarryoverPTDeal_(sheet, startRow, context, sourceFile) {
  const serialNumber = normalizeText_(sheet.getRange(startRow, 4).getDisplayValue());
  const formNumber = normalizeFormNumber_(sheet.getRange(startRow, 5).getDisplayValue());
  const ticketCount = Number(sheet.getRange(startRow, 6).getValue() || 0);

  if (!serialNumber || !formNumber) {
    return { transaction: false, issue: false };
  }

  const totalSales = Number(sheet.getRange(startRow + 5, 6).getValue() || 0);
  const deal = findPTDeal_(formNumber, serialNumber);

  if (!deal) {
    createPTPaperworkIssue_(
      'Unknown Deal',
      null,
      formNumber,
      serialNumber,
      context,
      `Carry-over block beginning row ${startRow}.`
    );

    return { transaction: false, issue: true };
  }

  if (totalSales > ticketCount) {
    createPTPaperworkIssue_(
      'Unexpected Deal',
      deal,
      formNumber,
      serialNumber,
      context,
      `Carry-over sales ${totalSales} exceed ticket count ${ticketCount}.`
    );

    return { transaction: false, issue: true };
  }

  const completed = totalSales === ticketCount;
  const priorStatus = String(deal.Deal_Status);
  const targetStatus = completed ? 'Sold' : 'Open';

  if (priorStatus === targetStatus) {
    return { transaction: false, issue: false };
  }

  if (!['Bundled', 'Open'].includes(priorStatus)) {
    createPTPaperworkIssue_(
      'Unavailable Deal',
      deal,
      formNumber,
      serialNumber,
      context,
      `Carry-over deal status was ${priorStatus}.`
    );

    return { transaction: false, issue: true };
  }

  const quantityChange =
    priorStatus === 'Bundled' && targetStatus === 'Open'
      ? -1
      : 0;

  const updates = {
    Deal_Status: targetStatus
  };

  if (targetStatus === 'Sold') {
    updates.Expended_Date = context.date;
    updates.Expended_Session_ID = context.sessionId;
  }

  updateRecordRow_('PT_Deals', deal._rowNumber, updates);

  postInventoryTransaction_({
    effectiveDate: context.date,
    inventoryType: 'PT',
    productId: deal.PT_Game_ID,
    itemId: deal.PT_Deal_ID,
    formNumber: formNumber,
    serialNumber: serialNumber,
    transactionType: targetStatus === 'Open' ? 'Opened' : 'Sold',
    quantityChange: quantityChange,
    unit: 'Deal',
    sessionId: context.sessionId,
    source: SESSION_PROCESSING_SOURCE,
    notes:
      `Carry-over block row ${startRow}; ${totalSales}/${ticketCount} sold; ` +
      `source file ${sourceFile.getId()}.`
  });

  return { transaction: true, issue: false };
}


function createPTPaperworkIssue_(
  issueType,
  deal,
  formNumber,
  serialNumber,
  context,
  notes
) {
  return createInventoryIssue_({
    inventoryType: 'PT',
    issueType: issueType,
    productId: deal ? deal.PT_Game_ID : '',
    itemId: deal ? deal.PT_Deal_ID : '',
    formNumber: formNumber,
    serialNumber: serialNumber,
    sessionId: context.sessionId,
    expectedQuantity: deal ? 1 : 0,
    reportedQuantity: 1,
    discrepancyAmount: deal ? 0 : 1,
    notes: notes
  });
}


function createIntegerRange_(first, last) {
  const output = [];

  for (let value = first; value <= last; value += 1) {
    output.push(value);
  }

  return output;
}
