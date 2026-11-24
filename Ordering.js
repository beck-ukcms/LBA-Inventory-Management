/**
 * Ordering.js
 * Administrator-entered stock ordering.
 * Scope: Validates catalog selections and adds anonymous PT deals or Paper cases with receipt Transactions.
 * Current as of v1.20.
 */
function recordPTOrder(token, payload) {
  requireAdmin_(token);
  payload = payload || {};
  const gameId = normalizeText_(payload.gameId);
  const catalogGame = getPTGameById_(gameId);
  if (!catalogGame) {
    throw new Error(`PT Game ${gameId} was not found in PT_Catalog.`);
  }
  const primaryFormNumber = normalizeFormNumber_(catalogGame.Primary_Form_Number);
  const catalogDealsPerCase = integerOrThrow_(
    catalogGame.Deals_Per_Case,
    'Catalog Deals per Case',
    {allowZero:false}
  );
  const casesOrdered = integerOrThrow_(payload.cases, 'Cases Ordered');
  const looseDeals = integerOrThrow_(payload.looseDeals || 0, 'Loose Deals');
  const quantity = casesOrdered * catalogDealsPerCase + looseDeals;
  if (quantity <= 0) throw new Error('The order must add at least one PT deal.');
  const effectiveDate = payload.effectiveDate
    ? new Date(`${payload.effectiveDate}T12:00:00`) : now_();
  const notes = normalizeText_(payload.notes) ||
    `${casesOrdered} case(s) and ${looseDeals} loose deal(s) ordered.`;
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    const dealIds = createAnonymousPTStock_({
      gameId: gameId,
      formNumber: primaryFormNumber,
      quantity: quantity,
      status: 'Unbundled',
      effectiveDate: effectiveDate,
      transactionType: 'Received',
      source: 'Inventory Ordering',
      notes: notes
    });
    return {
      quantity: quantity,
      casesOrdered: casesOrdered,
      looseDeals: looseDeals,
      dealsPerCase: catalogDealsPerCase,
      dealIds: dealIds,
      formNumber: primaryFormNumber
    };
  } finally {
    lock.releaseLock();
  }
}


function recordPaperOrder(token, payload) {
  requireAdmin_(token);

  payload = payload || {};

  const casesOrdered = integerOrThrow_(
    payload.cases,
    'Cases Ordered',
    { allowZero: false }
  );

  const catalogPaper = getPaperCatalog_().find((paper) => {
    return String(paper.Paper_ID) === String(payload.paperId);
  });

  if (!catalogPaper) {
    throw new Error(
      `Paper type ${payload.paperId} was not found in Paper_Catalog.`
    );
  }

  const packsPerCase = integerOrThrow_(
    catalogPaper.Packs_Per_Case,
    'Catalog Packs per Case',
    { allowZero: false }
  );

  const effectiveDate = payload.effectiveDate
    ? new Date(`${payload.effectiveDate}T12:00:00`)
    : now_();

  const notes = normalizeText_(payload.notes) ||
    `${casesOrdered} paper case(s) ordered.`;

  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);

  try {
    const caseIds = createAnonymousPaperStock_({
      paperId: payload.paperId,
      cases: casesOrdered,
      packsPerCase: packsPerCase,
      effectiveDate: effectiveDate,
      transactionType: 'Received',
      source: 'Inventory Ordering',
      notes: notes
    });

    return {
      cases: casesOrdered,
      packs: casesOrdered * packsPerCase,
      packsPerCase: packsPerCase,
      caseIds: caseIds
    };
  } finally {
    lock.releaseLock();
  }
}
