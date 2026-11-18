/**
 * PTBundling.js
 * LBA Bingo Inventory Management v1.11
 *
 * Public operational PT bundling workflow. No administrator token is required.
 */


function getPTBundlingGames() {
  return buildPTFormOptions_().map((option) => {
    const game = getPTCatalog_().find((catalogRow) => {
      return String(catalogRow.PT_Game_ID) === String(option.gameId);
    });

    return {
      gameId: option.gameId,
      formNumber: option.formNumber,
      name: option.gameName,
      cards: String(game.Cards_Per_Deal || ''),
      payout: String(game.Payout_Per_Deal || '')
    };
  });
}


/**
 * Bundles one physical PT deal and returns receipt data.
 */
function bundlePTDeal(formNumber, serialNumber) {
  const normalizedForm = normalizeFormNumber_(formNumber);
  const normalizedSerial = normalizeText_(serialNumber);

  if (!normalizedForm || !normalizedSerial) {
    throw new Error('Enter both a Form Number and Serial Number.');
  }

  const formOption = buildPTFormOptions_().find((option) => {
    return option.formNumber === normalizedForm;
  });

  if (!formOption) {
    throw new Error(`Form Number ${normalizedForm} was not found.`);
  }

  const game = getPTCatalog_().find((catalogRow) => {
    return String(catalogRow.PT_Game_ID) === String(formOption.gameId);
  });

  if (!game) {
    throw new Error(`Game ${formOption.gameId} was not found.`);
  }

  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);

  try {
    const existingDeal = findPTDeal_(
      normalizedForm,
      normalizedSerial
    );

    let result;

    if (existingDeal) {
      result = bundleExistingIdentifiedPTDeal_({
        deal: existingDeal,
        game: game,
        formNumber: normalizedForm,
        serialNumber: normalizedSerial
      });
    } else {
      result = bundleNewlyIdentifiedPTDeal_({
        game: game,
        formNumber: normalizedForm,
        serialNumber: normalizedSerial
      });
    }

    return Object.assign(result, {
      gameId: String(game.PT_Game_ID),
      gameName: String(game.Game_Name),
      formNumber: normalizedForm,
      serialNumber: normalizedSerial,
      cards: String(game.Cards_Per_Deal || ''),
      payout: String(game.Payout_Per_Deal || '')
    });
  } finally {
    lock.releaseLock();
  }
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
  const anonymousDeal = getPTDeals_().find((deal) => {
    return (
      String(deal.PT_Game_ID) === String(context.game.PT_Game_ID) &&
      normalizeFormNumber_(deal.Form_Number) === context.formNumber &&
      !normalizeText_(deal.Serial_Number) &&
      String(deal.Deal_Status) === 'Unbundled'
    );
  });

  if (anonymousDeal) {
    updateRecordRow_('PT_Deals', anonymousDeal._rowNumber, {
      Serial_Number: context.serialNumber,
      Deal_Status: 'Bundled',
      Bundled_Date: now_(),
      Notes: appendInventoryNote_(
        anonymousDeal.Notes,
        'Serial assigned and deal bundled through integrated PT Processing.'
      )
    });

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


function postPTBundledTransaction_(
  dealId,
  gameId,
  formNumber,
  serialNumber,
  notes
) {
  return postInventoryTransaction_({
    effectiveDate: now_(),
    inventoryType: 'PT',
    productId: gameId,
    itemId: dealId,
    formNumber: formNumber,
    serialNumber: serialNumber,
    transactionType: 'Bundled',
    quantityChange: 0,
    unit: 'Deal',
    source: 'PT Processing',
    notes: notes
  });
}


function resolveOpenPTIssuesForDeal_(deal, resolutionNote) {
  const resolvedIssueIds = [];

  getRecords_('Inventory_Issues')
    .filter((issue) => {
      const sameItem =
        String(issue.Item_ID) === String(deal.PT_Deal_ID);

      const sameSerial =
        normalizeFormNumber_(issue.Form_Number) ===
          normalizeFormNumber_(deal.Form_Number) &&
        normalizeText_(issue.Serial_Number) ===
          normalizeText_(deal.Serial_Number);

      return (
        String(issue.Inventory_Type) === 'PT' &&
        String(issue.Status) === 'Open' &&
        (sameItem || sameSerial)
      );
    })
    .forEach((issue) => {
      updateRecordRow_('Inventory_Issues', issue._rowNumber, {
        Status: 'Resolved',
        Notes: appendInventoryNote_(issue.Notes, resolutionNote)
      });

      resolvedIssueIds.push(String(issue.Issue_ID));
    });

  return resolvedIssueIds;
}
