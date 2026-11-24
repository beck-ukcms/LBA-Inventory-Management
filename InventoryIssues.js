/**
 * InventoryIssues.js
 * LBA Bingo Inventory Management v1.14
 *
 * Read-only issue reporting plus explicit manual resolution.
 */


function serializeInventoryIssueDate_(value) {
  if (!value) return '';
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? '' : value.toISOString();
  }
  const parsed = new Date(value);
  return isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

function getInventoryIssues(token, statusFilter) {
  requireAdmin_(token);
  const normalizedFilter = normalizeText_(statusFilter) || 'Open';
  const validFilters = ['Open', 'Resolved', 'All'];
  if (!validFilters.includes(normalizedFilter)) {
    throw new Error('Invalid Inventory Issue filter.');
  }
  const ptById = new Map(
    getPTCatalog_().map((game) => [String(game.PT_Game_ID), game])
  );
  const paperById = new Map(
    getPaperCatalog_().map((paper) => [String(paper.Paper_ID), paper])
  );
  return getRecords_('Inventory_Issues')
    .filter((issue) => {
      return normalizedFilter === 'All' ||
        String(issue.Status) === normalizedFilter;
    })
    .map((issue) => {
      const inventoryType = String(issue.Inventory_Type);
      const productId = String(issue.Product_ID || '');
      const game = inventoryType === 'PT'
        ? ptById.get(productId)
        : null;
      const paper = inventoryType === 'Paper'
        ? paperById.get(productId)
        : null;
      let productLabel = productId || '(not identified)';
      if (game) {
        productLabel = String(game.Game_Name);
      } else if (inventoryType === 'PT' && issue.Form_Number) {
        productLabel = String(issue.Form_Number);
      } else if (paper) {
        productLabel = `${paper.Short_Name} - ${paper.Description}`;
      }
      return {
        issueId: String(issue.Issue_ID),
        timestamp: serializeInventoryIssueDate_(issue.Timestamp),
        inventoryType: inventoryType,
        issueType: String(issue.Issue_Type),
        productId: productId,
        productLabel: productLabel,
        itemId: String(issue.Item_ID || ''),
        formNumber: game
          ? normalizeFormNumber_(game.Primary_Form_Number)
          : String(issue.Form_Number || ''),
        serialNumber: String(issue.Serial_Number || ''),
        sessionId: String(issue.Session_ID || ''),
        expectedQuantity: Number(issue.Expected_Quantity || 0),
        reportedQuantity: Number(issue.Reported_Quantity || 0),
        discrepancyAmount: Number(issue.Discrepancy_Amount || 0),
        status: String(issue.Status),
        reconciliationId: String(issue.Reconciliation_ID || ''),
        notes: String(issue.Notes || ''),
        resolvedAt: serializeInventoryIssueDate_(issue.Resolved_At),
        resolutionNotes: String(issue.Resolution_Notes || '')
      };
    })
    .sort((first, second) => {
      const firstOpen = first.status === 'Open' ? 0 : 1;
      const secondOpen = second.status === 'Open' ? 0 : 1;
      if (firstOpen !== secondOpen) return firstOpen - secondOpen;
      return new Date(second.timestamp).getTime() -
        new Date(first.timestamp).getTime();
    });
}


function resolveInventoryIssue(token, issueId, resolutionNotes) {
  requireAdmin_(token);

  const normalizedIssueId = normalizeText_(issueId);
  const normalizedNotes = normalizeText_(resolutionNotes);

  if (!normalizedIssueId) {
    throw new Error('Inventory Issue ID is required.');
  }

  if (!normalizedNotes) {
    throw new Error('Resolution Notes are required.');
  }

  const issue = getRecords_('Inventory_Issues').find((candidate) => {
    return String(candidate.Issue_ID) === normalizedIssueId;
  });

  if (!issue) {
    throw new Error(`Inventory Issue ${normalizedIssueId} was not found.`);
  }

  if (String(issue.Status) !== 'Open') {
    throw new Error(
      `Inventory Issue ${normalizedIssueId} is already ${issue.Status}.`
    );
  }

  updateRecordRow_(
    'Inventory_Issues',
    issue._rowNumber,
    {
      Status: 'Resolved',
      Resolved_At: now_(),
      Resolution_Notes: normalizedNotes
    }
  );

  return {
    issueId: normalizedIssueId,
    status: 'Resolved'
  };
}

function resolveInventoryIssueRecord_(issue, resolutionNotes) {
  updateRecordRow_('Inventory_Issues', issue._rowNumber, {
    Status: 'Resolved',
    Resolved_At: now_(),
    Resolution_Notes: normalizeText_(resolutionNotes)
  });
}
