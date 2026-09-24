const { GSTIN_PATTERN } = require('./invoiceExtractor');

const number = value => value === null || value === undefined || value === '' ? null : Number(value);
const present = value => value !== null && value !== undefined && value !== '';
const moneyTolerance = expected => Math.max(1, Math.abs(Number(expected) || 0) * 0.001);
const near = (actual, expected, tolerance = moneyTolerance(expected)) => Number.isFinite(Number(actual)) && Number.isFinite(Number(expected)) && Math.abs(Number(actual) - Number(expected)) <= tolerance;

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || '') && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

function validateGstin(value) {
  if (!GSTIN_PATTERN.test(String(value || ''))) return false;
  const state = Number(String(value).slice(0, 2));
  const pan = String(value).slice(2, 12);
  return state >= 1 && state <= 38 && /^[A-Z]{5}\d{4}[A-Z]$/.test(pan);
}

function canonicalFrom(extracted) {
  extracted = extracted && typeof extracted === 'object' ? extracted : {};
  const source = extracted.canonical || {};
  const amounts = extracted.amounts || {};
  const legacyItems = Array.isArray(extracted.items) ? extracted.items.map(item => ({ description: item.description, hsn_sac: item.hsn_sac ?? item.hsnSac, quantity: item.quantity, unit: item.unit, unit_price: item.unit_price ?? item.unitPrice, discount: item.discount, taxable_amount: item.taxable_amount ?? item.taxableAmount, gst_rate: item.gst_rate ?? item.gstRate, cgst: item.cgst, sgst: item.sgst, igst: item.igst, cess: item.cess, line_total: item.line_total ?? item.lineTotal })) : [];
  return {
    document_type: extracted.documentType || source.document_type || 'PURCHASE_INVOICE',
    invoice: { ...(source.invoice || {}), number: extracted.invoiceNumber ?? extracted.invoice_number ?? source.invoice?.number ?? null, date: extracted.invoiceDate ?? extracted.invoice_date ?? source.invoice?.date ?? null, po_number: extracted.poNumber ?? source.invoice?.po_number ?? null },
    supplier: { ...(source.supplier || {}), ...(extracted.vendor || {}), name: extracted.vendor?.name ?? extracted.vendor_name ?? source.supplier?.name ?? null, gstin: extracted.vendor?.gstin ?? extracted.vendor_gstin ?? extracted.vendorGstin ?? source.supplier?.gstin ?? null },
    buyer: { ...(source.buyer || {}), ...(extracted.buyer || {}) },
    items: legacyItems.length ? legacyItems : source.items || [],
    taxes: { ...(source.taxes || {}), cgst: amounts.cgst ?? extracted.cgst ?? source.taxes?.cgst ?? null, sgst: amounts.sgst ?? extracted.sgst ?? source.taxes?.sgst ?? null, igst: amounts.igst ?? extracted.igst ?? source.taxes?.igst ?? null, cess: amounts.cess ?? extracted.cess ?? source.taxes?.cess ?? null },
    totals: { ...(source.totals || {}), subtotal: amounts.subtotal ?? extracted.subtotal ?? source.totals?.subtotal ?? null, taxable_amount: amounts.taxableAmount ?? extracted.taxable_amount ?? source.totals?.taxable_amount ?? null, discount: amounts.discount ?? extracted.discount ?? source.totals?.discount ?? null, other_charges: amounts.otherCharges ?? source.totals?.other_charges ?? null, round_off: amounts.roundOff ?? extracted.round_off ?? source.totals?.round_off ?? null, grand_total: amounts.total ?? extracted.total ?? source.totals?.grand_total ?? null },
    related_documents: extracted.relatedDocuments || source.related_documents || [],
    field_evidence: extracted.fieldEvidence || source.field_evidence || {},
    conflicts: extracted.conflicts || source.conflicts || []
  };
}

function validateInvoice(extracted, ocrConfidence = 0) {
  const canonical = canonicalFrom(extracted);
  const errors = [];
  const invoiceLike = ['PURCHASE_INVOICE', 'TAX_INVOICE', 'SALES_INVOICE'].includes(canonical.document_type);
  if (invoiceLike) {
    if (!canonical.invoice.number) errors.push('Invoice number was not detected.');
    if (!validDate(canonical.invoice.date)) errors.push('Invoice date was not detected or is invalid.');
    if (!canonical.supplier.name) errors.push('Supplier/vendor name was not detected.');
    if (!present(canonical.totals.grand_total)) errors.push('Invoice grand total was not detected.');
    if (!present(canonical.totals.taxable_amount) && !present(canonical.totals.subtotal)) errors.push('Subtotal/taxable value was not detected.');
    if (!canonical.items.length) errors.push('No line items were detected.');
  }
  for (const [role, party] of [['Supplier', canonical.supplier], ['Buyer', canonical.buyer]]) if (party?.gstin && !validateGstin(party.gstin)) errors.push(`${role} GSTIN has an invalid structure or state/PAN component.`);
  const total = number(canonical.totals.grand_total);
  const taxable = number(canonical.totals.taxable_amount ?? canonical.totals.subtotal);
  if (present(canonical.totals.grand_total) && (!Number.isFinite(total) || total <= 0)) errors.push('Grand total must be a positive number.');
  for (const [index, item] of canonical.items.entries()) {
    const quantity = number(item.quantity);
    const unitPrice = number(item.unit_price);
    const lineBase = number(item.taxable_amount ?? item.line_total);
    if (!item.description || !(quantity > 0)) errors.push(`Line item ${index + 1} is missing a description or positive quantity.`);
    if (quantity > 0 && unitPrice !== null && lineBase !== null && !near(quantity * unitPrice - Number(item.discount || 0), lineBase)) errors.push(`Line item ${index + 1} quantity × unit price does not reconcile with its taxable/line amount.`);
    if (lineBase !== null && present(item.gst_rate)) {
      const expectedTax = lineBase * Number(item.gst_rate) / 100;
      const tax = [item.cgst, item.sgst, item.igst, item.cess].filter(present).reduce((sum, value) => sum + Number(value), 0);
      if (tax && !near(tax, expectedTax)) errors.push(`Line item ${index + 1} GST does not reconcile with the detected rate.`);
    }
  }
  const lineAmounts = canonical.items.map(item => number(item.taxable_amount ?? item.line_total));
  if (taxable !== null && lineAmounts.length && lineAmounts.every(value => value !== null) && !near(lineAmounts.reduce((sum, value) => sum + value, 0), taxable)) errors.push('The sum of detected line amounts does not match the taxable amount.');
  if (taxable !== null && total !== null) {
    const expected = taxable + Number(canonical.taxes.cgst || 0) + Number(canonical.taxes.sgst || 0) + Number(canonical.taxes.igst || 0) + Number(canonical.taxes.cess || 0) + Number(canonical.totals.other_charges || 0) - Number(canonical.totals.discount || 0) + Number(canonical.totals.round_off || 0);
    if (!near(total, expected)) errors.push('Grand total does not reconcile with taxable value, taxes, charges, discount, and round-off.');
  }
  for (const related of canonical.related_documents) {
    if (related.type === 'WEIGHBRIDGE_SLIP' && [related.gross_weight, related.tare_weight, related.net_weight].every(present) && !near(Number(related.gross_weight) - Number(related.tare_weight), Number(related.net_weight), Math.max(1, Number(related.net_weight) * 0.002))) errors.push(`Weighbridge values on page ${related.page} do not reconcile (gross − tare ≠ net).`);
    if (related.document_number && canonical.invoice.number && related.document_number !== canonical.invoice.number && ['E_WAY_BILL', 'E_INVOICE_REPORT'].includes(related.type)) errors.push(`${related.type.replaceAll('_', ' ')} on page ${related.page} references a different invoice/document number.`);
  }
  for (const conflict of canonical.conflicts) errors.push(`Conflicting evidence was found for ${conflict.field}; manual review is required.`);
  const requiredEvidence = invoiceLike ? ['invoice.number', 'invoice.date', 'supplier.name', 'totals.grand_total'] : [];
  for (const field of requiredEvidence) {
    const evidence = canonical.field_evidence[field];
    if (evidence && evidence.confidence < 0.72) errors.push(`${field} has low extraction confidence.`);
  }
  const deduplicated = [...new Set(errors)];
  const evidence = Object.values(canonical.field_evidence).filter(item => item && Number.isFinite(Number(item.confidence)));
  const fieldConfidence = evidence.length ? evidence.reduce((sum, item) => sum + Number(item.confidence), 0) / evidence.length : 0;
  const completeness = invoiceLike ? [canonical.invoice.number, canonical.invoice.date, canonical.supplier.name, canonical.totals.grand_total, canonical.items.length].filter(Boolean).length / 5 : canonical.related_documents.length ? 0.8 : 0.2;
  const confidence = Math.max(0, Math.min(1, fieldConfidence * 0.45 + completeness * 0.35 + Math.max(0, Math.min(100, Number(ocrConfidence) || 0)) / 100 * 0.20));
  return { confidence, errors: deduplicated, status: deduplicated.length || confidence < 0.85 ? 'UNDER_REVIEW' : 'EXTRACTED', canonical };
}

module.exports = { validateInvoice, validateGstin, canonicalFrom, moneyTolerance };
