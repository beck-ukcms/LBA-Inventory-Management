/**
 * PTBundling.js
 * LBA Bingo Inventory Management v1.11
 *
 * Public operational PT bundling workflow. No administrator token is required.
 */


function getPTBundlingGames() {
  const gamesById = new Map(
    getPTCatalog_().map((game) => [String(game.PT_Game_ID), game])
  );
  return buildPTFormOptions_().map((option) => {
    const game = gamesById.get(String(option.gameId));
    return {
      gameId: option.gameId,
      formNumber: option.formNumber,
      name: option.gameName,
      cards: String((game || {}).Cards_Per_Deal || ''),
      payout: String((game || {}).Payout_Per_Deal || '')
    };
  });
}


const PT_BUNDLING_PERF_VERSION = '1.19c';
function createPTBundlingTimer_() {
  const startedAt = Date.now();
  let checkpointAt = startedAt;
  const steps = [];
  return {
    mark: function(name, details) {
      const now = Date.now();
      steps.push({name:name, ms:now-checkpointAt, elapsedMs:now-startedAt, details:details || ''});
      checkpointAt = now;
    },
    finish: function(details) {
      return {version:PT_BUNDLING_PERF_VERSION, totalMs:Date.now()-startedAt, details:details || '', steps:steps};
    }
  };
}

/**
 * Bundles one physical PT deal and returns receipt data.
 */

function getPTDealsForBundlingLookup_() {
  const sheet = getSheetOrThrow_('PT_Deals');
  const headerMap = getHeaderMap_(sheet);
  const requiredHeaders = [
    'PT_Deal_ID',
    'PT_Game_ID',
    'Form_Number',
    'Serial_Number',
    'Deal_Status',
    'Notes'
  ];
  requiredHeaders.forEach((header) => {
    if (!(header in headerMap)) {
      throw new Error(`Missing PT_Deals column: ${header}`);
    }
  });
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const columns = requiredHeaders.map((header) => headerMap[header] + 1);
  const firstColumn = Math.min(...columns);
  const lastColumn = Math.max(...columns);
  const values = sheet.getRange(
    2,
    firstColumn,
    lastRow - 1,
    lastColumn - firstColumn + 1
  ).getValues();
  return values.map((row, index) => {
    const record = {_rowNumber:index + 2};
    requiredHeaders.forEach((header) => {
      record[header] = row[headerMap[header] + 1 - firstColumn];
    });
    return record;
  }).filter((record) => normalizeText_(record.PT_Deal_ID));
}

function findPTDealForBundling_(deals, gameId, serialNumber) {
  const normalizedGameId = normalizeText_(gameId);
  const normalizedSerial = normalizeText_(serialNumber);
  return deals.find((deal) => {
    return String(deal.PT_Game_ID) === normalizedGameId &&
      normalizeText_(deal.Serial_Number) === normalizedSerial;
  }) || null;
}
function bundlePTDeal(formNumber, serialNumber) {
  const timer = createPTBundlingTimer_();
  const normalizedForm = normalizeFormNumber_(formNumber);
  const normalizedSerial = normalizeText_(serialNumber);
  timer.mark('Normalize input');
  if (!normalizedForm || !normalizedSerial) throw new Error('Enter both a Form Number and Serial Number.');
  const resolvedForm = resolvePTGameByForm_(normalizedForm);
  timer.mark('Catalog / form lookup');
  if (!resolvedForm) throw new Error(`Form Number ${normalizedForm} was not found.`);
  const game = resolvedForm.game;
  const gameId = resolvedForm.gameId;
  const primaryFormNumber = resolvedForm.primaryFormNumber;
  timer.mark('Game lookup');
  if (!game) throw new Error(`Game ${gameId} was not found.`);
  const lock = LockService.getDocumentLock();
  const lockAt = Date.now();
  lock.waitLock(30000);
  timer.mark('Document lock', `waitMs=${Date.now()-lockAt}`);
  try {
    const bundlingDeals = getPTDealsForBundlingLookup_();
    const existingDeal = findPTDealForBundling_(
      bundlingDeals,
      gameId,
      normalizedSerial
    );
    timer.mark('PT Deals lookup');
    let result;
    if (existingDeal) {
      result = bundleExistingIdentifiedPTDeal_({deal:existingDeal,game:game,gameId:gameId,formNumber:primaryFormNumber,serialNumber:normalizedSerial});
    } else {
      result = bundleNewlyIdentifiedPTDeal_({
        game:game,
        gameId:gameId,
        formNumber:primaryFormNumber,
        serialNumber:normalizedSerial,
        bundlingDeals:bundlingDeals
      });
    }
    timer.mark('Inventory writes + transaction');
    const performance = timer.finish(`game=${gameId}; enteredForm=${normalizedForm}; action=${result.action}`);
    performance.append = result.appendPerformance || null;
    delete result.appendPerformance;
    return Object.assign(result, {
      gameId:gameId,gameName:String(game.Game_Name),formNumber:primaryFormNumber,
      serialNumber:normalizedSerial,cards:String(game.Cards_Per_Deal || ''),payout:String(game.Payout_Per_Deal || ''),
      performance:performance
    });
  } finally { lock.releaseLock(); }
}


function bundleExistingIdentifiedPTDeal_(context) {
  const deal = context.deal;
  const status = String(deal.Deal_Status);

  if (status === 'Bundled') {
    throw new Error(
      `Deal ${context.formNumber}/${context.serialNumber} is already bundled.`
    );
  }

  if (status === 'Unbundled') {
    updateRecordRow_('PT_Deals', deal._rowNumber, {
      Deal_Status: 'Bundled',
      Bundled_Date: now_(),
      Notes: appendInventoryNote_(
        deal.Notes,
        'Bundled through integrated PT Processing.'
      )
      });
      applySinglePTStatusChange_(
        deal.PT_Game_ID,
        status,
        'Bundled'
      );
      const bundledTransactionId = postPTBundledTransaction_(
        deal.PT_Deal_ID,
      context.game.PT_Game_ID,
      context.formNumber,
      context.serialNumber,
      'Known identified Unbundled deal was bundled.'
    );

    return {
      dealId: String(deal.PT_Deal_ID),
      action: 'Bundled existing identified deal',
        appendPerformance: consumePTBundlingAppendPerformance_(),
      adjustmentTransactionId: '',
      bundledTransactionId: bundledTransactionId,
      issueId: '',
      resolvedIssueIds: []
    };
  }

  if (status === 'Missing') {
    updateRecordRow_('PT_Deals', deal._rowNumber, {
      Deal_Status: 'Bundled',
      Bundled_Date: now_(),
      Notes: appendInventoryNote_(
        deal.Notes,
        'Missing deal recovered and bundled through integrated PT Processing.'
      )
      });
      applySinglePTStatusChange_(
        deal.PT_Game_ID,
        status,
        'Bundled'
      );
    const adjustmentTransactionId = postInventoryTransaction_({
      effectiveDate: now_(),
      inventoryType: 'PT',
      productId: context.game.PT_Game_ID,
      itemId: deal.PT_Deal_ID,
      formNumber: context.formNumber,
      serialNumber: context.serialNumber,
      transactionType: 'Adjustment',
      quantityChange: 1,
      unit: 'Deal',
      source: 'PT Processing',
      notes: 'Missing deal recovered during PT bundling.'
    });

    const resolvedIssueIds = resolveOpenPTIssuesForDeal_(
      deal,
      'Resolved when the missing deal was recovered during PT bundling.'
    );

    const bundledTransactionId = postPTBundledTransaction_(
      deal.PT_Deal_ID,
      context.game.PT_Game_ID,
      context.formNumber,
      context.serialNumber,
      'Recovered Missing deal was bundled.'
    );

    return {
      dealId: String(deal.PT_Deal_ID),
      action: 'Recovered missing deal and bundled it',
      adjustmentTransactionId: adjustmentTransactionId,
      bundledTransactionId: bundledTransactionId,
      issueId: '',
      resolvedIssueIds: resolvedIssueIds
    };
  }

  throw new Error(
    `Deal ${context.formNumber}/${context.serialNumber} has status ${status} ` +
    'and cannot be bundled. Use reconciliation or administrative review.'
  );
}


function bundleNewlyIdentifiedPTDeal_(context) {
  const anonymousDeal = context.bundlingDeals.find((deal) => {
    return (
      String(deal.PT_Game_ID) === String(context.gameId) &&
      !normalizeText_(deal.Serial_Number) &&
      String(deal.Deal_Status) === 'Unbundled'
    );
  });

  if (anonymousDeal) {
    updateRecordRow_('PT_Deals', anonymousDeal._rowNumber, {
      Form_Number: context.formNumber,
      Serial_Number: context.serialNumber,
      Deal_Status: 'Bundled',
      Bundled_Date: now_(),
      Notes: appendInventoryNote_(
        anonymousDeal.Notes,
        'Serial assigned and deal bundled through integrated PT Processing.'
      )
      });
      applySinglePTStatusChange_(
        anonymousDeal.PT_Game_ID,
        'Unbundled',
        'Bundled'
      );
      const bundledTransactionId = postPTBundledTransaction_(
        anonymousDeal.PT_Deal_ID,
      context.game.PT_Game_ID,
      context.formNumber,
      context.serialNumber,
      'Anonymous ordered deal was identified and bundled.'
    );

    return {
      dealId: String(anonymousDeal.PT_Deal_ID),
      action: 'Identified and bundled ordered deal',
        appendPerformance: consumePTBundlingAppendPerformance_(),
      adjustmentTransactionId: '',
      bundledTransactionId: bundledTransactionId,
      issueId: '',
      resolvedIssueIds: []
    };
  }

  const dealId = createPTDeal_({
    gameId: context.game.PT_Game_ID,
    formNumber: context.formNumber,
    serialNumber: context.serialNumber,
    status: 'Bundled',
    receivedDate: now_(),
    notes: 'Unexpected deal found and bundled through integrated PT Processing.'
  });
  applySinglePTStatusChange_(
    context.game.PT_Game_ID,
    '',
    'Bundled'
  );

  const adjustmentTransactionId = postInventoryTransaction_({
    effectiveDate: now_(),
    inventoryType: 'PT',
    productId: context.game.PT_Game_ID,
    itemId: dealId,
    formNumber: context.formNumber,
    serialNumber: context.serialNumber,
    transactionType: 'Adjustment',
    quantityChange: 1,
    unit: 'Deal',
    source: 'PT Processing',
    notes: 'Unexpected deal found during PT bundling.'
  });

  const issueId = createInventoryIssue_({
    inventoryType: 'PT',
    issueType: 'Unexpected Deal',
    productId: context.game.PT_Game_ID,
    itemId: dealId,
    formNumber: context.formNumber,
    serialNumber: context.serialNumber,
    expectedQuantity: 0,
    reportedQuantity: 1,
    discrepancyAmount: 1,
    notes:
      'No anonymous Unbundled deal was available during PT bundling. ' +
      `Transaction ${adjustmentTransactionId}.`
  });

  const bundledTransactionId = postPTBundledTransaction_(
    dealId,
    context.game.PT_Game_ID,
    context.formNumber,
    context.serialNumber,
    'Unexpected deal was recorded and bundled.'
  );

  return {
    dealId: dealId,
    action: 'Recorded unexpected deal and bundled it',
    adjustmentTransactionId: adjustmentTransactionId,
    bundledTransactionId: bundledTransactionId,
    issueId: issueId,
    resolvedIssueIds: []
  };
}


function postPTBundledTransaction_(dealId, gameId, formNumber, serialNumber, notes) {
  const perf = {startedAt:Date.now(), steps:[]};
  PT_BUNDLING_APPEND_PERF_ = perf;
  const idAt = Date.now();
  const transactionId = generateId_('TRANSACTION', 'TX-', 7);
  perf.steps.push({name:'Transaction ID', ms:Date.now()-idAt});
  const timestamp = now_();
  const record = buildInventoryTransactionRecord_({
    effectiveDate:timestamp,inventoryType:'PT',productId:gameId,itemId:dealId,
    formNumber:formNumber,serialNumber:serialNumber,transactionType:'Bundled',quantityChange:0,
    unit:'Deal',source:'PT Processing',notes:notes
  }, transactionId, timestamp);
  appendRecords_('Transactions', [record]);
  perf.totalMs = Date.now() - perf.startedAt;
  return transactionId;
}


function resolveOpenPTIssuesForDeal_(deal, resolutionNote) {
  const resolvedIssueIds = [];

  getRecords_('Inventory_Issues')
    .filter((issue) => {
      const sameItem =
        String(issue.Item_ID) === String(deal.PT_Deal_ID);

      const sameSerial =
          String(issue.Product_ID) === String(deal.PT_Game_ID) &&
          normalizeText_(issue.Serial_Number) ===
            normalizeText_(deal.Serial_Number);

      return (
        String(issue.Inventory_Type) === 'PT' &&
        String(issue.Status) === 'Open' &&
        (sameItem || sameSerial)
      );
    })
    .forEach((issue) => {
        resolveInventoryIssueRecord_(issue, resolutionNote);

      resolvedIssueIds.push(String(issue.Issue_ID));
    });

  return resolvedIssueIds;
}
/**
 * PTReconciliation.gs
 * LBA Bingo Inventory Management v1.5
 *
 * PT-specific reconciliation workflow.
 *
 * V1.5 rules:
 * - Existing PT deals are identified by PT_Deal_ID.
 * - Existing deals may retain a blank serial, including when marked Missing.
 * - Existing serial numbers may be entered or corrected during reconciliation.
 * - A newly discovered physical deal must have a serial number.
 * - Quantity corrections occur only when available-inventory status changes.
 */


function getPTReconciliationBootstrap(token) {
  requireAdmin_(token);

  return {
    forms: buildPTFormOptions_(),
    statuses: PT_DEAL_STATUSES,
    gameTypes: PT_GAME_TYPES
  };
}



function consumePTBundlingAppendPerformance_() {
  const perf = PT_BUNDLING_APPEND_PERF_;
  PT_BUNDLING_APPEND_PERF_ = null;
  return perf;
}

function getPTDealsForForm(token, gameId, formNumber) {
  requireAdmin_(token);
  const game = getPTGameById_(gameId, {includeInactive:true});
  if (!game) throw new Error('PT game was not found.');
  const primaryFormNumber = normalizeFormNumber_(game.Primary_Form_Number);
  return getPTDeals_()
    .filter((deal) => {
      return String(deal.PT_Game_ID) === String(gameId) &&
        !['Sold','Returned','Destroyed'].includes(String(deal.Deal_Status));
    })
    .map((deal) => ({
      dealId: String(deal.PT_Deal_ID),
      gameId: String(deal.PT_Game_ID),
      formNumber: primaryFormNumber,
      serialNumber: normalizeText_(deal.Serial_Number),
      recordedStatus: String(deal.Deal_Status),
      notes: normalizeText_(deal.Notes)
    }))
    .sort((a,b) => (a.serialNumber || a.dealId).localeCompare(
      b.serialNumber || b.dealId, undefined, {numeric:true}
    ));
}


function savePTReconciliation(token, payload) {
  requireAdmin_(token);

  payload = payload || {};

  const gameId = normalizeText_(payload.gameId);
  const selectedFormNumber = normalizeFormNumber_(payload.formNumber);
  const observations = Array.isArray(payload.deals)
    ? payload.deals
    : [];

  if (!gameId || !selectedFormNumber) {
    throw new Error('Select a PT game/form.');
  }

  if (observations.length === 0) {
    throw new Error('No deal observations were entered.');
  }

  const game = getPTGameById_(gameId, {includeInactive:true});
  if (!game) throw new Error('Selected PT game was not found.');
  const formNumber = normalizeFormNumber_(game.Primary_Form_Number);
  const effectiveDate = payload.effectiveDate
    ? new Date(`${payload.effectiveDate}T12:00:00`)
    : now_();


  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);

  try {
      validatePTReconciliationObservations_(
        gameId,
        formNumber,
        observations
      );
    const results = observations.map((observation) => {
      const dealId = normalizeText_(observation.dealId);

      if (dealId) {
        return reconcileExistingPTDeal_({
          gameId: gameId,
          formNumber: formNumber,
          effectiveDate: effectiveDate,
          observation: observation
        });
      }

      return reconcileNewlyDiscoveredPTDeal_({
        gameId: gameId,
        formNumber: formNumber,
        effectiveDate: effectiveDate,
        observation: observation
      });
    });

    return {
      saved: results.filter((result) => result.result === 'Saved').length,
      unchanged: results.filter((result) => result.result === 'No change').length,
      results: results
    };
  } finally {
    lock.releaseLock();
  }
}


/**
 * Validates the complete submitted reconciliation before changing inventory.
 */
function validatePTReconciliationObservations_(
  gameId,
  formNumber,
  observations
) {
  const submittedDealIds = new Set();
  const submittedSerials = new Set();

  observations.forEach((observation, index) => {
    const rowNumber = index + 1;
    const dealId = normalizeText_(observation.dealId);
    const serialNumber = normalizeText_(observation.serialNumber);
    const observedStatus = normalizeText_(observation.observedStatus);

    if (!PT_DEAL_STATUSES.includes(observedStatus)) {
      throw new Error(
        `Row ${rowNumber} has an invalid observed status.`
      );
    }

    if (dealId) {
      if (submittedDealIds.has(dealId)) {
        throw new Error(
          `Deal ${dealId} appears more than once in the reconciliation.`
        );
      }

      submittedDealIds.add(dealId);

      const existingDeal = findPTDealById_(dealId);

      if (!existingDeal) {
        throw new Error(
          `Existing deal ${dealId} could not be found.`
        );
      }

      if (
        String(existingDeal.PT_Game_ID) !== String(gameId)
      ) {
        throw new Error(
          `Deal ${dealId} does not belong to the selected PT game.`
        );
      }
    } else if (!serialNumber) {
      throw new Error(
        `New physical deal on row ${rowNumber} requires a serial number.`
      );
    }

    if (serialNumber) {
      const serialKey = `${gameId}::${serialNumber}`;

      if (submittedSerials.has(serialKey)) {
        throw new Error(
          `Serial ${serialNumber} appears more than once in the reconciliation.`
        );
      }

      submittedSerials.add(serialKey);

      const conflict = findConflictingPTSerial_(
        gameId,
        serialNumber,
        dealId
      );

      if (conflict) {
        throw new Error(
          `Serial ${serialNumber} is already assigned to ` +
          `${conflict.PT_Deal_ID}.`
        );
      }
    }
  });
}


/**
 * Appends a new note to an existing semicolon-delimited Notes history.
 *
 * Existing notes are preserved. Blank additions do not alter the history.
 * The new note is appended exactly once using "; " as the separator.
 *
 * @param {*} existingNotes
 * @param {*} newNote
 * @return {string}
 */
function appendPTDealNote_(existingNotes, newNote) {
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


function reconcileExistingPTDeal_(context) {
  const observation = context.observation;
  const dealId = normalizeText_(observation.dealId);
  const existingDeal = findPTDealById_(dealId);

  if (!existingDeal) {
    throw new Error(`Existing deal ${dealId} could not be found.`);
  }

  const recordedSerial = normalizeText_(existingDeal.Serial_Number);
  const observedSerial = normalizeText_(observation.serialNumber);
  const recordedStatus = String(existingDeal.Deal_Status);
  const observedStatus = normalizeText_(observation.observedStatus);
  const existingNotes = normalizeText_(existingDeal.Notes);
  const reconciliationNote = normalizeText_(observation.notes);

  const serialChanged = recordedSerial !== observedSerial;
  const formChanged =
    normalizeFormNumber_(existingDeal.Form_Number) !== context.formNumber;
  const statusChanged = recordedStatus !== observedStatus;

  const noteAdded = Boolean(reconciliationNote);

  if (
    !serialChanged &&
    !formChanged &&
    !statusChanged &&
    !noteAdded
  ) {
    return {
      dealId: dealId,
      serialNumber: observedSerial,
      result: 'No change'
    };
  }

  const expectedQuantity = ptAvailabilityQuantity_(recordedStatus);
  const observedQuantity = ptAvailabilityQuantity_(observedStatus);

  const notes = buildPTReconciliationNotes_(
    recordedSerial,
    observedSerial,
    recordedStatus,
    observedStatus,
    reconciliationNote
  );

    const reconciliation = createReconciliationRecord_({
      inventoryType: 'PT',
      productId: context.gameId,
    itemId: dealId,
    formNumber: context.formNumber,
    serialNumber: observedSerial,
    reconciliationType: 'Inventory Check',
    expectedQuantity: expectedQuantity,
    observedQuantity: observedQuantity,
    observedPTStatus: observedStatus,
    issueId: observation.issueId || '',
    notes: notes
  });

  const rowUpdates = {};

  if (formChanged) {
    rowUpdates.Form_Number = context.formNumber;
  }

  if (serialChanged) {
    rowUpdates.Serial_Number = observedSerial;
  }

  if (statusChanged) {
    rowUpdates.Deal_Status = observedStatus;

    if (
      observedStatus === 'Bundled' &&
      !existingDeal.Bundled_Date
    ) {
      rowUpdates.Bundled_Date = context.effectiveDate;
    }

    if (
      ['Sold', 'Returned', 'Destroyed'].includes(observedStatus) &&
      !existingDeal.Expended_Date
    ) {
      rowUpdates.Expended_Date = context.effectiveDate;
    }
  }

  if (noteAdded) {
    rowUpdates.Notes = appendPTDealNote_(
      existingNotes,
      reconciliationNote
    );
  }

  updateRecordRow_(
    'PT_Deals',
    existingDeal._rowNumber,
    rowUpdates
  );

    if (statusChanged) {
      applySinglePTStatusChange_(
        existingDeal.PT_Game_ID,
        recordedStatus,
        observedStatus
      );
    }
    let transactionId = '';
    if (reconciliation.correction !== 0) {
    transactionId = postInventoryTransaction_({
      effectiveDate: context.effectiveDate,
      inventoryType: 'PT',
      productId: context.gameId,
      itemId: dealId,
      formNumber: context.formNumber,
      serialNumber: observedSerial,
      transactionType: 'Adjustment',
      quantityChange: reconciliation.correction,
      unit: 'Deal',
      source: 'Inventory Reconciliation',
      reconciliationId: reconciliation.id,
      notes: notes
    });

    linkReconciliationTransaction_(
      reconciliation.id,
      transactionId
    );
  }

  return {
    dealId: dealId,
    serialNumber: observedSerial,
    reconciliationId: reconciliation.id,
    transactionId: transactionId,
    result: 'Saved'
  };
}


function reconcileNewlyDiscoveredPTDeal_(context) {
  const observation = context.observation;
  const serialNumber = normalizeText_(observation.serialNumber);
  const observedStatus = normalizeText_(observation.observedStatus);

  if (!serialNumber) {
    throw new Error(
      'A newly discovered physical deal requires a serial number.'
    );
  }

  const observedQuantity = ptAvailabilityQuantity_(observedStatus);

  const notes = normalizeText_(observation.notes) ||
    'New physical deal discovered during inventory reconciliation.';

  const dealId = createPTDeal_({
    gameId: context.gameId,
    formNumber: context.formNumber,
    serialNumber: serialNumber,
    status: observedStatus,
    receivedDate: context.effectiveDate,
    notes: notes
  });
  applySinglePTStatusChange_(
    context.gameId,
    '',
    observedStatus
  );

  const reconciliation = createReconciliationRecord_({
    inventoryType: 'PT',
    productId: context.gameId,
    itemId: dealId,
    formNumber: context.formNumber,
    serialNumber: serialNumber,
    reconciliationType: 'Inventory Check',
    expectedQuantity: 0,
    observedQuantity: observedQuantity,
    observedPTStatus: observedStatus,
    issueId: observation.issueId || '',
    notes: notes
  });

  let transactionId = '';

  if (reconciliation.correction !== 0) {
    transactionId = postInventoryTransaction_({
      effectiveDate: context.effectiveDate,
      inventoryType: 'PT',
      productId: context.gameId,
      itemId: dealId,
      formNumber: context.formNumber,
      serialNumber: serialNumber,
      transactionType: 'Adjustment',
      quantityChange: reconciliation.correction,
      unit: 'Deal',
      source: 'Inventory Reconciliation',
      reconciliationId: reconciliation.id,
      notes: notes
    });

    linkReconciliationTransaction_(
      reconciliation.id,
      transactionId
    );
  }

  return {
    dealId: dealId,
    serialNumber: serialNumber,
    reconciliationId: reconciliation.id,
    transactionId: transactionId,
    result: 'Saved'
  };
}


function buildPTReconciliationNotes_(
  recordedSerial,
  observedSerial,
  recordedStatus,
  observedStatus,
  administratorNotes
) {
  const changes = [];

  if (recordedSerial !== observedSerial) {
    changes.push(
      `Serial changed from ${recordedSerial || '[blank]'} ` +
      `to ${observedSerial || '[blank]'}.`
    );
  }

  if (recordedStatus !== observedStatus) {
    changes.push(
      `Status changed from ${recordedStatus} to ${observedStatus}.`
    );
  }

  const notes = normalizeText_(administratorNotes);

  if (notes) {
    changes.push(notes);
  }

  return changes.join(' ');
}
