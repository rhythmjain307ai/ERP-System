const { normalizeLabel } = require('./semanticVocabulary');

const RULES = [
  ['WEIGHBRIDGE_SLIP', [[/weigh\s*bridge/, 5], [/gross\s*(?:weight|wt)/, 2], [/tare\s*(?:weight|wt)/, 2], [/net\s*(?:weight|wt)/, 2]]],
  ['MATERIAL_RECEIPT_NOTE', [[/material\s+receipt\s+note/, 7], [/\bmrn\b/, 4], [/challan\s+qty/, 2], [/accepted\s+qty/, 2]]],
  ['GOODS_INWARD_REPORT', [[/goods\s+inwards?\s+report/, 7], [/gate\s+entry/, 3], [/received\s+accepted\s+rejected/, 3]]],
  ['E_WAY_BILL', [[/e\s*way\s+bill/, 7], [/valid\s+(?:upto|until)/, 2], [/reason\s+for\s+transportation/, 2]]],
  ['E_INVOICE_REPORT', [[/e\s*invoice\s+report/, 8], [/invoice\s+reference\s+number/, 4], [/\birn\b/, 4], [/ack\s+(?:no|number|date)/, 3], [/party\s+details/, 2], [/transaction\s+details/, 2], [/supply\s+type\s+code/, 3], [/document\s+type\s+tax\s+invoice/, 3], [/details\s+of\s+goods\s+services/, 2]]],
  ['DELIVERY_CHALLAN', [[/delivery\s+challan/, 7], [/challan\s+(?:no|number)/, 3]]],
  ['TAX_INVOICE', [[/tax\s+invoice/, 6], [/invoice\s+(?:no|number)/, 2], [/taxable\s+(?:amount|value)/, 2], [/grand\s+total/, 2], [/name\s+of\s+(?:product|goods)/, 2], [/gst\s+amount\s+in\s+words/, 2], [/\bcgst\b/, 1], [/\bsgst\b/, 1]]],
];

function classifyPage(page) {
  const text = normalizeLabel(page?.text || '', false);
  const scores = RULES.map(([type, rules]) => ({ type, score: rules.reduce((sum, [pattern, weight]) => sum + (pattern.test(text) ? weight : 0), 0) })).sort((a, b) => b.score - a.score);
  const best = scores[0];
  return { type: best?.score >= 3 ? best.type : 'UNKNOWN', confidence: best?.score ? Math.min(0.99, 0.5 + best.score * 0.05) : 0, scores: scores.filter(item => item.score > 0) };
}

function classifyDocument(ocr) {
  const pages = (ocr?.pages?.length ? ocr.pages : [{ pageNumber: 1, text: ocr?.text || '' }]).map(page => ({ pageNumber: page.pageNumber, ...classifyPage(page) }));
  const counts = new Map();
  for (const page of pages) counts.set(page.type, (counts.get(page.type) || 0) + page.confidence);
  const primary = [...counts.entries()].filter(([type]) => type !== 'UNKNOWN').sort((a, b) => b[1] - a[1])[0]?.[0] || 'UNKNOWN';
  const hasInvoice = pages.some(page => page.type === 'TAX_INVOICE');
  return { documentType: hasInvoice ? 'PURCHASE_INVOICE' : primary, pages };
}

module.exports = { classifyPage, classifyDocument };
