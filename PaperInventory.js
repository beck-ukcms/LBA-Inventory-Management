/**
 * PaperReconciliation.gs
 * LBA Bingo Inventory Management v1.9
 *
 * Serial/case-level paper reconciliation.
 */

const PAPER_CASE_STATUSES = [
  'Unopened',
  'Opened',
  'Expended',
  'Missing'
];


/**
 * Derives the required physical status from a reconciled pack count.
 * Missing remains an explicit administrator choice. An already-opened case
 * does not become Unopened merely because a correction restores full quantity.
 */
function derivePaperCaseStatus_(
  requestedStatus,
  recordedStatus,
  observedPacks,
  packsPerCase
) {
  if (requestedStatus === 'Missing') {
    return 'Missing';
  }
  if (observedPacks === 0) {
    return 'Expended';
  }
  if (observedPacks < packsPerCase) {
    return 'Opened';
  }
  if (recordedStatus === 'Opened') {
    return 'Opened';
  }
  return requestedStatus;
}


function getPaperPacksPerCase_(paperId) {
  const paper = getPaperCatalog_().find((catalogRow) => {
    return String(catalogRow.Paper_ID) === String(paperId);
  });
  if (!paper) {
    throw new Error(`Paper type ${paperId} was not found.`);
  }
  return integerOrThrow_(
    paper.Packs_Per_Case,
    'Packs per Case',
    { allowZero: false }
  );
}


function getPaperReconciliationBootstrap(token) {
  requireAdmin_(token);

  const paperTypes = getPaperCatalog_()
    .filter((paper) => {
      return (
        paper.Active === true ||
        String(paper.Active).toLowerCase() === 'true'
      );
    })
    .map((paper) => {
      return {
        paperId: String(paper.Paper_ID),
        shortName: String(paper.Short_Name),
        description: String(paper.Description),
        packsPerCase: Number(paper.Packs_Per_Case),
        label: `${paper.Short_Name} - ${paper.Description}`
      };
    })
    .sort((first, second) => {
      return first.label.localeCompare(second.label);
    });

  return {
    paperTypes: paperTypes,
    statuses: PAPER_CASE_STATUSES
  };
}


function getPaperCasesForReconciliation(token, paperId) {
  requireAdmin_(token);

  return getRecords_('Paper_Cases')
    .filter((paperCase) => {
      return (
        String(paperCase.Paper_ID) === String(paperId) &&
        String(paperCase.Case_Status) !== 'Expended'
      );
    })
    .map((paperCase) => {
      return {
        caseId: String(paperCase.Paper_Case_ID),
        serialNumber: normalizeText_(paperCase.Serial_Number),
        recordedStatus: String(paperCase.Case_Status),
        calculatedPacks: getPaperCasePackBalance_(paperCase.Paper_Case_ID),
        notes: normalizeText_(paperCase.Notes)
      };
    })
    .sort((first, second) => {
      const firstKey = first.serialNumber || first.caseId;
      const secondKey = second.serialNumber || second.caseId;

      return firstKey.localeCompare(
        secondKey,
        undefined,
        { numeric: true }
      );
    });
}


function savePaperReconciliation(token, payload) {
  requireAdmin_(token);

  payload = payload || {};

  const paperId = normalizeText_(payload.paperId);
  const observations = Array.isArray(payload.cases)
    ? payload.cases
    : [];

  if (!paperId) {
    throw new Error('Select a Paper Type.');
  }

  if (!observations.length) {
    throw new Error('No paper-case observations were entered.');
  }

  const effectiveDate = payload.effectiveDate
    ? new Date(`${payload.effectiveDate}T12:00:00`)
    : now_();

  validatePaperReconciliationObservations_(
    paperId,
    observations
  );

  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);

  try {
    const results = observations.map((observation) => {
      if (normalizeText_(observation.caseId)) {
        return reconcileExistingPaperCase_({
          paperId: paperId,
          effectiveDate: effectiveDate,
          observation: observation
        });
      }

      return reconcileNewlyDiscoveredPaperCase_({
        paperId: paperId,
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


function validatePaperReconciliationObservations_(
  paperId,
  observations
) {
  const submittedCaseIds = new Set();
  const submittedSerials = new Set();

  observations.forEach((observation, index) => {
    const displayRow = index + 1;
    const caseId = normalizeText_(observation.caseId);
    const serialNumber = normalizeText_(observation.serialNumber);
    const observedStatus = normalizeText_(observation.observedStatus);
    const observedPacks = Number(observation.observedPacks);

    if (!PAPER_CASE_STATUSES.includes(observedStatus)) {
      throw new Error(
        `Row ${displayRow} has an invalid case status.`
      );
    }

    if (
      !Number.isInteger(observedPacks) ||
      observedPacks < 0
    ) {
      throw new Error(
        `Row ${displayRow} Physical Packs must be a nonnegative whole number.`
      );
    }

    if (caseId) {
      if (submittedCaseIds.has(caseId)) {
        throw new Error(
          `Paper case ${caseId} appears more than once.`
        );
      }

      submittedCaseIds.add(caseId);

      const existingCase = findPaperCaseById_(caseId);

      if (!existingCase) {
        throw new Error(
          `Paper case ${caseId} could not be found.`
        );
      }

      if (String(existingCase.Paper_ID) !== String(paperId)) {
        throw new Error(
          `Paper case ${caseId} does not belong to the selected Paper Type.`
        );
      }
    } else if (!serialNumber) {
      throw new Error(
        `New physical case on row ${displayRow} requires a serial number.`
      );
    }

    if (serialNumber) {
      const serialKey = `${paperId}::${serialNumber}`;

      if (submittedSerials.has(serialKey)) {
        throw new Error(
          `Serial ${serialNumber} appears more than once in the reconciliation.`
        );
      }

      submittedSerials.add(serialKey);

      const conflict = findConflictingPaperSerial_(
        paperId,
        serialNumber,
        caseId
      );

      if (conflict) {
        throw new Error(
          `Serial ${serialNumber} is already assigned to ${conflict.Paper_Case_ID}.`
        );
      }
    }
  });
}


function reconcileExistingPaperCase_(context) {
  const observation = context.observation;
  const caseId = normalizeText_(observation.caseId);
  const existingCase = findPaperCaseById_(caseId);

  if (!existingCase) {
    throw new Error(`Paper case ${caseId} could not be found.`);
  }

  const recordedSerial = normalizeText_(existingCase.Serial_Number);
  const observedSerial = normalizeText_(observation.serialNumber);
  const recordedStatus = String(existingCase.Case_Status);
  const requestedStatus = normalizeText_(observation.observedStatus);
  const expectedPacks = getPaperCasePackBalance_(caseId);
  const observedPacks = Number(observation.observedPacks);
  const packsPerCase = getPaperPacksPerCase_(context.paperId);
  const observedStatus = derivePaperCaseStatus_(
    requestedStatus,
    recordedStatus,
    observedPacks,
    packsPerCase
  );
  const newNote = normalizeText_(observation.notes);

  const serialChanged = recordedSerial !== observedSerial;
  const statusChanged = recordedStatus !== observedStatus;
  const quantityChanged = expectedPacks !== observedPacks;
  const noteAdded = Boolean(newNote);

  if (
    !serialChanged &&
    !statusChanged &&
    !quantityChanged &&
    !noteAdded
  ) {
    return {
      caseId: caseId,
      result: 'No change'
    };
  }

  const eventNotes = buildPaperReconciliationNotes_(
    recordedSerial,
    observedSerial,
    recordedStatus,
    observedStatus,
    expectedPacks,
    observedPacks,
    newNote
  );

  const reconciliation = createReconciliationRecord_({
    inventoryType: 'Paper',
    productId: context.paperId,
    itemId: caseId,
    formNumber: '',
    serialNumber: observedSerial,
    reconciliationType: 'Inventory Check',
    expectedQuantity: expectedPacks,
    observedQuantity: observedPacks,
    observedPTStatus: '',
    issueId: observation.issueId || '',
    notes: eventNotes
  });

  const updates = {};

  if (serialChanged) {
    updates.Serial_Number = observedSerial;
  }

  if (statusChanged) {
    updates.Case_Status = observedStatus;
  }

  if (
    observedStatus === 'Opened' &&
    !existingCase.Opened_Date
  ) {
    updates.Opened_Date = context.effectiveDate;
  }

  if (
    observedStatus === 'Expended' &&
    !existingCase.Expended_Date
  ) {
    updates.Expended_Date = context.effectiveDate;
  }

  if (noteAdded) {
    updates.Notes = appendInventoryNote_(
      existingCase.Notes,
      newNote
    );
  }

  if (Object.keys(updates).length) {
    updateRecordRow_(
      'Paper_Cases',
      existingCase._rowNumber,
      updates
    );
  }

  let transactionId = '';

  if (reconciliation.correction !== 0) {
    transactionId = postInventoryTransaction_({
      effectiveDate: context.effectiveDate,
      inventoryType: 'Paper',
      productId: context.paperId,
      itemId: caseId,
      formNumber: '',
      serialNumber: observedSerial,
      transactionType: 'Adjustment',
      quantityChange: reconciliation.correction,
      unit: 'Pack',
      source: 'Inventory Reconciliation',
      reconciliationId: reconciliation.id,
      notes: eventNotes
    });

    linkReconciliationTransaction_(
      reconciliation.id,
      transactionId
    );
  }

  return {
    caseId: caseId,
    reconciliationId: reconciliation.id,
    transactionId: transactionId,
    result: 'Saved'
  };
}


function reconcileNewlyDiscoveredPaperCase_(context) {
  const observation = context.observation;
  const serialNumber = normalizeText_(observation.serialNumber);
  const observedPacks = Number(observation.observedPacks);
  const requestedStatus = normalizeText_(observation.observedStatus);
  const packsPerCase = getPaperPacksPerCase_(context.paperId);
  const observedStatus = derivePaperCaseStatus_(
    requestedStatus,
    '',
    observedPacks,
    packsPerCase
  );
  const notes = normalizeText_(observation.notes) ||
    'New physical Paper case discovered during inventory reconciliation.';

  if (!serialNumber) {
    throw new Error(
      'A newly discovered physical Paper case requires a serial number.'
    );
  }

  const caseId = createPaperCase_({
    paperId: context.paperId,
    serialNumber: serialNumber,
    status: observedStatus,
    receivedDate: context.effectiveDate,
    notes: notes
  });

  const reconciliation = createReconciliationRecord_({
    inventoryType: 'Paper',
    productId: context.paperId,
    itemId: caseId,
    formNumber: '',
    serialNumber: serialNumber,
    reconciliationType: 'Inventory Check',
    expectedQuantity: 0,
    observedQuantity: observedPacks,
    observedPTStatus: '',
    issueId: observation.issueId || '',
    notes: notes
  });

  let transactionId = '';

  if (reconciliation.correction !== 0) {
    transactionId = postInventoryTransaction_({
      effectiveDate: context.effectiveDate,
      inventoryType: 'Paper',
      productId: context.paperId,
      itemId: caseId,
      formNumber: '',
      serialNumber: serialNumber,
      transactionType: 'Adjustment',
      quantityChange: reconciliation.correction,
      unit: 'Pack',
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
    caseId: caseId,
    reconciliationId: reconciliation.id,
    transactionId: transactionId,
    result: 'Saved'
  };
}


function buildPaperReconciliationNotes_(
  recordedSerial,
  observedSerial,
  recordedStatus,
  observedStatus,
  expectedPacks,
  observedPacks,
  administratorNote
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

  if (expectedPacks !== observedPacks) {
    changes.push(
      `Pack count changed from ${expectedPacks} to ${observedPacks}.`
    );
  }

  const note = normalizeText_(administratorNote);

  if (note) {
    changes.push(note);
  }

  return changes.join(' ');
}
