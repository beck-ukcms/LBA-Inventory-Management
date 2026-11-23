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


/**
 * Posts one authoritative inventory transaction.
 */
function buildInventoryTransactionRecord_(data, transactionId, timestamp) {
  const quantityChange = Number(data.quantityChange);
  if (!Number.isInteger(quantityChange)) {
    throw new Error('Transaction Quantity_Change must be an integer.');
  }
  return {
    Transaction_ID: transactionId,
    Effective_Date: data.effectiveDate || timestamp,
    Timestamp: timestamp,
    Inventory_Type: data.inventoryType,
    Product_ID: data.productId || '',
    Item_ID: data.itemId || '',
    Form_Number: data.formNumber || '',
    Serial_Number: data.serialNumber || '',
    Transaction_Type: data.transactionType,
    Quantity_Change: quantityChange,
    Unit: data.unit,
    Session_ID: data.sessionId || '',
    Source: data.source,
    Reconciliation_ID: data.reconciliationId || '',
    Notes: data.notes || ''
  };
}

function postInventoryTransactions_(entries, options = {}) {
  if (!entries.length) return [];
  const timestamp = now_();
  const ids = generateIds_('TRANSACTION', 'TX-', 7, entries.length);
  const records = entries.map((entry, index) => {
    return buildInventoryTransactionRecord_(entry, ids[index], timestamp);
  });
  appendRecords_('Transactions', records);

  const paperDeltas = new Map();
  entries.forEach((entry) => {
    if (String(entry.inventoryType) === 'Paper' && entry.itemId) {
      const key = String(entry.itemId);
      paperDeltas.set(key, (paperDeltas.get(key) || 0) + Number(entry.quantityChange));
    }
  });
  if (paperDeltas.size && options.updatePaperBalances !== false) {
    applyPaperBalanceDeltas_(paperDeltas, options.refreshPaperCatalog !== false);
  }
  return ids;
}

function postInventoryTransaction_(data) {
  return postInventoryTransactions_([data])[0];
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
    const effectiveDate = data.effectiveDate || now_();
    const timestamp = now_();
    const dealIds = generateIds_(
      'PT_DEAL',
      'PTD-',
      6,
      validated.quantity
    );
    const transactionIds = generateIds_(
      'TRANSACTION',
      'TX-',
      7,
      validated.quantity
    );
    appendRecords_(
      'PT_Deals',
      dealIds.map((dealId) => {
        return {
          PT_Deal_ID: dealId,
          PT_Game_ID: validated.gameId,
          Form_Number: validated.formNumber,
          Serial_Number: '',
          Received_Date: effectiveDate,
          Deal_Status: 'Unbundled',
          Bundled_Date: '',
          Expended_Date: '',
          Expended_Session_ID: '',
          Notes: data.notes || ''
        };
      })
    );
    try {
      appendRecords_(
        'Transactions',
        dealIds.map((dealId, index) => {
          return {
            Transaction_ID: transactionIds[index],
            Effective_Date: effectiveDate,
            Timestamp: timestamp,
            Inventory_Type: 'PT',
            Product_ID: validated.gameId,
            Item_ID: dealId,
            Form_Number: validated.formNumber,
            Serial_Number: '',
            Transaction_Type: data.transactionType || 'Received',
            Quantity_Change: 1,
            Unit: 'Deal',
            Session_ID: '',
            Source: data.source,
            Reconciliation_ID: data.reconciliationId || '',
            Notes: data.notes || ''
          };
        })
      );
    } catch (error) {
      deleteRowsByIdSet_(
        'PT_Deals',
        'PT_Deal_ID',
        new Set(dealIds)
      );
      throw new Error(
        `PT stock addition failed and was rolled back: ${error.message}`
      );
    }
    refreshPTCatalogBalances_();
    return dealIds;
  }
/**
 * Best-effort rollback used only for records created during the current failed
 * multi-deal operation.
 *
 * This does not rewrite historical inventory. It exists to prevent an order
 * from being partially posted if an unexpected application/API failure occurs
 * after pre-validation succeeds.
 */
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
    invalidateRecordCache_(sheetName);
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
    const effectiveDate = data.effectiveDate || now_();
    const timestamp = now_();
    const caseIds = generateIds_(
      'PAPER_CASE',
      'PC-',
      6,
      cases
    );
    const transactionIds = generateIds_(
      'TRANSACTION',
      'TX-',
      7,
      cases
    );
    appendRecords_(
      'Paper_Cases',
      caseIds.map((caseId) => {
        return {
          Paper_Case_ID: caseId,
          Paper_ID: data.paperId,
          Serial_Number: '',
          Received_Date: effectiveDate,
          Case_Status: 'Unopened',
          Opened_Date: '',
          Expended_Date: '',
          Notes: data.notes || '',
          Current_Packs: packsPerCase,
          Balance_Updated_At: timestamp
        };
      })
    );
    try {
      appendRecords_(
        'Transactions',
        caseIds.map((caseId, index) => {
          return {
            Transaction_ID: transactionIds[index],
            Effective_Date: effectiveDate,
            Timestamp: timestamp,
            Inventory_Type: 'Paper',
            Product_ID: data.paperId,
            Item_ID: caseId,
            Form_Number: '',
            Serial_Number: '',
            Transaction_Type: data.transactionType || 'Received',
            Quantity_Change: packsPerCase,
            Unit: 'Pack',
            Session_ID: '',
            Source: data.source,
            Reconciliation_ID: '',
            Notes: data.notes || ''
          };
        })
      );
    } catch (error) {
      deleteRowsByIdSet_(
        'Paper_Cases',
        'Paper_Case_ID',
        new Set(caseIds)
      );
      throw new Error(
        `Paper stock addition failed and was rolled back: ${error.message}`
      );
    }
    refreshPaperCatalogBalances_();
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


function findPaperCaseById_(paperCaseId) {
  const normalizedCaseId = normalizeText_(paperCaseId);

  return getRecords_('Paper_Cases').find((paperCase) => {
    return String(paperCase.Paper_Case_ID) === normalizedCaseId;
  }) || null;
}


function findConflictingPaperSerial_(
  paperId,
  serialNumber,
  excludedCaseId
) {
  const normalizedSerial = normalizeText_(serialNumber);
  const normalizedExcludedCaseId = normalizeText_(excludedCaseId);

  if (!normalizedSerial) {
    return null;
  }

  return getRecords_('Paper_Cases').find((paperCase) => {
    return (
      String(paperCase.Paper_ID) === String(paperId) &&
      String(paperCase.Paper_Case_ID) !== normalizedExcludedCaseId &&
      normalizeText_(paperCase.Serial_Number) === normalizedSerial
    );
  }) || null;
}


function appendInventoryNote_(existingNotes, newNote) {
  const existing = normalizeText_(existingNotes);
  const addition = normalizeText_(newNote);

  if (!addition) {
    return existing;
  }

  if (!existing) {
    return addition;
  }

  return `${existing}; ${addition}`;
}

/**
 * Builds the current pack balance for every Paper case from the
 * authoritative Transactions ledger.
 *
 * This function is used only for initialization, validation, and
 * maintenance operations. Normal inventory operations use the
 * materialized Current_Packs values instead of rescanning Transactions.
 *
 * @param {Object[]} transactions
 * @return {Map<string, number>}
 */
function buildPaperBalanceMap_(transactions) {

  const balancesByCaseId =
    new Map();


  (transactions || []).forEach(
    (transaction) => {

      if (
        String(transaction.Inventory_Type) !==
        'Paper'
      ) {

        return;
      }


      const paperCaseId =
        normalizeText_(
          transaction.Item_ID
        );


      if (!paperCaseId) {

        return;
      }


      const quantityChange =
        Number(
          transaction.Quantity_Change || 0
        );


      if (
        !Number.isFinite(
          quantityChange
        )
      ) {

        throw new Error(
          `Transaction ${transaction.Transaction_ID || '(unknown)'} ` +
          'contains an invalid Paper quantity.'
        );
      }


      const currentBalance =
        balancesByCaseId.get(
          paperCaseId
        ) || 0;


      balancesByCaseId.set(
        paperCaseId,
        currentBalance + quantityChange
      );
    }
  );


  return balancesByCaseId;
}



// =============================================================================
// Materialized operational balances
// =============================================================================
function ptStatusContribution_(status) {
  return {
    unbundled: status === 'Unbundled' ? 1 : 0,
    bundled: status === 'Bundled' ? 1 : 0,
    open: status === 'Open' ? 1 : 0,
    onHand: ['Unbundled', 'Bundled'].includes(String(status)) ? 1 : 0
  };
}

function applyPTCatalogBalanceDeltas_(deltasByGameId) {
  if (!deltasByGameId || !deltasByGameId.size) return;
  const updatedAt = now_();
  const updates = getPTCatalog_().filter((row) => {
    return deltasByGameId.has(String(row.PT_Game_ID));
  }).map((row) => {
    const delta = deltasByGameId.get(String(row.PT_Game_ID));
    return {
      rowNumber: row._rowNumber,
      updates: {
        Qty_Unbundled: Number(row.Qty_Unbundled || 0) + delta.unbundled,
        Qty_Bundled: Number(row.Qty_Bundled || 0) + delta.bundled,
        Qty_Open: Number(row.Qty_Open || 0) + delta.open,
        Qty_On_Hand: Number(row.Qty_On_Hand || 0) + delta.onHand,
        Balance_Updated_At: updatedAt
      }
    };
  });
  updateRecordRows_('PT_Catalog', updates);
}

function recordPTStatusChange_(deltasByGameId, gameId, oldStatus, newStatus) {
  if (oldStatus === newStatus) return;
  const before = ptStatusContribution_(oldStatus);
  const after = ptStatusContribution_(newStatus);
  const key = String(gameId);
  const delta = deltasByGameId.get(key) || {unbundled: 0, bundled: 0, open: 0, onHand: 0};
  Object.keys(delta).forEach((name) => delta[name] += after[name] - before[name]);
  deltasByGameId.set(key, delta);
}

function refreshPTCatalogBalances_() {
  const counts = new Map();
  getPTDeals_().forEach((deal) => {
    const id = String(deal.PT_Game_ID);
    const value = counts.get(id) || {unbundled: 0, bundled: 0, open: 0};
    if (deal.Deal_Status === 'Unbundled') value.unbundled += 1;
    if (deal.Deal_Status === 'Bundled') value.bundled += 1;
    if (deal.Deal_Status === 'Open') value.open += 1;
    counts.set(id, value);
  });
  const updatedAt = now_();
  updateRecordRows_('PT_Catalog', getPTCatalog_().map((row) => {
    const value = counts.get(String(row.PT_Game_ID)) || {unbundled: 0, bundled: 0, open: 0};
    return {rowNumber: row._rowNumber, updates: {
      Qty_Unbundled: value.unbundled,
      Qty_Bundled: value.bundled,
      Qty_Open: value.open,
      Qty_On_Hand: value.unbundled + value.bundled,
      Balance_Updated_At: updatedAt
    }};
  }));
}

function refreshPaperCatalogBalances_() {
  const totals = new Map();
  getPaperCases_().forEach((row) => {
    const key = String(row.Paper_ID);
    totals.set(key, (totals.get(key) || 0) + Number(row.Current_Packs || 0));
  });
  const updatedAt = now_();
  updateRecordRows_('Paper_Catalog', getPaperCatalog_().map((row) => ({
    rowNumber: row._rowNumber,
    updates: {
      Qty_On_Hand: totals.get(String(row.Paper_ID)) || 0,
      Balance_Updated_At: updatedAt
    }
  })));
}

function applyPaperBalanceDeltas_(deltasByCaseId, refreshCatalog = true) {
  if (!deltasByCaseId || !deltasByCaseId.size) return;
  const updatedAt = now_();
  const updates = getPaperCases_().filter((row) => {
    return deltasByCaseId.has(String(row.Paper_Case_ID));
  }).map((row) => ({
    rowNumber: row._rowNumber,
    updates: {
      Current_Packs: Number(row.Current_Packs || 0) + deltasByCaseId.get(String(row.Paper_Case_ID)),
      Balance_Updated_At: updatedAt
    }
  }));
  if (updates.length !== deltasByCaseId.size) {
    throw new Error('One or more Paper cases were not found for a balance update.');
  }
  updateRecordRows_('Paper_Cases', updates);
  if (refreshCatalog) refreshPaperCatalogBalances_();
}

function initializeCurrentBalancesV115() {
  const balances = buildPaperBalanceMap_(getRecords_('Transactions'));
  const cases = getPaperCases_();
  const updatedAt = now_();
  updateRecordRows_('Paper_Cases', cases.map((row) => ({
    rowNumber: row._rowNumber,
    updates: {
      Current_Packs: balances.get(String(row.Paper_Case_ID)) || 0,
      Balance_Updated_At: updatedAt
    }
  })));
  refreshPaperCatalogBalances_();
  refreshPTCatalogBalances_();
  return {ok: true, version: '1.15', paperCases: cases.length};
}

function validateMaterializedBalances_() {
  const errors = [];
  const ledger = buildPaperBalanceMap_(getRecords_('Transactions'));
  getPaperCases_().forEach((paperCase) => {
    const expected = ledger.get(String(paperCase.Paper_Case_ID)) || 0;
    const actual = Number(paperCase.Current_Packs || 0);
    if (expected !== actual) errors.push(`Paper case ${paperCase.Paper_Case_ID}: ledger ${expected}, current ${actual}.`);
  });
  const ptCounts = new Map();
  getPTDeals_().forEach((deal) => {
    const key = String(deal.PT_Game_ID);
    const c = ptCounts.get(key) || {unbundled: 0, bundled: 0, open: 0, onHand: 0};
    const v = ptStatusContribution_(String(deal.Deal_Status));
    Object.keys(c).forEach((name) => c[name] += v[name]);
    ptCounts.set(key, c);
  });
  getPTCatalog_().forEach((game) => {
    const c = ptCounts.get(String(game.PT_Game_ID)) || {unbundled: 0, bundled: 0, open: 0, onHand: 0};
    [['Qty_Unbundled','unbundled'],['Qty_Bundled','bundled'],['Qty_Open','open'],['Qty_On_Hand','onHand']].forEach(([field,key]) => {
      if (Number(game[field] || 0) !== c[key]) errors.push(`PT game ${game.PT_Game_ID}.${field}: expected ${c[key]}, found ${game[field] || 0}.`);
    });
  });
  return {valid: errors.length === 0, errors: errors};
}

/** Shared reconciliation record operations. */
function createReconciliationRecord_(data) {
  const expected = integerOrThrow_(data.expectedQuantity, 'Expected Quantity');
  const observed = integerOrThrow_(data.observedQuantity, 'Observed Quantity');
  const correction = observed - expected;
  const id = generateId_('RECONCILIATION', 'REC-', 7);
  appendRecord_('Reconciliation_Records', {
    Reconciliation_ID: id,
    Timestamp: now_(),
    Inventory_Type: data.inventoryType,
    Product_ID: data.productId,
    Item_ID: data.itemId || '',
    Form_Number: data.formNumber || '',
    Serial_Number: data.serialNumber,
    Reconciliation_Type: data.reconciliationType || 'Inventory Check',
    Expected_Quantity: expected,
    Observed_Quantity: observed,
    Correction_Amount: correction,
    Observed_PT_Status: data.observedPTStatus || '',
    Issue_ID: data.issueId || '',
    Correction_Transaction_ID: '',
    Notes: data.notes || '',
  });
  return {id, correction};
}

function linkReconciliationTransaction_(reconciliationId, transactionId) {
  const record = getRecords_('Reconciliation_Records').find(row => String(row.Reconciliation_ID) === String(reconciliationId));
  if (!record) throw new Error(`Reconciliation ${reconciliationId} was not found.`);
  updateRecordRow_('Reconciliation_Records', record._rowNumber, {Correction_Transaction_ID: transactionId});
}
