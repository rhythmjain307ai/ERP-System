const { GSTIN_PATTERN } = require('./invoiceExtractor');

function validateInvoice(extracted, ocrConfidence = 0) {
  extracted = extracted && typeof extracted === 'object' ? extracted : {};
  const errors = [];
  if (!extracted.invoiceNumber) errors.push('Invoice number was not detected.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(extracted.invoiceDate || '') || Number.isNaN(Date.parse(extracted.invoiceDate)) || new Date(extracted.invoiceDate).toISOString().slice(0, 10) !== extracted.invoiceDate) errors.push('Invoice date was not detected or is invalid.');
  if (!extracted.vendor?.name) errors.push('Vendor name was not detected.');
  if (extracted.vendor?.gstin && !GSTIN_PATTERN.test(extracted.vendor.gstin)) errors.push('Vendor GSTIN has an invalid format.');
  if (extracted.amounts?.total === null || extracted.amounts?.total === undefined) errors.push('Invoice total was not detected.');
  if (!extracted.items?.length) errors.push('No line items were detected.');
  if (extracted.amounts?.total != null && (!Number.isFinite(Number(extracted.amounts.total)) || Number(extracted.amounts.total) <= 0)) errors.push('Total must be a positive number.');
  if (extracted.amounts?.subtotal == null) errors.push('Subtotal/taxable value was not detected.');
  if (Array.isArray(extracted.items) && extracted.items.some(item => !item.description || !(Number(item.quantity) > 0) || !(Number(item.unitPrice) >= 0) || item.unitPrice == null || item.lineTotal == null)) errors.push('One or more line items are incomplete.');
  const { subtotal, cgst, sgst, igst, discount = 0, roundOff = 0, total } = extracted.amounts || {};
  if ([subtotal, total].every((value) => value !== null && value !== undefined)) {
    const calculated = Number(subtotal) + Number(cgst || 0) + Number(sgst || 0) + Number(igst || 0) - Number(discount || 0) + Number(roundOff || 0);
    if (Math.abs(calculated - Number(total)) > 1) errors.push('Total does not match the detected subtotal, tax, discount, and round-off.');
  }
  let signals = 0;
  if (extracted.invoiceNumber) signals += 0.18;
  if (extracted.invoiceDate) signals += 0.12;
  if (extracted.vendor?.name) signals += 0.12;
  if (extracted.vendor?.gstin && GSTIN_PATTERN.test(extracted.vendor.gstin)) signals += 0.14;
  if (extracted.amounts?.total !== null && extracted.amounts?.total !== undefined) signals += 0.18;
  if (extracted.items?.length) signals += 0.16;
  if (!errors.some((error) => error.includes('Total does not match'))) signals += 0.10;
  const confidence = Math.max(0, Math.min(1, (signals * 0.75) + (Math.max(0, Math.min(100, ocrConfidence)) / 100 * 0.25)));
  return { confidence, errors, status: errors.length || confidence < 0.85 ? 'NEEDS_REVIEW' : 'PROCESSED' };
}

module.exports = { validateInvoice };
