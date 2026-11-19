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


function getPTDealsForForm(
  token,
  gameId,
  formNumber
) {
  requireAdmin_(token);

  const normalizedFormNumber = normalizeFormNumber_(formNumber);

  return getPTDeals_()
    .filter((deal) => {
      return (
        String(deal.PT_Game_ID) === String(gameId) &&
        normalizeFormNumber_(deal.Form_Number) === normalizedFormNumber &&
        ![
          'Sold',
          'Returned',
          'Destroyed'
        ].includes(String(deal.Deal_Status))
      );
    })
    .map((deal) => {
      return {
        dealId: String(deal.PT_Deal_ID),
        serialNumber: normalizeText_(deal.Serial_Number),
        recordedStatus: String(deal.Deal_Status),
        notes: normalizeText_(deal.Notes)
      };
    })
    .sort((firstDeal, secondDeal) => {
      const firstSerial = firstDeal.serialNumber || firstDeal.dealId;
      const secondSerial = secondDeal.serialNumber || secondDeal.dealId;

      return firstSerial.localeCompare(
        secondSerial,
        undefined,
        { numeric: true }
      );
    });
}


function savePTReconciliation(token, payload) {
  requireAdmin_(token);

  payload = payload || {};

  const gameId = normalizeText_(payload.gameId);
  const formNumber = normalizeFormNumber_(payload.formNumber);
  const observations = Array.isArray(payload.deals)
    ? payload.deals
    : [];

  if (!gameId || !formNumber) {
    throw new Error('Select a PT game/form.');
  }

  if (observations.length === 0) {
    throw new Error('No deal observations were entered.');
  }

  const effectiveDate = payload.effectiveDate
    ? new Date(`${payload.effectiveDate}T12:00:00`)
    : now_();

  validatePTReconciliationObservations_(
    gameId,
    formNumber,
    observations
  );

  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);

  try {
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
        String(existingDeal.PT_Game_ID) !== String(gameId) ||
        normalizeFormNumber_(existingDeal.Form_Number) !== formNumber
      ) {
        throw new Error(
          `Deal ${dealId} does not belong to the selected game/form.`
        );
      }
    } else if (!serialNumber) {
      throw new Error(
        `New physical deal on row ${rowNumber} requires a serial number.`
      );
    }

    if (serialNumber) {
      const serialKey = `${formNumber}::${serialNumber}`;

      if (submittedSerials.has(serialKey)) {
        throw new Error(
          `Serial ${serialNumber} appears more than once in the reconciliation.`
        );
      }

      submittedSerials.add(serialKey);

      const conflict = findConflictingPTSerial_(
        formNumber,
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
  const statusChanged = recordedStatus !== observedStatus;

  const noteAdded = Boolean(reconciliationNote);

  if (
    !serialChanged &&
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
