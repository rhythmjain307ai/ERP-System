const { GSTIN_PATTERN } = require('./invoiceExtractor');

function validateInvoice(extracted, ocrConfidence = 0) {
  extracted = extracted && typeof extracted === 'object' ? extracted : {};
  const invoiceNumber = extracted.invoiceNumber ?? extracted.invoice_number;
  const invoiceDate = extracted.invoiceDate ?? extracted.invoice_date;
  const vendor = extracted.vendor || { name: extracted.vendor_name, gstin: extracted.vendor_gstin ?? extracted.vendorGstin };
  const amounts = extracted.amounts || {};
  const total = amounts.total ?? extracted.total;
  const subtotal = amounts.subtotal ?? extracted.subtotal ?? extracted.taxable_amount;
  const errors = [];
  if (!invoiceNumber) errors.push('Invoice number was not detected.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(invoiceDate || '') || Number.isNaN(Date.parse(invoiceDate)) || new Date(invoiceDate).toISOString().slice(0, 10) !== invoiceDate) errors.push('Invoice date was not detected or is invalid.');
  if (!vendor.name) errors.push('Vendor name was not detected.');
  if (vendor.gstin && !GSTIN_PATTERN.test(vendor.gstin)) errors.push('Vendor GSTIN has an invalid format.');
  if (total === null || total === undefined) errors.push('Invoice total was not detected.');
  if (!extracted.items?.length) errors.push('No line items were detected.');
  if (total != null && (!Number.isFinite(Number(total)) || Number(total) <= 0)) errors.push('Total must be a positive number.');
  if (subtotal == null) errors.push('Subtotal/taxable value was not detected.');
  if (Array.isArray(extracted.items) && extracted.items.some(item => !item.description || !(Number(item.quantity) > 0) || !(Number(item.unitPrice) >= 0) || item.unitPrice == null || item.lineTotal == null)) errors.push('One or more line items are incomplete.');
  const { cgst = extracted.cgst, sgst = extracted.sgst, igst = extracted.igst, discount = extracted.discount || 0, roundOff = extracted.round_off || 0 } = amounts;
  if ([subtotal, total].every((value) => value !== null && value !== undefined)) {
    const calculated = Number(subtotal) + Number(cgst || 0) + Number(sgst || 0) + Number(igst || 0) - Number(discount || 0) + Number(roundOff || 0);
    if (Math.abs(calculated - Number(total)) > 1) errors.push('Total does not match the detected subtotal, tax, discount, and round-off.');
  }
  let signals = 0;
  if (invoiceNumber) signals += 0.18;
  if (invoiceDate) signals += 0.12;
  if (vendor.name) signals += 0.12;
  if (vendor.gstin && GSTIN_PATTERN.test(vendor.gstin)) signals += 0.14;
  if (total !== null && total !== undefined) signals += 0.18;
  if (extracted.items?.length) signals += 0.16;
  if (!errors.some((error) => error.includes('Total does not match'))) signals += 0.10;
  const confidence = Math.max(0, Math.min(1, (signals * 0.75) + (Math.max(0, Math.min(100, ocrConfidence)) / 100 * 0.25)));
  return { confidence, errors, status: errors.length || confidence < 0.85 ? 'UNDER_REVIEW' : 'EXTRACTED' };
}

module.exports = { validateInvoice };
