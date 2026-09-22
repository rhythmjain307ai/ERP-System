const GSTIN_PATTERN = /\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/i;
const PAN_PATTERN = /\b[A-Z]{5}\d{4}[A-Z]\b/i;

function cleanAmount(value) {
  const number = Number(String(value || '').replace(/[^\d.-]/g, '').replace(/,(?=\d{3}\b)/g, ''));
  return Number.isFinite(number) ? number : null;
}

function valueAfterLabel(text, labels) {
  const source = String(text || '');
  for (const label of labels) {
    const match = source.match(new RegExp(`${label}[ \\t]*[:#-]?[ \\t]*([^\\n\\r]{1,120})`, 'im'));
    if (match) return match[1].trim();
  }
  return null;
}

function dateValue(value) {
  if (!value) return null;
  const named = value.match(/\b(\d{1,2})[- /]([a-z]{3,9})[- /](\d{4})\b/i);
  if (named) {
    const month = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(named[2].slice(0, 3).toLowerCase()) + 1;
    if (month) return dateValue(`${named[1]}/${month}/${named[3]}`);
  }
  const match = String(value).match(/\b(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})\b|\b(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})\b/);
  if (!match) return null;
  const iso = match[4] ? `${match[4]}-${match[5].padStart(2, '0')}-${match[6].padStart(2, '0')}` : `${match[3].length === 2 ? `20${match[3]}` : match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
  return Number.isNaN(Date.parse(iso)) || new Date(iso).toISOString().slice(0, 10) !== iso ? null : iso;
}

function amountAfterLabel(text, labels) {
  const value = valueAfterLabel(text, labels);
  const values = value && [...value.replace(/\d+(?:\.\d+)?\s*%/g, '').matchAll(/-?\d[\d,]*(?:\.\d{1,2})?/g)];
  return values?.length ? cleanAmount(values[values.length - 1][0]) : null;
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
    const hsn = line.match(/\b(?:HSN|SAC)\s*[:#-]?\s*(\d{4,8})\b/i) || line.match(/\b(\d{4,8})\s+\d+(?:\.\d+)?\s*(?:KG|PCS|NOS|EA)\b/i);
    const quantity = line.match(/\b(\d+(?:\.\d+)?)\s*(PCS|PC|KG|KGS|NOS|NO|EA|LTR|LITRE|MTR|MTS)\b/i);
    if (!hsn && !quantity) continue;
    if (!quantity) continue;
    const tail = line.slice(quantity.index + quantity[0].length);
    const amounts = [...tail.replace(/\d+(?:\.\d+)?\s*%/g, '').matchAll(/\d[\d,]*(?:\.\d{1,2})?/g)].map(match => cleanAmount(match[0]));
    items.push({
      description: line.slice(0, quantity.index).replace(/\b(?:HSN|SAC)\s*[:#-]?\s*\d{4,8}\b/i, '').replace(/\b\d{4,8}\s*$/, '').replace(/^\d+[.)]?\s+/, '').trim(),
      hsnSac: hsn?.[1] || null,
      quantity: quantity ? Number(quantity[1]) : null,
      unit: quantity?.[2]?.toUpperCase() || null,
      unitPrice: amounts.length > 1 ? amounts[0] : null,
      gstRate: tail.match(/(\d+(?:\.\d+)?)\s*%/) ? Number(tail.match(/(\d+(?:\.\d+)?)\s*%/)[1]) : null,
      taxableAmount: null,
      lineTotal: amounts.length ? amounts[amounts.length - 1] : null
    });
  }
  return items.slice(0, 100);
}

function extractInvoice(text) {
  text = String(text || '').replace(/\r/g, '').replace(/\u00a0/g, ' ');
  const gstins = findGstins(text);
  const invoiceNumber = valueAfterLabel(text, ['(?:invoice|inv|bill)[ \\t.]*(?:number|no\\.?|#)']);
  const invoiceDate = dateValue(valueAfterLabel(text, ['invoice\\s*date', 'dated', 'date']));
  const subtotal = amountAfterLabel(text, ['sub[ \\t]*total', 'taxable[ \\t]*(?:amount|value)']);
  const cgst = amountAfterLabel(text, ['cgst(?:\\s*amount)?']);
  const sgst = amountAfterLabel(text, ['sgst(?:\\s*amount)?']);
  const igst = amountAfterLabel(text, ['igst(?:\\s*amount)?']);
  const discount = amountAfterLabel(text, ['discount']);
  const roundOff = amountAfterLabel(text, ['round\\s*off']);
  const total = amountAfterLabel(text, ['grand[ \\t]*total', 'invoice[ \\t]*total', 'net[ \\t]*(?:amount|total)', 'total[ \\t]*(?:amount|invoice)', '^total(?=[ \\t:])']);
  const vendorName = guessParty(text, ['supplier(?:[ \\t]*name)?', 'vendor(?:[ \\t]*name)?', 'seller', 'from']) || text.split('\n').slice(0, 5).find(line => /[a-z]/i.test(line) && !/invoice|gst|date|bill|\d{4}/i.test(line))?.trim() || null;

  return {
    documentType: 'PURCHASE_INVOICE',
    invoiceNumber: invoiceNumber?.match(/^[A-Z0-9][A-Z0-9/._-]*/i)?.[0] || null,
    invoiceDate,
    vendor: { name: vendorName, gstin: gstins[0] || null, pan: text.match(PAN_PATTERN)?.[0]?.toUpperCase() || gstins[0]?.slice(2, 12) || null, address: null, phone: null, email: text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || null },
    buyer: { name: guessParty(text, ['buyer(?:\\s*name)?', 'bill\\s*to', 'consignee']), gstin: gstins[1] || null, address: null },
    amounts: { subtotal, taxableAmount: subtotal, cgst, sgst, igst, discount, roundOff, total },
    items: extractItems(text)
  };
}

module.exports = { extractInvoice, GSTIN_PATTERN };
