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


function getPaperworkAppData() {
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


function installDailyPaperworkTrigger() {
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


function removeDailyPaperworkTrigger() {
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


function createManualSingleDatePaperwork(dateString, label) {
  validatePaperworkConfiguration_();
  validatePaperworkLabel_(label);

  const date = parsePaperworkIsoDate_(dateString);

  if (!date) {
    throw new Error('Please select a valid session date.');
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const archiveResults = archivePastSessionPaperwork_(date);
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

    const creationResult = createOnePaperworkSet_(
      date,
      label,
      registry
    );

    return {
      archiveResults: archiveResults,
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


function archiveSelectedPaperwork(items) {
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
