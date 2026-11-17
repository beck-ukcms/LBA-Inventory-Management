/**
 * Ordering.gs
 * LBA Bingo Inventory Management v1.4
 *
 * Records Director-entered inventory orders.
 *
 * V1.4 changes:
 * - Deals per Case is authoritative from PT_Catalog.
 * - The browser no longer supplies or controls Deals per Case.
 * - The entire order is validated before any inventory record is created.
 */

function recordPTOrder(token, payload) {
  requireAdmin_(token);

  payload = payload || {};

  const gameId = normalizeText_(payload.gameId);
  const formNumber = normalizeFormNumber_(payload.formNumber);

  const catalogGame = getPTCatalog_().find((game) => {
    return String(game.PT_Game_ID) === gameId;
  });

  if (!catalogGame) {
    throw new Error(
      `PT Game ${gameId} was not found in PT_Catalog.`
    );
  }

  const catalogDealsPerCase = integerOrThrow_(
    catalogGame.Deals_Per_Case,
    'Catalog Deals per Case',
    { allowZero: false }
  );

  const validForms = [
    normalizeFormNumber_(catalogGame.Primary_Form_Number),
    ...splitAlternateForms_(catalogGame.Alternate_Form_Numbers)
  ];

  if (!validForms.includes(formNumber)) {
    throw new Error(
      `Form ${formNumber} is not assigned to ${catalogGame.Game_Name}.`
    );
  }

  const casesOrdered = integerOrThrow_(
    payload.cases,
    'Cases Ordered'
  );

  const looseDeals = integerOrThrow_(
    payload.looseDeals || 0,
    'Loose Deals'
  );

  const quantity =
    (casesOrdered * catalogDealsPerCase) +
    looseDeals;

  if (quantity <= 0) {
    throw new Error(
      'The order must add at least one PT deal.'
    );
  }

  const effectiveDate = payload.effectiveDate
    ? new Date(`${payload.effectiveDate}T12:00:00`)
    : now_();

  const notes = normalizeText_(payload.notes) ||
    `${casesOrdered} case(s) and ${looseDeals} loose deal(s) ordered.`;

  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);

  try {
    const dealIds = createAnonymousPTStock_({
      gameId: gameId,
      formNumber: formNumber,
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
      dealIds: dealIds
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
