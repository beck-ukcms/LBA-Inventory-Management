/**
 * InventoryIssues.js
 * LBA Bingo Inventory Management v1.14
 *
 * Read-only issue reporting plus explicit manual resolution.
 */


function getInventoryIssues(token, statusFilter) {
  requireAdmin_(token);

  const normalizedFilter = normalizeText_(statusFilter) || 'Open';
  const validFilters = [
    'Open',
    'Resolved',
    'All'
  ];

  if (!validFilters.includes(normalizedFilter)) {
    throw new Error('Invalid Inventory Issue filter.');
  }

  const ptCatalog = getPTCatalog_();
  const paperCatalog = getPaperCatalog_();

  return getRecords_('Inventory_Issues')
    .filter((issue) => {
      return (
        normalizedFilter === 'All' ||
        String(issue.Status) === normalizedFilter
      );
    })
    .map((issue) => {
      const inventoryType = String(issue.Inventory_Type);
      const productId = String(issue.Product_ID || '');
      let productLabel = productId || '(not identified)';

      if (inventoryType === 'PT') {
        const game = ptCatalog.find((catalogRow) => {
          return String(catalogRow.PT_Game_ID) === productId;
        });

        if (game) {
          productLabel = String(game.Game_Name);
        } else if (issue.Form_Number) {
          productLabel = String(issue.Form_Number);
        }
      }

      if (inventoryType === 'Paper') {
        const paper = paperCatalog.find((catalogRow) => {
          return String(catalogRow.Paper_ID) === productId;
        });

        if (paper) {
          productLabel =
            `${paper.Short_Name} - ${paper.Description}`;
        }
      }

      return {
        issueId: String(issue.Issue_ID),
        timestamp: issue.Timestamp,
        inventoryType: inventoryType,
        issueType: String(issue.Issue_Type),
        productId: productId,
        productLabel: productLabel,
        itemId: String(issue.Item_ID || ''),
        formNumber: String(issue.Form_Number || ''),
        serialNumber: String(issue.Serial_Number || ''),
        sessionId: String(issue.Session_ID || ''),
        expectedQuantity: Number(issue.Expected_Quantity || 0),
        reportedQuantity: Number(issue.Reported_Quantity || 0),
        discrepancyAmount: Number(issue.Discrepancy_Amount || 0),
        status: String(issue.Status),
        reconciliationId: String(issue.Reconciliation_ID || ''),
        notes: String(issue.Notes || ''),
        resolvedAt: issue.Resolved_At || '',
        resolutionNotes: String(issue.Resolution_Notes || '')
      };
    })
    .sort((first, second) => {
      const firstOpen = first.status === 'Open' ? 0 : 1;
      const secondOpen = second.status === 'Open' ? 0 : 1;

      if (firstOpen !== secondOpen) {
        return firstOpen - secondOpen;
      }

      return (
        new Date(second.timestamp).getTime() -
        new Date(first.timestamp).getTime()
      );
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
