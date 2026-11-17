/**
 * Inventory.gs
 * LBA Bingo Inventory Management v1.4
 *
 * Authoritative inventory-item and transaction operations.
 */

const PT_AVAILABLE_STATUSES = new Set([
  'Unbundled',
  'Bundled'
]);

const PT_DEAL_STATUSES = [
  'Unbundled',
  'Bundled',
  'Open',
  'Sold',
  'Damaged',
  'Returned',
  'Destroyed',
  'Missing'
];


function ptAvailabilityQuantity_(status) {
  return PT_AVAILABLE_STATUSES.has(status) ? 1 : 0;
}


function getPTDeals_() {
  return getRecords_('PT_Deals');
}


function getPaperCases_() {
  return getRecords_('Paper_Cases');
}


/**
 * Finds an identified PT deal by Form Number + Serial Number.
 *
 * Blank serial numbers deliberately do not identify a deal because multiple
 * anonymous deals of one Form Number are valid inventory records.
 */
function findPTDeal_(formNumber, serialNumber) {
  const normalizedFormNumber = normalizeFormNumber_(formNumber);
  const normalizedSerialNumber = normalizeText_(serialNumber);

  if (!normalizedSerialNumber) {
    return null;
  }

  return getPTDeals_().find((deal) => {
    return (
      normalizeFormNumber_(deal.Form_Number) === normalizedFormNumber &&
      normalizeText_(deal.Serial_Number) === normalizedSerialNumber
    );
  }) || null;
}


/**
 * Creates one physical PT deal record.
 *
 * Serial_Number may be blank while the deal is unidentified. Duplicate
 * protection is enforced only after a nonblank serial number exists.
 */
function createPTDeal_(data) {
  if (!PT_DEAL_STATUSES.includes(data.status)) {
    throw new Error(`Invalid PT Deal Status: ${data.status}`);
  }

  const normalizedFormNumber = normalizeFormNumber_(data.formNumber);
  const normalizedSerialNumber = normalizeText_(data.serialNumber);

  if (
    normalizedSerialNumber &&
    findPTDeal_(normalizedFormNumber, normalizedSerialNumber)
  ) {
    throw new Error(
      `Deal ${normalizedFormNumber}/${normalizedSerialNumber} already exists.`
    );
  }

  const dealId = generateId_(
    'PT_DEAL',
    'PTD-',
    6
  );

  const receivedDate = data.receivedDate || now_();

  appendRecord_('PT_Deals', {
    PT_Deal_ID: dealId,
    PT_Game_ID: data.gameId,
    Form_Number: normalizedFormNumber,
    Serial_Number: normalizedSerialNumber,
    Received_Date: receivedDate,
    Deal_Status: data.status,
    Bundled_Date: data.status === 'Bundled' ? receivedDate : '',
    Expended_Date: [
      'Sold',
      'Destroyed',
      'Returned'
    ].includes(data.status) ? receivedDate : '',
    Expended_Session_ID: data.sessionId || '',
    Notes: data.notes || ''
  });

  return dealId;
}


function updatePTDealStatus_(deal, newStatus) {
  if (!PT_DEAL_STATUSES.includes(newStatus)) {
    throw new Error(`Invalid PT Deal Status: ${newStatus}`);
  }

  const updates = {
    Deal_Status: newStatus
  };

  if (
    newStatus === 'Bundled' &&
    !deal.Bundled_Date
  ) {
    updates.Bundled_Date = now_();
  }

  if (
    [
      'Sold',
      'Destroyed',
      'Returned'
    ].includes(newStatus) &&
    !deal.Expended_Date
  ) {
    updates.Expended_Date = now_();
  }

  updateRecordRow_(
    'PT_Deals',
    deal._rowNumber,
    updates
  );
}


/**
 * Posts one authoritative inventory transaction.
 */
function postInventoryTransaction_(data) {
  const quantityChange = Number(data.quantityChange);

  if (!Number.isInteger(quantityChange)) {
    throw new Error(
      'Transaction Quantity_Change must be an integer.'
    );
  }

  const transactionId = generateId_(
    'TRANSACTION',
    'TX-',
    7
  );

  appendRecord_('Transactions', {
    Transaction_ID: transactionId,
    Effective_Date: data.effectiveDate || now_(),
    Timestamp: now_(),
    Inventory_Type: data.inventoryType,
    Product_ID: data.productId,
    Item_ID: data.itemId,
    Form_Number: data.formNumber || '',
    Serial_Number: data.serialNumber || '',
    Transaction_Type: data.transactionType,
    Quantity_Change: quantityChange,
    Unit: data.unit,
    Session_ID: data.sessionId || '',
    Source: data.source,
    Reconciliation_ID: data.reconciliationId || '',
    Notes: data.notes || ''
  });

  return transactionId;
}


/**
 * Pre-validates a PT stock addition before any records are written.
 *
 * This is important for a multi-deal order. All product-level conditions are
 * checked once before the first deal or transaction is created.
 */
function validateAnonymousPTStockAddition_(data) {
  const quantity = integerOrThrow_(
    data.quantity,
    'PT quantity',
    { allowZero: false }
  );

  const gameId = normalizeText_(data.gameId);
  const formNumber = normalizeFormNumber_(data.formNumber);

  if (!gameId) {
    throw new Error('PT Game ID is required.');
  }

  if (!formNumber) {
    throw new Error('PT Form Number is required.');
  }

  const game = getPTCatalog_().find((catalogRow) => {
    return String(catalogRow.PT_Game_ID) === gameId;
  });

  if (!game) {
    throw new Error(
      `PT Game ${gameId} was not found in PT_Catalog.`
    );
  }

  const validForms = [
    normalizeFormNumber_(game.Primary_Form_Number),
    ...splitAlternateForms_(game.Alternate_Form_Numbers)
  ];

  if (!validForms.includes(formNumber)) {
    throw new Error(
      `Form ${formNumber} is not assigned to ${game.Game_Name}.`
    );
  }

  if (
    data.status &&
    data.status !== 'Unbundled'
  ) {
    throw new Error(
      'Anonymous ordered PT stock must enter inventory as Unbundled.'
    );
  }

  return {
    quantity: quantity,
    gameId: gameId,
    formNumber: formNumber
  };
}


/**
 * Adds multiple anonymous PT deals.
 *
 * Validation is completed before the first write occurs. Blank serial numbers
 * are legitimate and can occur on many deals of the same Form Number.
 */
function createAnonymousPTStock_(data) {
  const validated = validateAnonymousPTStockAddition_(data);
  const createdRecords = [];

  try {
    for (
      let dealNumber = 0;
      dealNumber < validated.quantity;
      dealNumber += 1
    ) {
      const dealId = createPTDeal_({
        gameId: validated.gameId,
        formNumber: validated.formNumber,
        serialNumber: '',
        status: 'Unbundled',
        receivedDate: data.effectiveDate || now_(),
        notes: data.notes || ''
      });

      createdRecords.push({
        dealId: dealId,
        transactionId: ''
      });

      const transactionId = postInventoryTransaction_({
        effectiveDate: data.effectiveDate || now_(),
        inventoryType: 'PT',
        productId: validated.gameId,
        itemId: dealId,
        formNumber: validated.formNumber,
        serialNumber: '',
        transactionType: data.transactionType || 'Received',
        quantityChange: 1,
        unit: 'Deal',
        source: data.source,
        reconciliationId: data.reconciliationId || '',
        notes: data.notes || ''
      });

      createdRecords[createdRecords.length - 1].transactionId = transactionId;
    }
  } catch (error) {
    rollbackNewPTStockRecords_(createdRecords);

    throw new Error(
      `PT stock addition failed and was rolled back: ${error.message}`
    );
  }

  return createdRecords.map((record) => record.dealId);
}


/**
 * Best-effort rollback used only for records created during the current failed
 * multi-deal operation.
 *
 * This does not rewrite historical inventory. It exists to prevent an order
 * from being partially posted if an unexpected application/API failure occurs
 * after pre-validation succeeds.
 */
function rollbackNewPTStockRecords_(createdRecords) {
  if (!createdRecords.length) {
    return;
  }

  const transactionIds = new Set(
    createdRecords
      .map((record) => record.transactionId)
      .filter(Boolean)
  );

  const dealIds = new Set(
    createdRecords
      .map((record) => record.dealId)
      .filter(Boolean)
  );

  deleteRowsByIdSet_(
    'Transactions',
    'Transaction_ID',
    transactionIds
  );

  deleteRowsByIdSet_(
    'PT_Deals',
    'PT_Deal_ID',
    dealIds
  );
}


/**
 * Deletes rows matching IDs created by the currently failing operation.
 * Rows are deleted from bottom to top to avoid row-number shifting.
 */
function deleteRowsByIdSet_(
  sheetName,
  idColumnName,
  ids
) {
  if (!ids || ids.size === 0) {
    return;
  }

  const sheet = getSheetOrThrow_(sheetName);
  const records = getRecords_(sheetName);

  const rowsToDelete = records
    .filter((record) => {
      return ids.has(
        String(record[idColumnName])
      );
    })
    .map((record) => record._rowNumber)
    .sort((firstRow, secondRow) => {
      return secondRow - firstRow;
    });

  rowsToDelete.forEach((rowNumber) => {
    sheet.deleteRow(rowNumber);
  });
}


function createPaperCase_(data) {
  const caseId = generateId_(
    'PAPER_CASE',
    'PC-',
    6
  );

  appendRecord_('Paper_Cases', {
    Paper_Case_ID: caseId,
    Paper_ID: data.paperId,
    Serial_Number: data.serialNumber || '',
    Received_Date: data.receivedDate || now_(),
    Case_Status: data.status || 'Unopened',
    Opened_Date: data.status === 'Opened'
      ? (data.receivedDate || now_())
      : '',
    Expended_Date: '',
    Notes: data.notes || ''
  });

  return caseId;
}


function createAnonymousPaperStock_(data) {
  const cases = integerOrThrow_(
    data.cases,
    'Paper cases',
    { allowZero: false }
  );

  const packsPerCase = integerOrThrow_(
    data.packsPerCase,
    'Packs per Case',
    { allowZero: false }
  );

  const caseIds = [];

  for (
    let caseNumber = 0;
    caseNumber < cases;
    caseNumber += 1
  ) {
    const caseId = createPaperCase_({
      paperId: data.paperId,
      serialNumber: '',
      status: 'Unopened',
      receivedDate: data.effectiveDate,
      notes: data.notes
    });

    caseIds.push(caseId);

    postInventoryTransaction_({
      effectiveDate: data.effectiveDate,
      inventoryType: 'Paper',
      productId: data.paperId,
      itemId: caseId,
      formNumber: '',
      serialNumber: '',
      transactionType: data.transactionType || 'Received',
      quantityChange: packsPerCase,
      unit: 'Pack',
      source: data.source,
      notes: data.notes || ''
    });
  }

  return caseIds;
}


function createInventoryIssue_(data) {
  const issueId = generateId_(
    'ISSUE',
    'ISS-',
    7
  );

  appendRecord_('Inventory_Issues', {
    Issue_ID: issueId,
    Timestamp: now_(),
    Inventory_Type: data.inventoryType,
    Issue_Type: data.issueType,
    Product_ID: data.productId,
    Item_ID: data.itemId || '',
    Form_Number: data.formNumber || '',
    Serial_Number: data.serialNumber || '',
    Session_ID: data.sessionId || '',
    Expected_Quantity: data.expectedQuantity,
    Reported_Quantity: data.reportedQuantity,
    Discrepancy_Amount: data.discrepancyAmount,
    Status: 'Open',
    Reconciliation_ID: '',
    Notes: data.notes || ''
  });

  return issueId;
}


/**
 * Assigns a real serial number to an anonymous Unbundled PT deal.
 *
 * If no anonymous deal remains, the newly discovered identified deal is added
 * to inventory and an Unexpected Deal Inventory Issue is generated.
 */
function identifyPTDeal_(data) {
  const serialNumber = normalizeText_(
    data.serialNumber
  );

  if (!serialNumber) {
    throw new Error(
      'Serial Number is required.'
    );
  }

  if (
    findPTDeal_(
      data.formNumber,
      serialNumber
    )
  ) {
    throw new Error(
      `Deal ${data.formNumber}/${serialNumber} already exists.`
    );
  }

  const formNumber = normalizeFormNumber_(
    data.formNumber
  );

  const anonymousDeal = getPTDeals_().find((deal) => {
    return (
      String(deal.PT_Game_ID) === String(data.gameId) &&
      normalizeFormNumber_(deal.Form_Number) === formNumber &&
      !normalizeText_(deal.Serial_Number) &&
      String(deal.Deal_Status) === 'Unbundled'
    );
  });

  if (anonymousDeal) {
    updateRecordRow_(
      'PT_Deals',
      anonymousDeal._rowNumber,
      {
        Serial_Number: serialNumber,
        Deal_Status: data.newStatus || 'Bundled',
        Bundled_Date: data.effectiveDate || now_()
      }
    );

    postInventoryTransaction_({
      effectiveDate: data.effectiveDate,
      inventoryType: 'PT',
      productId: data.gameId,
      itemId: anonymousDeal.PT_Deal_ID,
      formNumber: formNumber,
      serialNumber: serialNumber,
      transactionType: 'Bundled',
      quantityChange: 0,
      unit: 'Deal',
      source: data.source || 'PT Processing',
      notes: 'Serial assigned to unidentified deal.'
    });

    return {
      dealId: anonymousDeal.PT_Deal_ID,
      matchedAnonymous: true,
      issueId: ''
    };
  }

  const dealId = createPTDeal_({
    gameId: data.gameId,
    formNumber: formNumber,
    serialNumber: serialNumber,
    status: data.newStatus || 'Bundled',
    receivedDate: data.effectiveDate,
    notes: data.notes
  });

  const transactionId = postInventoryTransaction_({
    effectiveDate: data.effectiveDate,
    inventoryType: 'PT',
    productId: data.gameId,
    itemId: dealId,
    formNumber: formNumber,
    serialNumber: serialNumber,
    transactionType: 'Adjustment',
    quantityChange: 1,
    unit: 'Deal',
    source: data.source || 'PT Processing',
    notes: 'Unexpected deal found during PT processing.'
  });

  const issueId = createInventoryIssue_({
    inventoryType: 'PT',
    issueType: 'Unexpected Deal',
    productId: data.gameId,
    itemId: dealId,
    formNumber: formNumber,
    serialNumber: serialNumber,
    expectedQuantity: 0,
    reportedQuantity: 1,
    discrepancyAmount: 1,
    notes:
      'No unidentified deal was available. ' +
      `Transaction ${transactionId}.`
  });

  return {
    dealId: dealId,
    matchedAnonymous: false,
    issueId: issueId
  };
}


/**
 * Finds one PT deal by its permanent PT_Deal_ID.
 *
 * Reconciliation must use PT_Deal_ID rather than Form Number + Serial Number
 * because an existing ordered deal may legitimately have a blank serial.
 *
 * @param {string} dealId
 * @return {Object|null}
 */
function findPTDealById_(dealId) {
  const normalizedDealId = normalizeText_(dealId);

  if (!normalizedDealId) {
    return null;
  }

  return getPTDeals_().find((deal) => {
    return String(deal.PT_Deal_ID) === normalizedDealId;
  }) || null;
}


/**
 * Checks whether another PT deal already uses a proposed nonblank serial.
 *
 * @param {string} formNumber
 * @param {string} serialNumber
 * @param {string=} excludedDealId
 * @return {Object|null}
 */
function findConflictingPTSerial_(
  formNumber,
  serialNumber,
  excludedDealId
) {
  const normalizedFormNumber = normalizeFormNumber_(formNumber);
  const normalizedSerialNumber = normalizeText_(serialNumber);
  const normalizedExcludedDealId = normalizeText_(excludedDealId);

  if (!normalizedSerialNumber) {
    return null;
  }

  return getPTDeals_().find((deal) => {
    return (
      String(deal.PT_Deal_ID) !== normalizedExcludedDealId &&
      normalizeFormNumber_(deal.Form_Number) === normalizedFormNumber &&
      normalizeText_(deal.Serial_Number) === normalizedSerialNumber
    );
  }) || null;
}
