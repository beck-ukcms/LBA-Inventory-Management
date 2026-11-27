/**
 * ArchivedSessionsBackfillV210.js
 * One-time preview/import for five specifically approved archived sessions.
 * Remove this file after the backfill is verified.
 */
const V210_BACKFILL_SESSIONS = [
  {date: '2026-11-06', type: 'Friday'},
  {date: '2026-11-08', type: 'Sunday'},
  {date: '2026-11-19', type: 'Thursday'},
  {date: '2026-11-20', type: 'Friday'},
  {date: '2026-11-22', type: 'Sunday'}
];

function previewV210ArchivedSessionBackfill() {
  return buildV210ArchivedSessionBackfill_(false);
}

function runV210ArchivedSessionBackfill() {
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    return buildV210ArchivedSessionBackfill_(true);
  } finally {
    lock.releaseLock();
  }
}

function buildV210ArchivedSessionBackfill_(writeRecords) {
  const registry = getPaperworkSessionsRegistry_();
  const registryRecords = getPaperworkSessionRecords_(registry);
  const existingSessionIds = new Set(
    getArchivedSessions_().map((row) => String(row.Session_ID))
  );
  const results = V210_BACKFILL_SESSIONS.map((specification) => {
    const date = parsePaperworkIsoDate_(specification.date);
    const matches = registryRecords.filter((record) => {
      return record.date &&
        formatPaperworkIsoDate_(record.date) === specification.date &&
        record.label === specification.type;
    });
    if (matches.length !== 1) {
      return backfillFailure_(specification, `Expected one Sign-In Sessions row; found ${matches.length}.`);
    }
    const sessionId = matches[0].sessionId;
    if (existingSessionIds.has(String(sessionId))) {
      return backfillFailure_(specification, `Session ${sessionId} already exists in archived Sessions.`);
    }
    const spreadsheetId = findArchivedPaperworkSpreadsheetId_(date);
    if (!spreadsheetId) {
      return backfillFailure_(specification, 'Exactly one archived paperwork spreadsheet was not found.');
    }
    try {
      const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
      const summary = readArchivedSessionSummary_(spreadsheet);
      const salesByGame = getArchivedSessionPTSalesFromTransactions_(sessionId);
      const record = {
        Session_ID: sessionId,
        Session_Date: date,
        Session_Type: specification.type,
        Archived_At: getArchivedPaperworkTimestampV210_(date),
        Attendance: summary.attendance,
        PT_Tickets_Sold: summary.ptTicketsSold,
        Est_Partner_Sharing: summary.partnerSharing,
        Est_LBA_Profit: summary.lbaProfit,
        PT_Sales_By_Game_JSON: JSON.stringify(salesByGame),
        Source_Spreadsheet_ID: spreadsheetId
      };
      if (writeRecords) {
        appendArchivedSession_(record);
        existingSessionIds.add(String(sessionId));
      }
      return {
        ok: true,
        action: writeRecords ? 'imported' : 'preview',
        date: specification.date,
        type: specification.type,
        record: record
      };
    } catch (error) {
      return backfillFailure_(specification, error.message);
    }
  });
  return {
    ok: results.every((result) => result.ok),
    mode: writeRecords ? 'import' : 'preview',
    results: results
  };
}

function getArchivedPaperworkTimestampV210_(date) {
  const archiveRoot = DriveApp.getFolderById(PAPERWORK_CONFIG.archiveFolderId);
  const quarterFolders = collectPaperworkIterator_(
    archiveRoot.getFoldersByName(getPaperworkArchiveQuarterName_(date))
  );
  if (quarterFolders.length !== 1) throw new Error('Archive quarter folder is ambiguous.');
  const sessionFolders = collectPaperworkIterator_(
    quarterFolders[0].getFoldersByName(formatPaperworkMMDDYY_(date))
  );
  if (sessionFolders.length !== 1) throw new Error('Archived session folder is ambiguous.');
  return sessionFolders[0].getDateCreated();
}

function backfillFailure_(specification, message) {
  return {
    ok: false,
    action: 'skipped',
    date: specification.date,
    type: specification.type,
    message: message
  };
}
