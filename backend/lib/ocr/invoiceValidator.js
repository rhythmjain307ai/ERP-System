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
  return {
    document_type: extracted.documentType || source.document_type || 'PURCHASE_INVOICE',
    invoice: { ...(source.invoice || {}), number: extracted.invoiceNumber ?? extracted.invoice_number ?? source.invoice?.number ?? null, date: extracted.invoiceDate ?? extracted.invoice_date ?? source.invoice?.date ?? null, po_number: extracted.poNumber ?? source.invoice?.po_number ?? null },
    supplier: { ...(source.supplier || {}), ...(extracted.vendor || {}), name: extracted.vendor?.name ?? extracted.vendor_name ?? source.supplier?.name ?? null, gstin: extracted.vendor?.gstin ?? extracted.vendor_gstin ?? extracted.vendorGstin ?? source.supplier?.gstin ?? null },
    buyer: { ...(source.buyer || {}), ...(extracted.buyer || {}) },
    items: [],
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
  }
  for (const [role, party] of [['Supplier', canonical.supplier], ['Buyer', canonical.buyer]]) if (party?.gstin && !validateGstin(party.gstin)) errors.push(`${role} GSTIN has an invalid structure or state/PAN component.`);
  const total = number(canonical.totals.grand_total);
  const taxable = number(canonical.totals.taxable_amount ?? canonical.totals.subtotal);
  if (present(canonical.totals.grand_total) && (!Number.isFinite(total) || total <= 0)) errors.push('Grand total must be a positive number.');
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
  const critical = invoiceLike ? [
    ['invoice.number', canonical.invoice.number, 0.32],
    ['invoice.date', canonical.invoice.date, 0.20],
    ['supplier.name', canonical.supplier.name, 0.19],
    ['totals.grand_total', canonical.totals.grand_total, 0.24],
    ['totals.taxable_amount', canonical.totals.taxable_amount ?? canonical.totals.subtotal, 0.05]
  ] : [];
  const fieldScore = critical.reduce((sum, [key, value, weight]) => {
    const raw = Number(canonical.field_evidence[key]?.confidence);
    const confidence = Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : (present(value) ? 0.5 : 0);
    return sum + confidence * weight;
  }, 0);
  const rawOcrConfidence = Number(ocrConfidence);
  const normalizedOcrConfidence = Number.isFinite(rawOcrConfidence) ? Math.max(0, Math.min(1, rawOcrConfidence > 1 ? rawOcrConfidence / 100 : rawOcrConfidence)) : 0;
  const conflictPenalty = canonical.conflicts.length ? 0.22 : 0;
  const confidence = Number(Math.max(0, Math.min(1, fieldScore * 0.82 + normalizedOcrConfidence * 0.18 - conflictPenalty)).toFixed(4));
  return { confidence, errors: deduplicated, status: deduplicated.length || confidence < 0.85 ? 'UNDER_REVIEW' : 'EXTRACTED', canonical };
}

module.exports = { validateInvoice, validateGstin, canonicalFrom, moneyTolerance };
