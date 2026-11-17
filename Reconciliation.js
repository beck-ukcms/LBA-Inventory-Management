/** Shared reconciliation record operations. */
function createReconciliationRecord_(data) {
  const expected = integerOrThrow_(data.expectedQuantity, 'Expected Quantity');
  const observed = integerOrThrow_(data.observedQuantity, 'Observed Quantity');
  const correction = observed - expected;
  const id = generateId_('RECONCILIATION', 'REC-', 7);
  appendRecord_('Reconciliation_Records', {
    Reconciliation_ID: id,
    Timestamp: now_(),
    Inventory_Type: data.inventoryType,
    Product_ID: data.productId,
    Item_ID: data.itemId || '',
    Form_Number: data.formNumber || '',
    Serial_Number: data.serialNumber,
    Reconciliation_Type: data.reconciliationType || 'Inventory Check',
    Expected_Quantity: expected,
    Observed_Quantity: observed,
    Correction_Amount: correction,
    Observed_PT_Status: data.observedPTStatus || '',
    Issue_ID: data.issueId || '',
    Correction_Transaction_ID: '',
    Notes: data.notes || '',
  });
  return {id, correction};
}

function linkReconciliationTransaction_(reconciliationId, transactionId) {
  const record = getRecords_('Reconciliation_Records').find(row => String(row.Reconciliation_ID) === String(reconciliationId));
  if (!record) throw new Error(`Reconciliation ${reconciliationId} was not found.`);
  updateRecordRow_('Reconciliation_Records', record._rowNumber, {Correction_Transaction_ID: transactionId});
}
