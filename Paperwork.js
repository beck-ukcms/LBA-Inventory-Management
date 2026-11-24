/**
 * PaperworkManagement.js
 * LBA Bingo Inventory Management v1.12
 *
 * Integrated copy of the proven standalone Paperwork Management workflow.
 * Creation, trigger, folder scanning, and archive-folder behavior remain
 * unchanged in purpose. Inventory processing is inserted only immediately
 * before a completed session folder is moved to the quarterly archive.
 */

const PAPERWORK_CONFIG = {
  weeklyFolders: {
    Thursday: '1jLGDOstBCOeG2mDJlEQ-1pAyBppvbJ78',
    Friday: '1UkM5ESeFyepL24N0I18z3h8fcZgUxxdf',
    Sunday: '1tq1xWzvcID9LQZ-91PJ-rguSkBVbx_1l'
  },
  templateFolderId: '150bZbkYTiaProRmjRhNPvsVTJrlcSDF5',
  archiveFolderId: '1YjU8UpNcbSW7EkUrI0THzhhftHvHLTNe',
  sessionsSpreadsheetId: '1mUkoA8XtHxVlr_IupvCz4fMx7ejsGug6ior_onF4qa8',
  sessionsSheetName: 'Sessions',
  etabsSpreadsheetId: '1C7I8PI9ajSwTm_AtcODiNWijIxby8_02',
  triggerHour: 14,
  triggerTimeZone: 'America/New_York'
};

const PAPERWORK_SHEET_TEMPLATE_PREFIX = 'LBA-Bingo_TEMPLATE_';
const PAPERWORK_PDF_TEMPLATE_NAME = 'LBA-fw2g_TEMPLATE.pdf';
const PAPERWORK_SESSION_FOLDER_RE = /^\d{6}$/;
const PAPERWORK_REQUIRED_SESSION_HEADERS = [
  'SessionID',
  'SessionDate',
  'Label',
  'Active',
  'CreatedAt'
];


function getPaperworkAppData(token) {
  requireAdmin_(token);
  validatePaperworkConfiguration_();
  return {
    sessions: scanWeeklyPaperworkFolders_(),
    trigger: getDailyPaperworkTriggerStatus_()
  };
}


function scanWeeklyPaperworkFolders_() {
  const output = {};

  Object.keys(PAPERWORK_CONFIG.weeklyFolders).forEach((label) => {
    const parent = DriveApp.getFolderById(
      PAPERWORK_CONFIG.weeklyFolders[label]
    );

    const folders = parent.getFolders();
    const rows = [];

    while (folders.hasNext()) {
      const folder = folders.next();
      const parsed = parsePaperworkMMDDYY_(folder.getName());

      if (!parsed) {
        continue;
      }

      rows.push({
        label: label,
        folderId: folder.getId(),
        folderName: folder.getName(),
        displayDate: formatPaperworkDisplayDate_(parsed)
      });
    }

    rows.sort((first, second) => {
      return second.folderName.localeCompare(first.folderName);
    });

    output[label] = rows;
  });

  return output;
}


function installDailyPaperworkTrigger(token) {
  requireAdmin_(token);
  validatePaperworkConfiguration_();
  removeDailyPaperworkTriggers_();
  ScriptApp
    .newTrigger('dailyPaperworkMaintenance')
    .timeBased()
    .atHour(PAPERWORK_CONFIG.triggerHour)
    .everyDays(1)
    .inTimezone(PAPERWORK_CONFIG.triggerTimeZone)
    .create();
  return getDailyPaperworkTriggerStatus_();
}


function removeDailyPaperworkTrigger(token) {
  requireAdmin_(token);
  removeDailyPaperworkTriggers_();
  return getDailyPaperworkTriggerStatus_();
}


function removeDailyPaperworkTriggers_() {
  ScriptApp.getProjectTriggers().forEach((trigger) => {
    if (trigger.getHandlerFunction() === 'dailyPaperworkMaintenance') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}


function getDailyPaperworkTriggerStatus_() {
  const count = ScriptApp.getProjectTriggers().filter((trigger) => {
    return trigger.getHandlerFunction() === 'dailyPaperworkMaintenance';
  }).length;

  return {
    installed: count === 1,
    count: count,
    hour: PAPERWORK_CONFIG.triggerHour,
    timeZone: PAPERWORK_CONFIG.triggerTimeZone
  };
}


function dailyPaperworkMaintenance() {
  validatePaperworkConfiguration_();

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const today = paperworkToday_();
    const archiveResults = archivePastSessionPaperwork_(today);
    const registry = getPaperworkSessionsRegistry_();

    const todayRecords = getPaperworkSessionRecords_(registry)
      .filter((record) => {
        return (
          record.date &&
          formatPaperworkIsoDate_(record.date) ===
            formatPaperworkIsoDate_(today)
        );
      });

    if (todayRecords.length === 0) {
      return {
        archiveResults: archiveResults,
        creationResult: null,
        message:
          'Past-session processing completed. No session is listed for today.'
      };
    }

    if (todayRecords.length > 1) {
      throw new Error(
        'More than one Sessions row is listed for today. ' +
        'No paperwork was created.'
      );
    }

    const record = todayRecords[0];
    validatePaperworkLabel_(record.label);

    const creationResult = createOnePaperworkSet_(
      today,
      record.label,
      registry
    );

    return {
      archiveResults: archiveResults,
      creationResult: creationResult,
      message: creationResult.message
    };
  } finally {
    lock.releaseLock();
  }
}


function createManualSingleDatePaperwork(token, dateString, label) {
  requireAdmin_(token);
  validatePaperworkConfiguration_();
  validatePaperworkLabel_(label);
  const date = parsePaperworkIsoDate_(dateString);
  if (!date) {
    throw new Error('Please select a valid session date.');
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const registry = getPaperworkSessionsRegistry_();
    const matches = findPaperworkSessionRecords_(registry, date, label);
    if (matches.length > 1) {
      throw new Error(
        'Multiple Sessions rows already exist for ' +
        formatPaperworkIsoDate_(date) +
        ' and ' + label + '.'
      );
    }
    if (matches.length === 0) {
      appendPaperworkSessionRow_(registry, date, label);
    }
    const creationResult = createOnePaperworkSet_(date, label, registry);
    return {
      creationResult: creationResult,
      sessions: scanWeeklyPaperworkFolders_()
    };
  } finally {
    lock.releaseLock();
  }
}


function createOnePaperworkSet_(date, label, registry) {
  validatePaperworkLabel_(label);

  const dateCode = formatPaperworkMMDDYY_(date);
  const weeklyFolder = DriveApp.getFolderById(
    PAPERWORK_CONFIG.weeklyFolders[label]
  );

  const existingFolders = collectPaperworkIterator_(
    weeklyFolder.getFoldersByName(dateCode)
  );

  if (existingFolders.length > 1) {
    throw new Error(
      `Multiple weekly folders named ${dateCode} already exist.`
    );
  }

  if (existingFolders.length === 1) {
    const folder = existingFolders[0];
    const expectedSheet = findUniquePaperworkSheet_(
      folder,
      `LBA-Bingo_${dateCode}`
    );

    const expectedPdf = collectPaperworkIterator_(
      folder.getFilesByName(`LBA-fw2g_${dateCode}.pdf`)
    );

    if (expectedSheet && expectedPdf.length === 1) {
      return {
        ok: true,
        created: false,
        dateString: formatPaperworkIsoDate_(date),
        displayDate: formatPaperworkDisplayDate_(date),
        label: label,
        message: 'Paperwork already exists; no duplicate was created.'
      };
    }

    throw new Error(
      'The weekly session folder already exists but is incomplete. ' +
      'No duplicate paperwork was created.'
    );
  }

  const templates = getPaperworkTemplates_();
  const sessionFolder = weeklyFolder.createFolder(dateCode);

  try {
    const sheetFile = templates.sheet.makeCopy(
      `LBA-Bingo_${dateCode}`,
      sessionFolder
    );

    templates.pdf.makeCopy(
      `LBA-fw2g_${dateCode}.pdf`,
      sessionFolder
    );

    verifyPaperworkSessionFiles_(sessionFolder, dateCode);

    const prefill = prefillNewPaperwork_(
      sheetFile.getId(),
      date,
      label,
      registry
    );

    return {
      ok: true,
      created: true,
      dateString: formatPaperworkIsoDate_(date),
      displayDate: formatPaperworkDisplayDate_(date),
      label: label,
      message: `Created one paperwork set. ${prefill.summary}`
    };
  } catch (error) {
    throw new Error(
      `${dateCode} folder was created, but setup did not complete: ` +
      error.message
    );
  }
}


/**
 * Preserves the standalone application's established prefill behavior.
 */
function prefillNewPaperwork_(newSpreadsheetId, sessionDate, label, registry) {
  const newSpreadsheet = SpreadsheetApp.openById(newSpreadsheetId);
  const coverSheet = newSpreadsheet.getSheetByName('Cover');

  if (!coverSheet) {
    return {
      summary: 'Prefill skipped because the Cover sheet is missing.'
    };
  }

  const completed = [];
  const skipped = [];

  const sessionDateText = [
    padPaperwork2_(sessionDate.getMonth() + 1),
    padPaperwork2_(sessionDate.getDate()),
    padPaperwork2_(sessionDate.getFullYear() % 100)
  ].join('/');

  coverSheet.getRange('C8').setNumberFormat('@');
  coverSheet.getRange('C8').setValue(sessionDateText);
  coverSheet.getRange('C9').setValue(label);
  completed.push('date and session type set');

  const records = getPaperworkSessionRecords_(registry);
  const priorSameType = findMostRecentPriorPaperworkRecord_(
    records,
    sessionDate,
    label
  );

  if (priorSameType) {
    const priorSameTypeSheetId = findArchivedPaperworkSpreadsheetId_(
      priorSameType.date
    );

    if (priorSameTypeSheetId) {
      const nextCoverall = readPriorPaperworkCell_(
        priorSameTypeSheetId,
        'Qtrly Report Data',
        'B34'
      );

      if (nextCoverall.found) {
        coverSheet.getRange('C11').setValue(nextCoverall.value);
        completed.push('Next Coverall Value prefilled');
      } else {
        skipped.push('Next Coverall Value unavailable');
      }
    } else {
      skipped.push('prior same-type paperwork unavailable');
    }
  } else {
    skipped.push('no prior same-type session');
  }

  const priorAnyType = findMostRecentPriorPaperworkRecord_(
    records,
    sessionDate,
    null
  );

  if (priorAnyType) {
    const priorAnySheetId = findArchivedPaperworkSpreadsheetId_(
      priorAnyType.date
    );

    if (priorAnySheetId) {
      const carryovers = readPaperworkCarryoverValues_(priorAnySheetId);

      if (carryovers) {
        coverSheet.getRange('D19').setValue(carryovers.donkey);
        coverSheet.getRange('D20').setValue(carryovers.diamonds);
        coverSheet.getRange('D21').setValue(carryovers.monkey);
        coverSheet.getRange('C30').setValue(carryovers.qoh);
        completed.push('latest prior-session carryovers prefilled');
      } else {
        skipped.push('latest prior-session carryovers unavailable');
      }
    } else {
      skipped.push('latest prior-session paperwork unavailable');
    }
  } else {
    skipped.push('no prior session for carryovers');
  }

  const distinctPriorDates = findDistinctPriorPaperworkDates_(
    records,
    sessionDate
  );

  if (distinctPriorDates.length >= 1) {
    const priorAverage = readPaperworkTrackingValueForDate_(
      distinctPriorDates[0],
      26
    );

    if (priorAverage.found) {
      coverSheet.getRange('D25').setValue(priorAverage.value);
      completed.push('ETabs Prior Average prefilled');
    } else {
      skipped.push(
        priorAverage.reason || 'ETabs Prior Average unavailable'
      );
    }
  } else {
    skipped.push('no prior session for ETabs Prior Average');
  }

  if (distinctPriorDates.length >= 10) {
    const pastNet = readPaperworkTrackingValueForDate_(
      distinctPriorDates[9],
      4
    );

    if (pastNet.found) {
      coverSheet.getRange('D26').setValue(pastNet.value);
      completed.push('ETabs Past Net prefilled');
    } else {
      skipped.push(pastNet.reason || 'ETabs Past Net unavailable');
    }
  } else {
    skipped.push('fewer than ten prior distinct session dates');
  }

  let summary = completed.join(', ') + '.';

  if (skipped.length > 0) {
    summary += ' Skipped: ' + skipped.join('; ') + '.';
  }

  return {
    summary: summary
  };
}


function findMostRecentPriorPaperworkRecord_(
  records,
  sessionDate,
  requiredLabel
) {
  const targetTime = paperworkDateOnlyTime_(sessionDate);

  const matches = records.filter((record) => {
    return (
      record.date &&
      paperworkDateOnlyTime_(record.date) < targetTime &&
      (!requiredLabel || record.label === requiredLabel)
    );
  });

  matches.sort((first, second) => {
    return (
      paperworkDateOnlyTime_(second.date) -
      paperworkDateOnlyTime_(first.date)
    );
  });

  return matches.length ? matches[0] : null;
}


function findDistinctPriorPaperworkDates_(records, sessionDate) {
  const targetTime = paperworkDateOnlyTime_(sessionDate);
  const datesByIso = {};

  records.forEach((record) => {
    if (
      record.date &&
      paperworkDateOnlyTime_(record.date) < targetTime
    ) {
      datesByIso[formatPaperworkIsoDate_(record.date)] = record.date;
    }
  });

  return Object.keys(datesByIso)
    .map((iso) => datesByIso[iso])
    .sort((first, second) => {
      return (
        paperworkDateOnlyTime_(second) -
        paperworkDateOnlyTime_(first)
      );
    });
}


function findArchivedPaperworkSpreadsheetId_(sessionDate) {
  try {
    const archiveRoot = DriveApp.getFolderById(
      PAPERWORK_CONFIG.archiveFolderId
    );

    const quarterName = getPaperworkArchiveQuarterName_(sessionDate);
    const quarterFolders = collectPaperworkIterator_(
      archiveRoot.getFoldersByName(quarterName)
    );

    if (quarterFolders.length !== 1) {
      return null;
    }

    const dateCode = formatPaperworkMMDDYY_(sessionDate);
    const sessionFolders = collectPaperworkIterator_(
      quarterFolders[0].getFoldersByName(dateCode)
    );

    if (sessionFolders.length !== 1) {
      return null;
    }

    const file = findUniquePaperworkSheet_(
      sessionFolders[0],
      `LBA-Bingo_${dateCode}`
    );

    return file ? file.getId() : null;
  } catch (error) {
    return null;
  }
}


function readPriorPaperworkCell_(
  spreadsheetId,
  sheetName,
  cellAddress
) {
  try {
    const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    const sheet = spreadsheet.getSheetByName(sheetName);

    if (!sheet) {
      return { found: false };
    }

    return {
      found: true,
      value: sheet.getRange(cellAddress).getValue()
    };
  } catch (error) {
    return { found: false };
  }
}


function readPaperworkCarryoverValues_(spreadsheetId) {
  try {
    const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    const sheet = spreadsheet.getSheetByName('Qtrly Report Data');

    if (!sheet) {
      return null;
    }

    return {
      donkey: sheet.getRange('B37').getValue(),
      diamonds: sheet.getRange('B38').getValue(),
      monkey: sheet.getRange('B39').getValue(),
      qoh: sheet.getRange('B41').getValue()
    };
  } catch (error) {
    return null;
  }
}


function readPaperworkTrackingValueForDate_(sessionDate, valueColumn) {
  try {
    const spreadsheet = SpreadsheetApp.openById(
      PAPERWORK_CONFIG.etabsSpreadsheetId
    );

    const sheet = spreadsheet.getSheetByName(
      getPaperworkTrackingSheetName_(sessionDate)
    );

    if (!sheet || sheet.getLastRow() < 11) {
      return {
        found: false,
        reason: 'ETabs tracking sheet or row unavailable'
      };
    }

    const rowCount = sheet.getLastRow() - 11 + 1;
    const dates = sheet.getRange(11, 1, rowCount, 1).getValues();
    const targetIso = formatPaperworkIsoDate_(sessionDate);

    for (let index = 0; index < dates.length; index += 1) {
      const candidate = coercePaperworkSessionDate_(dates[index][0]);

      if (
        candidate &&
        formatPaperworkIsoDate_(candidate) === targetIso
      ) {
        const rowNumber = 11 + index;
        const readiness = sheet
          .getRange(rowNumber, 2)
          .getDisplayValue()
          .trim();

        if (!readiness) {
          return {
            found: false,
            reason: 'ETabs source row column B is empty'
          };
        }

        return {
          found: true,
          value: sheet.getRange(rowNumber, valueColumn).getValue()
        };
      }
    }

    return {
      found: false,
      reason: 'ETabs date was not found'
    };
  } catch (error) {
    return {
      found: false,
      reason: 'ETabs source was inaccessible'
    };
  }
}


function getPaperworkTrackingSheetName_(date) {
  const quarter = Math.floor(date.getMonth() / 3) + 1;
  return `Q${quarter}FY${date.getFullYear()} Tracking`;
}


function archivePastSessionPaperwork_(cutoffDate) {
  const registry = getPaperworkSessionsRegistry_();
  const records = getPaperworkSessionRecords_(registry);
  const results = [];
  const processedKeys = {};

  records.forEach((record) => {
    if (
      !record.date ||
      paperworkDateOnlyTime_(record.date) >=
        paperworkDateOnlyTime_(cutoffDate)
    ) {
      return;
    }

    validatePaperworkLabel_(record.label);

    const key =
      formatPaperworkIsoDate_(record.date) +
      '|' + record.label;

    if (processedKeys[key]) {
      return;
    }

    processedKeys[key] = true;
    results.push(
      archiveOneSession_(
        record.date,
        record.label,
        record.sessionId
      )
    );
  });

  return results;
}


function archiveOneSession_(date, label, sessionId) {
  const dateCode = formatPaperworkMMDDYY_(date);
  const weeklyParent = DriveApp.getFolderById(
    PAPERWORK_CONFIG.weeklyFolders[label]
  );

  const weeklyFolders = collectPaperworkIterator_(
    weeklyParent.getFoldersByName(dateCode)
  );

  if (weeklyFolders.length === 0) {
    return {
      ok: true,
      dateCode: dateCode,
      label: label,
      message: 'Not present in weekly folder; presumed already archived.'
    };
  }

  if (weeklyFolders.length > 1) {
    return {
      ok: false,
      dateCode: dateCode,
      label: label,
      message: 'Multiple weekly session folders were found.'
    };
  }

  const folder = weeklyFolders[0];

  try {
    const inventoryResult = processSessionInventoryBeforeArchive_({
      folder: folder,
      date: date,
      label: label,
      sessionId: sessionId
    });

    if (!inventoryResult.ok) {
      return {
        ok: false,
        dateCode: dateCode,
        label: label,
        message:
          inventoryResult.message +
          ' Paperwork remains in the weekly folder.'
      };
    }

    folder.moveTo(getUniquePaperworkArchiveQuarterFolder_(date));

    return {
      ok: true,
      dateCode: dateCode,
      label: label,
      message:
        `Inventory processed and archived to ` +
        `${getPaperworkArchiveQuarterName_(date)}.`
    };
  } catch (error) {
    return {
      ok: false,
      dateCode: dateCode,
      label: label,
      message:
        `${error.message} Paperwork remains in the weekly folder.`
    };
  }
}


function archiveSelectedPaperwork(token, items) {
  requireAdmin_(token);
  validatePaperworkConfiguration_();

  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('No paperwork was selected.');
  }

  const registry = getPaperworkSessionsRegistry_();
  const results = [];

  items.forEach((item) => {
    const date = parsePaperworkMMDDYY_(String(item.folderName || ''));
    const label = normalizeText_(item.label);

    if (!date || !label) {
      results.push({
        ok: false,
        folderName: item.folderName || '(unknown)',
        message: 'Invalid session folder name or session type.'
      });
      return;
    }

    const matches = findPaperworkSessionRecords_(
      registry,
      date,
      label
    );

    if (matches.length !== 1) {
      results.push({
        ok: false,
        folderName: item.folderName,
        message:
          `Expected one Sessions row, but found ${matches.length}.`
      });
      return;
    }

    const result = archiveOneSession_(
      date,
      label,
      matches[0].sessionId
    );

    result.folderName = item.folderName;
    results.push(result);
  });

  return {
    results: results,
    sessions: scanWeeklyPaperworkFolders_()
  };
}


function getPaperworkSessionsRegistry_() {
  const spreadsheet = SpreadsheetApp.openById(
    PAPERWORK_CONFIG.sessionsSpreadsheetId
  );

  const sheet = spreadsheet.getSheetByName(
    PAPERWORK_CONFIG.sessionsSheetName
  );

  if (!sheet) {
    throw new Error('The Sessions worksheet does not exist.');
  }

  const headers = sheet
    .getRange(1, 1, 1, PAPERWORK_REQUIRED_SESSION_HEADERS.length)
    .getDisplayValues()[0];

  PAPERWORK_REQUIRED_SESSION_HEADERS.forEach((expected, index) => {
    if (headers[index] !== expected) {
      throw new Error(
        `Sessions header mismatch in column ${index + 1}. ` +
        `Expected "${expected}".`
      );
    }
  });

  return sheet;
}


function getPaperworkSessionRecords_(sheet) {
  if (sheet.getLastRow() < 2) {
    return [];
  }

  return sheet
    .getRange(
      2,
      1,
      sheet.getLastRow() - 1,
      PAPERWORK_REQUIRED_SESSION_HEADERS.length
    )
    .getValues()
    .map((row, index) => {
      return {
        rowNumber: index + 2,
        sessionId: String(row[0] || ''),
        date: coercePaperworkSessionDate_(row[1]),
        label: String(row[2] || '').trim(),
        active: row[3],
        createdAt: row[4]
      };
    });
}


function findPaperworkSessionRecords_(sheet, date, label) {
  const iso = formatPaperworkIsoDate_(date);

  return getPaperworkSessionRecords_(sheet).filter((record) => {
    return (
      record.date &&
      formatPaperworkIsoDate_(record.date) === iso &&
      record.label === label
    );
  });
}


function appendPaperworkSessionRow_(sheet, date, label) {
  sheet.appendRow([
    generatePaperworkSessionId_(date),
    formatPaperworkIsoDate_(date),
    label,
    true,
    new Date()
  ]);
}


function generatePaperworkSessionId_(date) {
  const suffix = Utilities
    .getUuid()
    .replace(/-/g, '')
    .slice(0, 12);

  return `${formatPaperworkMMDDYY_(date)}-${suffix}`;
}


function getPaperworkTemplates_() {
  const folder = DriveApp.getFolderById(
    PAPERWORK_CONFIG.templateFolderId
  );

  const files = folder.getFiles();
  const sheets = [];
  const pdfs = [];

  while (files.hasNext()) {
    const file = files.next();

    if (
      file.getName().indexOf(PAPERWORK_SHEET_TEMPLATE_PREFIX) === 0 &&
      file.getMimeType() === MimeType.GOOGLE_SHEETS
    ) {
      sheets.push(file);
    }

    if (
      file.getName() === PAPERWORK_PDF_TEMPLATE_NAME &&
      file.getMimeType() === MimeType.PDF
    ) {
      pdfs.push(file);
    }
  }

  if (sheets.length !== 1 || pdfs.length !== 1) {
    throw new Error(
      'The template folder must contain exactly one matching Google Sheet ' +
      'and exactly one LBA-fw2g_TEMPLATE.pdf.'
    );
  }

  return {
    sheet: sheets[0],
    pdf: pdfs[0]
  };
}


function verifyPaperworkSessionFiles_(folder, dateCode) {
  const sheet = findUniquePaperworkSheet_(
    folder,
    `LBA-Bingo_${dateCode}`
  );

  const pdfs = collectPaperworkIterator_(
    folder.getFilesByName(`LBA-fw2g_${dateCode}.pdf`)
  );

  if (!sheet || pdfs.length !== 1) {
    throw new Error('The copied paperwork files could not be verified.');
  }
}


function findUniquePaperworkSheet_(folder, name) {
  const matches = collectPaperworkIterator_(
    folder.getFilesByName(name)
  ).filter((file) => {
    return file.getMimeType() === MimeType.GOOGLE_SHEETS;
  });

  return matches.length === 1 ? matches[0] : null;
}


function collectPaperworkIterator_(iterator) {
  const output = [];

  while (iterator.hasNext()) {
    output.push(iterator.next());
  }

  return output;
}


function getUniquePaperworkArchiveQuarterFolder_(date) {
  const archiveRoot = DriveApp.getFolderById(
    PAPERWORK_CONFIG.archiveFolderId
  );

  const quarterName = getPaperworkArchiveQuarterName_(date);
  const matches = collectPaperworkIterator_(
    archiveRoot.getFoldersByName(quarterName)
  );

  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one archive folder named ${quarterName}, ` +
      `but found ${matches.length}.`
    );
  }

  return matches[0];
}


function getPaperworkArchiveQuarterName_(date) {
  const quarter = Math.floor(date.getMonth() / 3) + 1;
  return `Q${quarter}FY${padPaperwork2_(date.getFullYear() % 100)}`;
}


function paperworkToday_() {
  const iso = Utilities.formatDate(
    new Date(),
    Session.getScriptTimeZone(),
    'yyyy-MM-dd'
  );

  return parsePaperworkIsoDate_(iso);
}


function formatPaperworkMMDDYY_(date) {
  return (
    padPaperwork2_(date.getMonth() + 1) +
    padPaperwork2_(date.getDate()) +
    padPaperwork2_(date.getFullYear() % 100)
  );
}


function formatPaperworkIsoDate_(date) {
  return (
    date.getFullYear() + '-' +
    padPaperwork2_(date.getMonth() + 1) + '-' +
    padPaperwork2_(date.getDate())
  );
}


function formatPaperworkDisplayDate_(date) {
  return Utilities.formatDate(
    date,
    Session.getScriptTimeZone(),
    'EEEE, MMMM d, yyyy'
  );
}


function parsePaperworkIsoDate_(text) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(text || ''))) {
    return null;
  }

  const parts = text.split('-').map(Number);
  const date = new Date(parts[0], parts[1] - 1, parts[2]);

  return (
    date.getFullYear() === parts[0] &&
    date.getMonth() === parts[1] - 1 &&
    date.getDate() === parts[2]
  )
    ? date
    : null;
}


function parsePaperworkMMDDYY_(text) {
  if (!PAPERWORK_SESSION_FOLDER_RE.test(String(text || ''))) {
    return null;
  }

  const month = Number(text.slice(0, 2));
  const day = Number(text.slice(2, 4));
  const year = 2000 + Number(text.slice(4, 6));
  const date = new Date(year, month - 1, day);

  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  )
    ? date
    : null;
}


function coercePaperworkSessionDate_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return new Date(
      value.getFullYear(),
      value.getMonth(),
      value.getDate()
    );
  }

  const text = String(value || '').trim();
  const iso = parsePaperworkIsoDate_(text);

  if (iso) {
    return iso;
  }

  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);

  return match
    ? new Date(Number(match[3]), Number(match[1]) - 1, Number(match[2]))
    : null;
}


function paperworkDateOnlyTime_(date) {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate()
  ).getTime();
}


function padPaperwork2_(number) {
  return String(number).padStart(2, '0');
}


function validatePaperworkLabel_(label) {
  if (
    !Object.prototype.hasOwnProperty.call(
      PAPERWORK_CONFIG.weeklyFolders,
      label
    )
  ) {
    throw new Error('Invalid session type.');
  }
}


function validatePaperworkConfiguration_() {
  const values = [
    PAPERWORK_CONFIG.weeklyFolders.Thursday,
    PAPERWORK_CONFIG.weeklyFolders.Friday,
    PAPERWORK_CONFIG.weeklyFolders.Sunday,
    PAPERWORK_CONFIG.templateFolderId,
    PAPERWORK_CONFIG.archiveFolderId,
    PAPERWORK_CONFIG.sessionsSpreadsheetId,
    PAPERWORK_CONFIG.sessionsSheetName,
    PAPERWORK_CONFIG.etabsSpreadsheetId
  ];

  if (values.some((value) => !value || /^PASTE_/.test(value))) {
    throw new Error('Paperwork Management configuration is incomplete.');
  }
}
/**
 * SessionInventoryProcessing.js
 * LBA Bingo Inventory Management v1.12
 *
 * Parses completed state paperwork immediately before archival. Processing is
 * attempted once. A Started or Failed marker prevents automatic retry and the
 * paperwork remains in the weekly folder for human recovery.
 */

const SESSION_PROCESSING_SOURCE = 'Session Paperwork Processing';
const SESSION_MARKER_TYPES = [
  'Session Processing Started',
  'Session Processed',
  'Session Processing Failed'
];

const PAPER_ROWS_BY_SESSION = {
  Thursday: [9, 10, 12, 13, 15, 16, 18, 19, 21, 22],
  Friday: [9, 10, 12, 13, 15, 16, 18, 19, 21, 22],
  Sunday: [9, 10, 12, 13, 15, 16, 18, 19, 21, 22, 24, 25, 27, 28]
};

const COMPLETED_PT_RANGES = [
  { sheetName: 'WS-06 PTs (Main)', firstRow: 8, lastRow: 25 },
  { sheetName: 'WS-06 PTs (Flash)', firstRow: 6, lastRow: 17 },
  { sheetName: 'WS-07 Prog PTs', rows: [7, 8, 14, 15, 16, 17, 18, 19, 20, 21, 29, 30] }
];

const CARRYOVER_START_ROWS = [33, 50, 67];


function processSessionInventoryBeforeArchive_(context) {
  const sessionId = normalizeText_(context.sessionId);

  if (!sessionId) {
    return {
      ok: false,
      message: 'No authoritative SessionID could be resolved.'
    };
  }

  const state = getSessionProcessingState_(sessionId);

  if (state === 'Session Processed') {
    return {
      ok: true,
      alreadyProcessed: true,
      message: 'Session inventory was already processed.'
    };
  }

  if (
    state === 'Session Processing Started' ||
    state === 'Session Processing Failed'
  ) {
    return {
      ok: false,
      message:
        `Session inventory has state "${state}". ` +
        'Automatic retry is disabled; manual recovery is required.'
    };
  }

  const dateCode = formatPaperworkMMDDYY_(context.date);
  const file = findUniquePaperworkSheet_(
    context.folder,
    `LBA-Bingo_${dateCode}`
  );

  if (!file) {
    return {
      ok: false,
      message: 'The completed paperwork spreadsheet could not be found.'
    };
  }

  postSessionProcessingMarker_(
    sessionId,
    context.date,
    'Session Processing Started',
    `Started inventory processing from ${file.getName()} (${file.getId()}).`
  );

  try {
    const spreadsheet = SpreadsheetApp.openById(file.getId());

    const paperCount = processSessionPaper_(
      spreadsheet,
      context,
      file
    );

    const ptResult = processSessionPT_(
      spreadsheet,
      context,
      file
    );

    postSessionProcessingMarker_(
      sessionId,
      context.date,
      'Session Processed',
      `Completed inventory processing from ${file.getName()}. ` +
      `${paperCount} Paper transaction(s); ` +
      `${ptResult.transactions} PT transaction(s); ` +
      `${ptResult.issues} issue(s).`
    );

    return {
      ok: true,
      paperTransactions: paperCount,
      ptTransactions: ptResult.transactions,
      issues: ptResult.issues,
      message: 'Session inventory processing completed.'
    };
  } catch (error) {
    try {
      postSessionProcessingMarker_(
        sessionId,
        context.date,
        'Session Processing Failed',
        `Inventory processing failed: ${error.message}`
      );
    } catch (markerError) {
      console.error(
        'Unable to record Session Processing Failed marker:',
        markerError
      );
    }

    return {
      ok: false,
      message:
        `Inventory processing failed: ${error.message}`
    };
  }
}


function getSessionProcessingState_(sessionId) {
  let state = '';
  visitTransactionsNewestFirst_(
    ['Inventory_Type', 'Transaction_Type', 'Session_ID', 'Source'],
    (transaction) => {
      if (
        String(transaction.Inventory_Type) === 'System' &&
        String(transaction.Session_ID) === String(sessionId) &&
        String(transaction.Source) === SESSION_PROCESSING_SOURCE &&
        SESSION_MARKER_TYPES.includes(String(transaction.Transaction_Type))
      ) {
        state = String(transaction.Transaction_Type);
        return true;
      }
      return false;
    }
  );
  return state;
}


function postSessionProcessingMarker_(
  sessionId,
  effectiveDate,
  transactionType,
  notes
) {
  return postInventoryTransaction_({
    effectiveDate: effectiveDate,
    inventoryType: 'System',
    productId: '',
    itemId: '',
    formNumber: '',
    serialNumber: '',
    transactionType: transactionType,
    quantityChange: 0,
    unit: 'Session',
    sessionId: sessionId,
    source: SESSION_PROCESSING_SOURCE,
    notes: notes
  });
}


function processSessionPaper_(spreadsheet, context, sourceFile) {
  const sheet = spreadsheet.getSheetByName('WS-01 Paper');
  if (!sheet) throw new Error('Required worksheet WS-01 Paper is missing.');
  const requestedRows = PAPER_ROWS_BY_SESSION[context.label];
  const firstRow = Math.min(...requestedRows);
  const lastRow = Math.max(...requestedRows);
  const values = sheet.getRange(firstRow, 2, lastRow - firstRow + 1, 5).getValues();
  const casesBySerial = new Map(getPaperCases_().filter((row) => normalizeText_(row.Serial_Number)).map((row) => [normalizeText_(row.Serial_Number), row]));
  const entries = [];
  const issues = [];
  const caseUpdates = new Map();

  requestedRows.forEach((rowNumber) => {
    const row = values[rowNumber - firstRow];
    const description = normalizeText_(row[0]);
    const serialNumber = normalizeText_(row[1]);
    const quantity = Number(row[4] || 0);
    if (!serialNumber && quantity === 0) return;
    if (!serialNumber || !Number.isInteger(quantity) || quantity < 0) throw new Error(`Invalid Paper entry on WS-01 row ${rowNumber}.`);
    if (quantity === 0) return;
    const paperCase = casesBySerial.get(serialNumber);
    if (!paperCase) {
      issues.push({inventoryType:'Paper', issueType:'Unknown Serial', productId:'', itemId:'', serialNumber:serialNumber,
        sessionId:context.sessionId, expectedQuantity:0, reportedQuantity:quantity, discrepancyAmount:quantity,
        notes:`WS-01 row ${rowNumber}: ${description}. Source file ${sourceFile.getId()}.`});
      return;
    }
    const previous = caseUpdates.get(String(paperCase.Paper_Case_ID)) || {delta: 0, row: paperCase};
    const balance = Number(paperCase.Current_Packs || 0) + previous.delta;
    if (quantity > balance) issues.push({inventoryType:'Paper', issueType:'Insufficient Inventory', productId:paperCase.Paper_ID,
      itemId:paperCase.Paper_Case_ID, serialNumber:serialNumber, sessionId:context.sessionId, expectedQuantity:balance,
      reportedQuantity:quantity, discrepancyAmount:quantity-balance,
      notes:`Paperwork reports ${quantity} packs used from a current balance of ${balance}. WS-01 row ${rowNumber}.`});
    entries.push({effectiveDate:context.date, inventoryType:'Paper', productId:paperCase.Paper_ID, itemId:paperCase.Paper_Case_ID,
      serialNumber:serialNumber, transactionType:'Sold', quantityChange:-quantity, unit:'Pack', sessionId:context.sessionId,
      source:SESSION_PROCESSING_SOURCE, notes:`${description}; WS-01 row ${rowNumber}; source file ${sourceFile.getId()}.`});
    previous.delta -= quantity;
    caseUpdates.set(String(paperCase.Paper_Case_ID), previous);
  });

  createInventoryIssues_(issues);
  postInventoryTransactions_(entries);
  const statusUpdates = [];
  caseUpdates.forEach(({delta, row}) => {
    const remaining = Number(row.Current_Packs || 0) + delta;
    const updates = {};
    if (remaining <= 0) { updates.Case_Status='Expended'; updates.Expended_Date=context.date; }
    else if (String(row.Case_Status) === 'Unopened') { updates.Case_Status='Opened'; updates.Opened_Date=context.date; }
    if (Object.keys(updates).length) statusUpdates.push({rowNumber:row._rowNumber, updates:updates});
  });
  updateRecordRows_('Paper_Cases', statusUpdates);
  return entries.length;
}

function processSessionPT_(spreadsheet, context, sourceFile) {
  const observations = [];
  COMPLETED_PT_RANGES.forEach((definition) => {
    const sheet = spreadsheet.getSheetByName(definition.sheetName);
    if (!sheet) {
      throw new Error(`Required worksheet ${definition.sheetName} is missing.`);
    }
    const rows = definition.rows || createIntegerRange_(definition.firstRow, definition.lastRow);
    const firstRow = Math.min(...rows);
    const lastRow = Math.max(...rows);
    const values = sheet.getRange(firstRow, 4, lastRow - firstRow + 1, 2).getDisplayValues();
    rows.forEach((rowNumber) => {
      const row = values[rowNumber - firstRow];
      const serialNumber = normalizeText_(row[0]);
      const formNumber = normalizeFormNumber_(row[1]);
      if (!serialNumber || !formNumber || /^#N\/A$/i.test(serialNumber)) return;
      observations.push({
        kind: 'completed',
        formNumber: formNumber,
        serialNumber: serialNumber,
        location: `${definition.sheetName} row ${rowNumber}`
      });
    });
  });
  const main = spreadsheet.getSheetByName('WS-06 PTs (Main)');
  if (!main) throw new Error('Required worksheet WS-06 PTs (Main) is missing.');
  const firstCarryoverRow = Math.min(...CARRYOVER_START_ROWS);
  const lastCarryoverRow = Math.max(...CARRYOVER_START_ROWS) + 5;
  const values = main.getRange(firstCarryoverRow, 4, lastCarryoverRow - firstCarryoverRow + 1, 3).getValues();
  CARRYOVER_START_ROWS.forEach((startRow) => {
    const start = values[startRow - firstCarryoverRow];
    const sales = values[startRow + 5 - firstCarryoverRow];
    const serialNumber = normalizeText_(start[0]);
    const formNumber = normalizeFormNumber_(start[1]);
    if (!serialNumber || !formNumber) return;
    observations.push({
      kind: 'carryover',
      formNumber: formNumber,
      serialNumber: serialNumber,
      ticketCount: Number(start[2] || 0),
      totalSales: Number(sales[2] || 0),
      location: `Carry-over block row ${startRow}`
    });
  });
  observations.forEach((observation) => {
    const resolved = resolvePTGameByForm_(observation.formNumber, {includeInactive:true});
    observation.gameId = resolved ? resolved.gameId : '';
    observation.primaryFormNumber = resolved ? resolved.primaryFormNumber : observation.formNumber;
  });
  const dealsByKey = new Map();
  getPTDeals_().forEach((deal) => {
    const serial = normalizeText_(deal.Serial_Number);
    if (serial) dealsByKey.set(`${String(deal.PT_Game_ID)}::${serial}`, deal);
  });
  const plannedStatuses = new Map();
  const dealUpdates = [];
  const transactions = [];
  const issues = [];
  const balanceDeltas = new Map();
  observations.forEach((observation) => {
    const deal = observation.gameId
      ? dealsByKey.get(`${observation.gameId}::${observation.serialNumber}`)
      : null;
    if (!deal) {
      issues.push({
        inventoryType: 'PT', issueType: 'Unknown Deal', productId: observation.gameId, itemId: '',
        formNumber: observation.primaryFormNumber, serialNumber: observation.serialNumber,
        sessionId: context.sessionId, expectedQuantity: 0, reportedQuantity: 1,
        discrepancyAmount: 1,
        notes: `${observation.location}; source file ${sourceFile.getId()}.`
      });
      return;
    }
    const dealId = String(deal.PT_Deal_ID);
    const priorStatus = plannedStatuses.get(dealId) || String(deal.Deal_Status);
    let targetStatus;
    let transactionType;
    let quantityChange;
    let notes;
    if (observation.kind === 'completed') {
      if (priorStatus === 'Sold') {
        issues.push({inventoryType:'PT', issueType:'Duplicate Sale', productId:deal.PT_Game_ID,
          itemId:dealId, formNumber:observation.primaryFormNumber, serialNumber:observation.serialNumber,
          sessionId:context.sessionId, expectedQuantity:1, reportedQuantity:1, discrepancyAmount:0,
          notes:observation.location + '.'});
        return;
      }
      if (!['Bundled', 'Open'].includes(priorStatus)) {
        issues.push({inventoryType:'PT', issueType:'Unavailable Deal', productId:deal.PT_Game_ID,
          itemId:dealId, formNumber:observation.primaryFormNumber, serialNumber:observation.serialNumber,
          sessionId:context.sessionId, expectedQuantity:1, reportedQuantity:1, discrepancyAmount:0,
          notes:`Deal status was ${priorStatus}; ${observation.location}.`});
        return;
      }
      targetStatus = 'Sold';
      transactionType = 'Sold';
      quantityChange = priorStatus === 'Open' ? 0 : -1;
      notes = `${observation.location}; source file ${sourceFile.getId()}.`;
    } else {
      if (observation.totalSales > observation.ticketCount) {
        issues.push({inventoryType:'PT', issueType:'Unexpected Deal', productId:deal.PT_Game_ID,
          itemId:dealId, formNumber:observation.primaryFormNumber, serialNumber:observation.serialNumber,
          sessionId:context.sessionId, expectedQuantity:1, reportedQuantity:1, discrepancyAmount:0,
          notes:`Carry-over sales ${observation.totalSales} exceed ticket count ${observation.ticketCount}.`});
        return;
      }
      targetStatus = observation.totalSales === observation.ticketCount ? 'Sold' : 'Open';
      if (priorStatus === targetStatus) return;
      if (!['Bundled', 'Open'].includes(priorStatus)) {
        issues.push({inventoryType:'PT', issueType:'Unavailable Deal', productId:deal.PT_Game_ID,
          itemId:dealId, formNumber:observation.primaryFormNumber, serialNumber:observation.serialNumber,
          sessionId:context.sessionId, expectedQuantity:1, reportedQuantity:1, discrepancyAmount:0,
          notes:`Carry-over deal status was ${priorStatus}.`});
        return;
      }
      transactionType = targetStatus === 'Open' ? 'Opened' : 'Sold';
      quantityChange = priorStatus === 'Bundled' && targetStatus === 'Open' ? -1 : 0;
      notes = `${observation.location}; ${observation.totalSales}/${observation.ticketCount} sold; source file ${sourceFile.getId()}.`;
    }
    const updates = {Deal_Status: targetStatus};
    if (targetStatus === 'Sold') {
      updates.Expended_Date = context.date;
      updates.Expended_Session_ID = context.sessionId;
    }
    dealUpdates.push({rowNumber: deal._rowNumber, updates: updates});
    recordPTStatusChange_(balanceDeltas, deal.PT_Game_ID, priorStatus, targetStatus);
    plannedStatuses.set(dealId, targetStatus);
    transactions.push({
      effectiveDate: context.date, inventoryType: 'PT', productId: deal.PT_Game_ID,
      itemId: dealId, formNumber: observation.primaryFormNumber, serialNumber: observation.serialNumber,
      transactionType: transactionType, quantityChange: quantityChange, unit: 'Deal',
      sessionId: context.sessionId, source: SESSION_PROCESSING_SOURCE, notes: notes
    });
  });
  createInventoryIssues_(issues);
  updateRecordRows_('PT_Deals', dealUpdates);
  applyPTCatalogBalanceDeltas_(balanceDeltas);
  postInventoryTransactions_(transactions);
  return {transactions: transactions.length, issues: issues.length};
}


function processCompletedPTDeal_(
  formNumber,
  serialNumber,
  context,
  sheetName,
  rowNumber,
  sourceFile
) {
  const resolvedGame = resolvePTGameByForm_(formNumber, {includeInactive:true});
  const canonicalFormNumber = resolvedGame ? resolvedGame.primaryFormNumber : formNumber;
  const deal = resolvedGame
    ? findPTDeal_(resolvedGame.gameId, serialNumber)
    : null;

  if (!deal) {
    createPTPaperworkIssue_(
      'Unknown Deal',
      null,
      formNumber,
      serialNumber,
      context,
      `${sheetName} row ${rowNumber}; source file ${sourceFile.getId()}.`
    );

    return { transaction: false, issue: true };
  }

  const status = String(deal.Deal_Status);

  if (status === 'Sold') {
    createPTPaperworkIssue_(
      'Duplicate Sale',
      deal,
      formNumber,
      serialNumber,
      context,
      `${sheetName} row ${rowNumber}.`
    );

    return { transaction: false, issue: true };
  }

  const quantityChange = status === 'Open' ? 0 : -1;

  if (!['Bundled', 'Open'].includes(status)) {
    createPTPaperworkIssue_(
      'Unavailable Deal',
      deal,
      formNumber,
      serialNumber,
      context,
      `Deal status was ${status}; ${sheetName} row ${rowNumber}.`
    );

    return { transaction: false, issue: true };
  }

  updateRecordRow_('PT_Deals', deal._rowNumber, {
    Deal_Status: 'Sold',
    Expended_Date: context.date,
    Expended_Session_ID: context.sessionId
  });

    applySinglePTStatusChange_(
      deal.PT_Game_ID,
      status,
      'Sold'
    );
    postInventoryTransaction_({
      effectiveDate: context.date,
      inventoryType: 'PT',
      productId: deal.PT_Game_ID,
      itemId: deal.PT_Deal_ID,
      formNumber: canonicalFormNumber,
      serialNumber: serialNumber,
      transactionType: 'Sold',
    quantityChange: quantityChange,
    unit: 'Deal',
    sessionId: context.sessionId,
    source: SESSION_PROCESSING_SOURCE,
    notes: `${sheetName} row ${rowNumber}; source file ${sourceFile.getId()}.`
  });

  return { transaction: true, issue: false };
}


function processCarryoverPTDealValues_(values, startRow, context, sourceFile) {
  const serialNumber = normalizeText_(values.serialNumber);
  const formNumber = normalizeFormNumber_(values.formNumber);
  const ticketCount = Number(values.ticketCount || 0);

  if (!serialNumber || !formNumber) {
    return { transaction: false, issue: false };
  }

  const totalSales = Number(values.totalSales || 0);
  const resolvedGame = resolvePTGameByForm_(formNumber, {includeInactive:true});
  const canonicalFormNumber = resolvedGame ? resolvedGame.primaryFormNumber : formNumber;
  const deal = resolvedGame
    ? findPTDeal_(resolvedGame.gameId, serialNumber)
    : null;

  if (!deal) {
    createPTPaperworkIssue_(
      'Unknown Deal',
      null,
      formNumber,
      serialNumber,
      context,
      `Carry-over block beginning row ${startRow}.`
    );

    return { transaction: false, issue: true };
  }

  if (totalSales > ticketCount) {
    createPTPaperworkIssue_(
      'Unexpected Deal',
      deal,
      formNumber,
      serialNumber,
      context,
      `Carry-over sales ${totalSales} exceed ticket count ${ticketCount}.`
    );

    return { transaction: false, issue: true };
  }

  const completed = totalSales === ticketCount;
  const priorStatus = String(deal.Deal_Status);
  const targetStatus = completed ? 'Sold' : 'Open';

  if (priorStatus === targetStatus) {
    return { transaction: false, issue: false };
  }

  if (!['Bundled', 'Open'].includes(priorStatus)) {
    createPTPaperworkIssue_(
      'Unavailable Deal',
      deal,
      formNumber,
      serialNumber,
      context,
      `Carry-over deal status was ${priorStatus}.`
    );

    return { transaction: false, issue: true };
  }

  const quantityChange =
    priorStatus === 'Bundled' && targetStatus === 'Open'
      ? -1
      : 0;

  const updates = {
    Deal_Status: targetStatus
  };

  if (targetStatus === 'Sold') {
    updates.Expended_Date = context.date;
    updates.Expended_Session_ID = context.sessionId;
  }

  updateRecordRow_('PT_Deals', deal._rowNumber, updates);

    applySinglePTStatusChange_(
      deal.PT_Game_ID,
      priorStatus,
      targetStatus
    );
    postInventoryTransaction_({
      effectiveDate: context.date,
      inventoryType: 'PT',
      productId: deal.PT_Game_ID,
      itemId: deal.PT_Deal_ID,
      formNumber: canonicalFormNumber,
      serialNumber: serialNumber,
      transactionType: targetStatus === 'Open' ? 'Opened' : 'Sold',
    quantityChange: quantityChange,
    unit: 'Deal',
    sessionId: context.sessionId,
    source: SESSION_PROCESSING_SOURCE,
    notes:
      `Carry-over block row ${startRow}; ${totalSales}/${ticketCount} sold; ` +
      `source file ${sourceFile.getId()}.`
  });

  return { transaction: true, issue: false };
}
function processCarryoverPTDeal_(sheet, startRow, context, sourceFile) {
  const values = sheet.getRange(startRow, 4, 6, 3).getValues();
  return processCarryoverPTDealValues_(
    {
      serialNumber: values[0][0],
      formNumber: values[0][1],
      ticketCount: values[0][2],
      totalSales: values[5][2]
    },
    startRow,
    context,
    sourceFile
  );
}



function createPTPaperworkIssue_(
  issueType,
  deal,
  formNumber,
  serialNumber,
  context,
  notes
) {
  return createInventoryIssue_({
    inventoryType: 'PT',
    issueType: issueType,
    productId: deal ? deal.PT_Game_ID : '',
    itemId: deal ? deal.PT_Deal_ID : '',
    formNumber: formNumber,
    serialNumber: serialNumber,
    sessionId: context.sessionId,
    expectedQuantity: deal ? 1 : 0,
    reportedQuantity: 1,
    discrepancyAmount: deal ? 0 : 1,
    notes: notes
  });
}


function createIntegerRange_(first, last) {
  const output = [];

  for (let value = first; value <= last; value += 1) {
    output.push(value);
  }

  return output;
}
