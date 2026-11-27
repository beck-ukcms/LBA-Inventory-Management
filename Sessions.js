/**
 * Sessions.js
 * Archived-session summaries and rolling dashboard analytics.
 * Current as of v2.1.
 */
const ARCHIVED_SESSIONS_SHEET = 'Sessions';
const ARCHIVED_SESSION_TYPES = ['Thursday', 'Friday', 'Sunday'];
const ARCHIVED_SESSION_WINDOW_PER_TYPE = 4;

function getArchivedSessions_() {
  return getRecords_(ARCHIVED_SESSIONS_SHEET);
}

function getArchivedSessionPTSalesFromTransactions_(sessionId) {
  const salesByGame = {};
  getRecords_('Transactions').forEach((transaction) => {
    if (String(transaction.Session_ID) !== String(sessionId)) return;
    if (String(transaction.Inventory_Type) !== 'PT') return;
    if (!['Opened', 'Sold'].includes(String(transaction.Transaction_Type))) return;
    if (Number(transaction.Quantity_Change || 0) !== -1) return;
    const gameId = String(transaction.Product_ID || '');
    if (gameId) salesByGame[gameId] = (salesByGame[gameId] || 0) + 1;
  });
  return salesByGame;
}

function parseSessionPTSales_(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch (error) {
    console.warn('Invalid PT_Sales_By_Game_JSON ignored:', error.message);
    return {};
  }
}

function buildArchivedSessionRecord_(context, inventoryResult, spreadsheet) {
  const summary = readArchivedSessionSummary_(spreadsheet);
  const suppliedSales = inventoryResult.ptSalesByGame || {};
  const salesByGame = Object.keys(suppliedSales).length
    ? Object.assign({}, suppliedSales)
    : getArchivedSessionPTSalesFromTransactions_(context.sessionId);
  return {
    Session_ID: normalizeText_(context.sessionId),
    Session_Date: context.date,
    Session_Type: context.label,
    Archived_At: now_(),
    Attendance: summary.attendance,
    PT_Tickets_Sold: summary.ptTicketsSold,
    Est_Partner_Sharing: summary.partnerSharing,
    Est_LBA_Profit: summary.lbaProfit,
    PT_Sales_By_Game_JSON: JSON.stringify(salesByGame),
    Source_Spreadsheet_ID: spreadsheet.getId()
  };
}

function getRequiredSessionSummarySettings_() {
  const settings = getSettingsMap_();
  const keys = {
    sheetName: ['Session_Summary_Sheet_Name', 'Profit Estimate'],
    attendance: ['Session_Attendance_Cell', 'D7'],
    ptTicketsSold: ['Session_PT_Tickets_Sold_Cell', 'C21'],
    partnerSharing: ['Session_Partner_Sharing_Cell', 'D34'],
    lbaProfit: ['Session_LBA_Profit_Cell', 'D35']
  };
  const result = {};
  Object.entries(keys).forEach(([name, definition]) => {
    const value = normalizeText_(settings[definition[0]] || definition[1]);
    if (!value) throw new Error(`Setting ${definition[0]} is required.`);
    result[name] = value;
  });
  return result;
}
function readArchivedSessionSummary_(spreadsheet) {
  const settings = getRequiredSessionSummarySettings_();
  const sheet = spreadsheet.getSheetByName(settings.sheetName);
  if (!sheet) throw new Error(`Required worksheet ${settings.sheetName} is missing.`);
  let ranges;
  try {
    ranges = sheet.getRangeList([settings.attendance, settings.ptTicketsSold,
      settings.partnerSharing, settings.lbaProfit]).getRanges();
  } catch (error) {
    throw new Error(`A configured session-summary cell is invalid: ${error.message}`);
  }
  const values = ranges.map((range) => range.getValue());
  const labels = ['Attendance', 'PT Tickets Sold', 'Partner Sharing', 'LBA Profit'];
  values.forEach((value, index) => {
    if (value === '' || !Number.isFinite(Number(value)) || Number(value) < 0) {
      throw new Error(`${labels[index]} must be a nonnegative number in ${settings.sheetName}.`);
    }
  });
  return {attendance:Number(values[0]), ptTicketsSold:Number(values[1]),
    partnerSharing:Number(values[2]), lbaProfit:Number(values[3])};
}

function appendArchivedSession_(record) {
  const existing = getArchivedSessions_().find((row) => {
    return String(row.Session_ID) === String(record.Session_ID);
  });
  if (existing) {
    return {created: false, rowNumber: existing._rowNumber};
  }
  return {
    created: true,
    rowNumber: appendRecord_(ARCHIVED_SESSIONS_SHEET, record)
  };
}

function selectDashboardSessionWindow_(sessions) {
  const selected = [];
  ARCHIVED_SESSION_TYPES.forEach((sessionType) => {
    const rows = sessions
      .filter((row) => String(row.Session_Type) === sessionType)
      .sort((first, second) => {
        return sessionDateTime_(second.Session_Date) - sessionDateTime_(first.Session_Date);
      })
      .slice(0, ARCHIVED_SESSION_WINDOW_PER_TYPE);
    selected.push(...rows);
  });
  return selected;
}

function sessionDateTime_(value) {
  if (value instanceof Date) return value.getTime();
  const parsed = new Date(value);
  return isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function summarizePTSalesPerWeek_(sessions) {
  const totals = new Map();
  selectDashboardSessionWindow_(sessions).forEach((session) => {
    const sales = parseSessionPTSales_(session.PT_Sales_By_Game_JSON);
    Object.entries(sales).forEach(([gameId, quantity]) => {
      totals.set(gameId, (totals.get(gameId) || 0) + Number(quantity || 0));
    });
  });
  const perWeek = new Map();
  totals.forEach((quantity, gameId) => {
    perWeek.set(gameId, quantity / ARCHIVED_SESSION_WINDOW_PER_TYPE);
  });
  return perWeek;
}

function getMostRecentArchivedSession_(sessions) {
  return sessions.slice().sort((first, second) => {
    return sessionDateTime_(second.Session_Date) - sessionDateTime_(first.Session_Date) ||
      sessionDateTime_(second.Archived_At) - sessionDateTime_(first.Archived_At);
  })[0] || null;
}

function desiredPTTargetsForSession_(game, sessionType) {
  const onHandBase = Number(game.Target_On_Hand || 0);
  const bundledBase = Number(game.Target_Bundled || 0);
  const onHandMultiplier = {Thursday: 1, Friday: 4 / 5, Sunday: 3 / 5}[sessionType];
  const bundledMultiplier = {Sunday: 1, Thursday: 2 / 3, Friday: 1 / 3}[sessionType];
  return {
    onHand: Math.ceil(onHandBase * (onHandMultiplier == null ? 1 : onHandMultiplier)),
    bundled: Math.ceil(bundledBase * (bundledMultiplier == null ? 1 : bundledMultiplier))
  };
}
