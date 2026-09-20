const GSTIN_PATTERN = /\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/i;
const PAN_PATTERN = /\b[A-Z]{5}\d{4}[A-Z]\b/i;

function cleanAmount(value) {
  const number = Number(String(value || '').replace(/[^\d.-]/g, '').replace(/,(?=\d{3}\b)/g, ''));
  return Number.isFinite(number) ? number : null;
}

function valueAfterLabel(text, labels) {
  const source = String(text || '');
  for (const label of labels) {
    const match = source.match(new RegExp(`${label}[ \\t]*[:#-]?[ \\t]*([^\\n\\r]{1,80})`, 'i'));
    if (match) return match[1].trim();
  }
  return null;
}

function dateValue(value) {
  if (!value) return null;
  const match = String(value).match(/\b(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})\b|\b(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})\b/);
  if (!match) return null;
  const iso = match[4] ? `${match[4]}-${match[5].padStart(2, '0')}-${match[6].padStart(2, '0')}` : `${match[3].length === 2 ? `20${match[3]}` : match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

function amountAfterLabel(text, labels) {
  const value = valueAfterLabel(text, labels);
  const match = value && value.match(/[₹Rs.\s]*([\d,]+(?:\.\d{1,2})?)/i);
  return match ? cleanAmount(match[1]) : null;
}

function findGstins(text) {
  return [...String(text || '').matchAll(new RegExp(GSTIN_PATTERN.source, 'gi'))].map((match) => match[0].toUpperCase());
}

function guessParty(text, labels) {
  const value = valueAfterLabel(text, labels);
  if (!value) return null;
  return value.replace(/\b(GSTIN|GST\s*(?:NO|NUMBER)).*$/i, '').trim() || null;
}

function extractItems(text) {
  const items = [];
  const lines = String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    const hsn = line.match(/\b(?:HSN|SAC)\s*[:#-]?\s*(\d{4,8})\b/i);
    const quantity = line.match(/\b(\d+(?:\.\d+)?)\s*(PCS|PC|KG|KGS|NOS|NO|EA|LTR|LITRE|MTR|MTS)\b/i);
    if (!hsn && !quantity) continue;
    const amounts = [...line.matchAll(/(?:₹|Rs\.?\s*)?(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)/gi)].map((match) => cleanAmount(match[1])).filter((value) => value !== null);
    items.push({
      description: line.replace(/\b(?:HSN|SAC)\s*[:#-]?\s*\d{4,8}\b/i, '').slice(0, 180).trim(),
      hsnSac: hsn?.[1] || null,
      quantity: quantity ? Number(quantity[1]) : null,
      unit: quantity?.[2]?.toUpperCase() || null,
      unitPrice: amounts.length > 1 ? amounts[amounts.length - 2] : null,
      gstRate: null,
      taxableAmount: amounts.length > 1 ? amounts[amounts.length - 2] : null,
      lineTotal: amounts.length ? amounts[amounts.length - 1] : null
    });
  }
  return items.slice(0, 100);
}

function extractInvoice(text) {
  const gstins = findGstins(text);
  const invoiceNumber = valueAfterLabel(text, ['invoice[ \\t.]*(?:no|number|#)', 'inv[ \\t.]*(?:no|number|#)']);
  const invoiceDate = dateValue(valueAfterLabel(text, ['invoice\\s*date', 'dated', 'date']));
  const subtotal = amountAfterLabel(text, ['subtotal', 'taxable\\s*(?:amount|value)']);
  const cgst = amountAfterLabel(text, ['cgst(?:\\s*amount)?']);
  const sgst = amountAfterLabel(text, ['sgst(?:\\s*amount)?']);
  const igst = amountAfterLabel(text, ['igst(?:\\s*amount)?']);
  const discount = amountAfterLabel(text, ['discount']);
  const roundOff = amountAfterLabel(text, ['round\\s*off']);
  const total = amountAfterLabel(text, ['grand\\s*total', 'invoice\\s*total', 'net\\s*(?:amount|total)', 'total\\s*(?:amount|invoice)']);

  return {
    documentType: 'PURCHASE_INVOICE',
    invoiceNumber: invoiceNumber ? invoiceNumber.replace(/\s{2,}.*/, '').trim() : null,
    invoiceDate,
    vendor: { name: guessParty(text, ['supplier(?:\\s*name)?', 'vendor(?:\\s*name)?', 'from']), gstin: gstins[0] || null, pan: text.match(PAN_PATTERN)?.[0]?.toUpperCase() || null, address: null, phone: null, email: null },
    buyer: { name: guessParty(text, ['buyer(?:\\s*name)?', 'bill\\s*to', 'consignee']), gstin: gstins[1] || null, address: null },
    amounts: { subtotal, taxableAmount: subtotal, cgst, sgst, igst, discount, roundOff, total },
    items: extractItems(text)
  };
}

module.exports = { extractInvoice, GSTIN_PATTERN };
