/**
 * Dashboard.js
 * Inventory dashboard and consolidated ordering.
 * Scope: Calculates rolling usage, presents materialized inventory health, and records multi-product dashboard orders.
 * Current as of v1.20.
 */
const DASHBOARD_SESSIONS_PER_WEEK = 3;
function getDashboardData() {
  const games = getPTCatalog_().filter(isActiveCatalogRecord_);
  const papers = getPaperCatalog_().filter(isActiveCatalogRecord_);
  const archivedSessions = getArchivedSessions_();
  const selectedSessions = selectDashboardSessionWindow_(archivedSessions);
  const ptSoldPerWeek = summarizePTSalesPerWeek_(archivedSessions);
  const latestSession = getMostRecentArchivedSession_(archivedSessions);
  const latestSessionType = latestSession ? String(latestSession.Session_Type) : '';
  const selectedIds = new Set(selectedSessions.map((row) => String(row.Session_ID)));
  const paperSold = new Map();
  if (selectedIds.size) {
    visitTransactionsNewestFirst_(
      ['Inventory_Type', 'Product_ID', 'Transaction_Type', 'Quantity_Change', 'Session_ID'],
      (transaction) => {
        const sessionId = String(transaction.Session_ID || '');
        if (!selectedIds.has(sessionId)) return false;
        if (String(transaction.Inventory_Type) === 'Paper' &&
            String(transaction.Transaction_Type) === 'Sold') {
          const key = String(transaction.Product_ID);
          paperSold.set(key, (paperSold.get(key) || 0) - Number(transaction.Quantity_Change || 0));
        }
        return false;
      }
    );
  }
  const pt = games.map((game) => {
    const targets = desiredPTTargetsForSession_(game, latestSessionType);
    return {
      gameId: String(game.PT_Game_ID),
      formNumber: normalizeFormNumber_(game.Primary_Form_Number),
      label: `${game.Game_Name} (${normalizeFormNumber_(game.Primary_Form_Number)})`,
      onHand: Number(game.Qty_On_Hand || 0),
      targetOnHand: targets.onHand,
      bundled: Number(game.Qty_Bundled || 0),
      targetBundled: targets.bundled,
      soldPerWeek: ptSoldPerWeek.get(String(game.PT_Game_ID)) || 0,
      netProfitPerDollar: Number(game.Net_Income_Per_Patron_Dollar || 0)
    };
  }).sort((a, b) => b.soldPerWeek - a.soldPerWeek || a.label.localeCompare(b.label));
  const paper = papers.map((row) => ({
    paperId: String(row.Paper_ID),
    label: `${row.Short_Name} - ${row.Description}`,
    packsOnHand: Number(row.Qty_On_Hand || 0),
    targetOnHand: Number(row.Target_On_Hand || 0),
    soldPerWeek: selectedSessions.length
      ? (paperSold.get(String(row.Paper_ID)) || 0) / ARCHIVED_SESSION_WINDOW_PER_TYPE
      : 0,
    netProfitPerDollar: Number(row.Net_Income_Per_Patron_Dollar || 0),
    packsPerCase: Number(row.Packs_Per_Case || 0)
  })).sort((a, b) => b.soldPerWeek - a.soldPerWeek || a.label.localeCompare(b.label));
  return {
    pt: pt,
    paper: paper,
    sessionCount: selectedSessions.length,
    latestSessionType: latestSessionType
  };
}
function isActiveCatalogRecord_(record) {
  return record.Active === true || String(record.Active).toLowerCase() === 'true';
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
  if (!ptLines.length && !paperLines.length) {
    throw new Error('Enter at least one order quantity.');
  }
  const games = getPTCatalog_();
  const papers = getPaperCatalog_();
  const gamesById = new Map(games.map((row) => [String(row.PT_Game_ID), row]));
  const papersById = new Map(papers.map((row) => [String(row.Paper_ID), row]));
  const validatedPT = ptLines.map((line) => {
    const quantity = integerOrThrow_(line.quantity, 'PT deals to order', {allowZero:false});
    const game = gamesById.get(String(line.gameId));
    if (!game || !isActiveCatalogRecord_(game)) {
      throw new Error('An ordered PT game is unavailable.');
    }
    return {game: game, quantity: quantity};
  });
  const validatedPaper = paperLines.map((line) => {
    const quantity = integerOrThrow_(line.quantity, 'Paper cases to order', {allowZero:false});
    const paper = papersById.get(String(line.paperId));
    if (!paper || !isActiveCatalogRecord_(paper)) {
      throw new Error('An ordered Paper type is unavailable.');
    }
    return {
      paper: paper,
      quantity: quantity,
      packsPerCase: integerOrThrow_(paper.Packs_Per_Case, 'Packs per Case', {allowZero:false})
    };
  });
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    const effectiveDate = now_();
    const ptRecords = [];
    const paperRecords = [];
    const transactionEntries = [];
    const ptDeltas = new Map();
    const paperDeltas = new Map();
    validatedPT.forEach(({game, quantity}) => {
      const gameId = String(game.PT_Game_ID);
      const formNumber = normalizeFormNumber_(game.Primary_Form_Number);
      const dealIds = generateIds_('PT_DEAL', 'PTD-', 6, quantity);
      dealIds.forEach((dealId) => {
        ptRecords.push({
          PT_Deal_ID: dealId, PT_Game_ID: gameId, Form_Number: formNumber,
          Serial_Number: '', Received_Date: effectiveDate, Deal_Status: 'Unbundled',
          Bundled_Date: '', Expended_Date: '', Expended_Session_ID: '',
          Notes: `Dashboard order: ${quantity} deal(s).`
        });
        transactionEntries.push({
          effectiveDate: effectiveDate, inventoryType: 'PT', productId: gameId,
          itemId: dealId, formNumber: formNumber, transactionType: 'Received',
          quantityChange: 1, unit: 'Deal', source: 'Inventory Ordering',
          notes: `Dashboard order: ${quantity} deal(s).`
        });
      });
      const delta = ptDeltas.get(gameId) || {unbundled:0,bundled:0,open:0,onHand:0};
      delta.unbundled += quantity;
      delta.onHand += quantity;
      ptDeltas.set(gameId, delta);
    });
    validatedPaper.forEach(({paper, quantity, packsPerCase}) => {
      const paperId = String(paper.Paper_ID);
      const caseIds = generateIds_('PAPER_CASE', 'PC-', 6, quantity);
      caseIds.forEach((caseId) => {
        paperRecords.push({
          Paper_Case_ID: caseId, Paper_ID: paperId, Serial_Number: '',
          Received_Date: effectiveDate, Case_Status: 'Unopened', Opened_Date: '',
          Expended_Date: '', Notes: `Dashboard order: ${quantity} case(s).`,
          Current_Packs: packsPerCase, Balance_Updated_At: effectiveDate
        });
        transactionEntries.push({
          effectiveDate: effectiveDate, inventoryType: 'Paper', productId: paperId,
          itemId: caseId, transactionType: 'Received', quantityChange: packsPerCase,
          unit: 'Pack', source: 'Inventory Ordering',
          notes: `Dashboard order: ${quantity} case(s).`
        });
      });
      paperDeltas.set(
        paperId,
        (paperDeltas.get(paperId) || 0) + quantity * packsPerCase
      );
    });
    if (ptRecords.length) appendRecords_('PT_Deals', ptRecords);
    if (paperRecords.length) appendRecords_('Paper_Cases', paperRecords);
    try {
      postInventoryTransactions_(transactionEntries, {updatePaperBalances:false});
    } catch (error) {
      if (ptRecords.length) {
        deleteRowsByIdSet_('PT_Deals','PT_Deal_ID',new Set(ptRecords.map((row)=>row.PT_Deal_ID)));
      }
      if (paperRecords.length) {
        deleteRowsByIdSet_('Paper_Cases','Paper_Case_ID',new Set(paperRecords.map((row)=>row.Paper_Case_ID)));
      }
      throw new Error(`Dashboard order failed and was rolled back: ${error.message}`);
    }
    applyPTCatalogBalanceDeltas_(ptDeltas);
    applyPaperCatalogBalanceDeltas_(paperDeltas);
    return {
      ptDeals: ptRecords.length,
      paperCases: paperRecords.length,
      lineCount: validatedPT.length + validatedPaper.length
    };
  } finally {
    lock.releaseLock();
  }
}
