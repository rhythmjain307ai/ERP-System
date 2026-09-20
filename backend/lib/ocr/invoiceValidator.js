const { GSTIN_PATTERN } = require('./invoiceExtractor');

function normalizeExtractionStatus(status) {
  const value = String(status || '').toUpperCase();
  if (value === 'PROCESSED') return 'EXTRACTED';
  if (value === 'NEEDS_REVIEW') return 'UNDER_REVIEW';
  if (value === 'FAILED') return 'VALIDATION_FAILED';
  return value;
}

function readInvoiceValue(record, ...paths) {
  for (const path of paths) {
    const segments = path.split('.');
    let value = record;
    let matched = true;
    for (const segment of segments) {
      if (value && Object.prototype.hasOwnProperty.call(value, segment)) value = value[segment];
      else { matched = false; break; }
    }
    if (matched && value !== undefined) return value;
  }
  return undefined;
}

function validateInvoice(extracted, ocrConfidence = 0) {
  const normalized = extracted || {};
  const invoiceNumber = readInvoiceValue(normalized, 'invoiceNumber', 'invoice_number');
  const invoiceDate = readInvoiceValue(normalized, 'invoiceDate', 'invoice_date');
  const vendorName = readInvoiceValue(normalized, 'vendor.name', 'vendor_name');
  const vendorGstin = readInvoiceValue(normalized, 'vendor.gstin', 'vendor_gstin', 'vendorGstin');
  const total = readInvoiceValue(normalized, 'amounts.total', 'total', 'amounts.taxableAmount', 'taxable_amount');
  const subtotal = readInvoiceValue(normalized, 'amounts.subtotal', 'subtotal', 'taxable_amount');
  const cgst = readInvoiceValue(normalized, 'amounts.cgst', 'cgst');
  const sgst = readInvoiceValue(normalized, 'amounts.sgst', 'sgst');
  const igst = readInvoiceValue(normalized, 'amounts.igst', 'igst');
  const discount = readInvoiceValue(normalized, 'amounts.discount', 'discount') ?? 0;
  const roundOff = readInvoiceValue(normalized, 'amounts.roundOff', 'round_off') ?? 0;
  const items = readInvoiceValue(normalized, 'items') || [];

  const errors = [];
  if (!invoiceNumber) errors.push('Invoice number was not detected.');
  if (!invoiceDate) errors.push('Invoice date was not detected or is invalid.');
  if (!vendorName) errors.push('Vendor name was not detected.');
  if (vendorGstin && !GSTIN_PATTERN.test(vendorGstin)) errors.push('Vendor GSTIN has an invalid format.');
  if (total === null || total === undefined) errors.push('Invoice total was not detected.');
  if (!items.length) errors.push('No line items were detected.');
  if ([subtotal, total].every((value) => value !== null && value !== undefined)) {
    const calculated = Number(subtotal) + Number(cgst || 0) + Number(sgst || 0) + Number(igst || 0) - Number(discount || 0) + Number(roundOff || 0);
    if (Math.abs(calculated - Number(total)) > 1) errors.push('Total does not match the detected subtotal, tax, discount, and round-off.');
  }
  let signals = 0;
  if (invoiceNumber) signals += 0.18;
  if (invoiceDate) signals += 0.12;
  if (vendorName) signals += 0.12;
  if (vendorGstin && GSTIN_PATTERN.test(vendorGstin)) signals += 0.14;
  if (total !== null && total !== undefined) signals += 0.18;
  if (items.length) signals += 0.16;
  if (!errors.some((error) => error.includes('Total does not match'))) signals += 0.10;
  const confidence = Math.max(0, Math.min(1, (signals * 0.75) + (Math.max(0, Math.min(100, ocrConfidence)) / 100 * 0.25)));
  const status = errors.length || confidence < 0.85 ? 'UNDER_REVIEW' : 'EXTRACTED';
  return { confidence, errors, status: normalizeExtractionStatus(status) };
}

module.exports = { validateInvoice };
