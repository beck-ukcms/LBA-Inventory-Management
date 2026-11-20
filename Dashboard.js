/** Dashboard and one-stop ordering for Inventory Management v1.13. */
const DASHBOARD_SESSION_WINDOW = 10;
const DASHBOARD_SESSIONS_PER_WEEK = 3;

function getDashboardData() {
  const games = getPTCatalog_().filter(isActiveCatalogRecord_);
  const papers = getPaperCatalog_().filter(isActiveCatalogRecord_);
  const deals = getPTDeals_();
  const cases = getPaperCases_();
  const transactions = getRecords_('Transactions');
  const recentSessionIds = getRecentProcessedSessionIds_(transactions);
  const recentSet = new Set(recentSessionIds);

  const pt = games.map((game) => {
    const gameDeals = deals.filter((deal) => String(deal.PT_Game_ID) === String(game.PT_Game_ID));
    const sold = transactions.filter((transaction) => {
      return String(transaction.Inventory_Type) === 'PT' &&
        String(transaction.Product_ID) === String(game.PT_Game_ID) &&
        String(transaction.Transaction_Type) === 'Sold' &&
        recentSet.has(String(transaction.Session_ID));
    }).length;
    return {
      gameId: String(game.PT_Game_ID),
      formNumber: normalizeFormNumber_(game.Primary_Form_Number),
      label: `${game.Game_Name} (${normalizeFormNumber_(game.Primary_Form_Number)})`,
      onHand: gameDeals.filter((deal) => ['Unbundled', 'Bundled'].includes(String(deal.Deal_Status))).length,
      targetOnHand: Number(game.Target_On_Hand || 0),
      bundled: gameDeals.filter((deal) => String(deal.Deal_Status) === 'Bundled').length,
      targetBundled: Number(game.Target_Bundled || 0),
      soldPerWeek: recentSessionIds.length ? sold / recentSessionIds.length * DASHBOARD_SESSIONS_PER_WEEK : 0,
      netProfitPerDollar: Number(game.Net_Income_Per_Patron_Dollar || 0)
    };
  }).sort((a, b) => b.soldPerWeek - a.soldPerWeek || a.label.localeCompare(b.label));

  const paper = papers.map((catalogRow) => {
    const productCases = cases.filter((paperCase) => String(paperCase.Paper_ID) === String(catalogRow.Paper_ID));
    const caseIds = new Set(productCases.map((paperCase) => String(paperCase.Paper_Case_ID)));
    const packsOnHand = transactions.filter((transaction) => {
      return String(transaction.Inventory_Type) === 'Paper' && caseIds.has(String(transaction.Item_ID));
    }).reduce((sum, transaction) => sum + Number(transaction.Quantity_Change || 0), 0);
    const soldPacks = -transactions.filter((transaction) => {
      return String(transaction.Inventory_Type) === 'Paper' &&
        String(transaction.Product_ID) === String(catalogRow.Paper_ID) &&
        String(transaction.Transaction_Type) === 'Sold' &&
        recentSet.has(String(transaction.Session_ID));
    }).reduce((sum, transaction) => sum + Number(transaction.Quantity_Change || 0), 0);
    return {
      paperId: String(catalogRow.Paper_ID),
      label: `${catalogRow.Short_Name} - ${catalogRow.Description}`,
      packsOnHand: packsOnHand,
      targetOnHand: Number(catalogRow.Target_On_Hand || 0),
      soldPerWeek: recentSessionIds.length ? soldPacks / recentSessionIds.length * DASHBOARD_SESSIONS_PER_WEEK : 0,
      netProfitPerDollar: Number(catalogRow.Net_Income_Per_Patron_Dollar || 0),
      packsPerCase: Number(catalogRow.Packs_Per_Case || 0)
    };
  }).sort((a, b) => b.soldPerWeek - a.soldPerWeek || a.label.localeCompare(b.label));

  return { pt, paper, sessionCount: recentSessionIds.length };
}

function isActiveCatalogRecord_(record) {
  return record.Active === true || String(record.Active).toLowerCase() === 'true';
}

function getRecentProcessedSessionIds_(transactions) {
  const markers = transactions.filter((transaction) => {
    return String(transaction.Inventory_Type) === 'System' &&
      String(transaction.Transaction_Type) === 'Session Processed' &&
      normalizeText_(transaction.Session_ID);
  }).sort((a, b) => new Date(b.Effective_Date) - new Date(a.Effective_Date));
  return [...new Set(markers.map((marker) => String(marker.Session_ID)))].slice(0, DASHBOARD_SESSION_WINDOW);
}

function placeDashboardOrder(adminCode, order) {
  const authentication = authenticateAdmin(adminCode);
  if (!authentication.ok) throw new Error(authentication.message);
  try {
    return placeDashboardOrderWithToken_(authentication.token, order);
  } finally {
    endAdminSession(authentication.token);
  }
}

function placeDashboardOrderWithToken_(token, order) {
  requireAdmin_(token);
  order = order || {};
  const ptLines = Array.isArray(order.pt) ? order.pt : [];
  const paperLines = Array.isArray(order.paper) ? order.paper : [];
  if (!ptLines.length && !paperLines.length) throw new Error('Enter at least one order quantity.');
  const games = getPTCatalog_();
  const papers = getPaperCatalog_();
  const validatedPT = ptLines.map((line) => {
    const quantity = integerOrThrow_(line.quantity, 'PT deals to order', { allowZero: false });
    const game = games.find((row) => String(row.PT_Game_ID) === String(line.gameId));
    if (!game || !isActiveCatalogRecord_(game)) throw new Error('An ordered PT game is unavailable.');
    return { game, quantity };
  });
  const validatedPaper = paperLines.map((line) => {
    const quantity = integerOrThrow_(line.quantity, 'Paper cases to order', { allowZero: false });
    const paper = papers.find((row) => String(row.Paper_ID) === String(line.paperId));
    if (!paper || !isActiveCatalogRecord_(paper)) throw new Error('An ordered Paper type is unavailable.');
    return { paper, quantity };
  });

  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    let ptDeals = 0;
    let paperCases = 0;
    validatedPT.forEach(({game, quantity}) => {
      createAnonymousPTStock_({
        gameId: String(game.PT_Game_ID),
        formNumber: normalizeFormNumber_(game.Primary_Form_Number),
        quantity,
        status: 'Unbundled',
        effectiveDate: now_(),
        transactionType: 'Received',
        source: 'Inventory Ordering',
        notes: `Dashboard order: ${quantity} deal(s).`
      });
      ptDeals += quantity;
    });
    validatedPaper.forEach(({paper, quantity}) => {
      createAnonymousPaperStock_({
        paperId: String(paper.Paper_ID),
        cases: quantity,
        packsPerCase: integerOrThrow_(paper.Packs_Per_Case, 'Packs per Case', { allowZero: false }),
        effectiveDate: now_(),
        transactionType: 'Received',
        source: 'Inventory Ordering',
        notes: `Dashboard order: ${quantity} case(s).`
      });
      paperCases += quantity;
    });
    return { ptDeals, paperCases, lineCount: validatedPT.length + validatedPaper.length };
  } finally {
    lock.releaseLock();
  }
}
