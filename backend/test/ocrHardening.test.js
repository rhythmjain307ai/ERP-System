const test = require('node:test');
const assert = require('node:assert/strict');
const { extractInvoice, extractStructuredDocument } = require('../lib/ocr/invoiceExtractor');
const { validateInvoice } = require('../lib/ocr/invoiceValidator');
const { classifyDocument } = require('../lib/ocr/documentClassifier');
const { normalizeTesseractPage } = require('../lib/ocr/ocrService');

const complete = numberLabel => `TAX INVOICE
Supplier: ABC Steel Industries
GSTIN: 27AAECA1234F1Z5
${numberLabel}: FF/26/104
Invoice Date: 21/09/2026
Buyer: Forge Works
Buyer GSTIN: 29AAACB1234C1Z1
Steel bar HSN: 7214 10 KGS 100.00 1000.00
Taxable Amount: 1000.00
CGST 9%: 90.00
SGST 9%: 90.00
Grand Total: 1180.00`;

for (const label of ['Invoice No', 'Invoice Number', 'Inv No', 'Inv. No.', 'Invoice #', 'Bill No', 'Tax Invoice No']) {
  test(`normalizes invoice label variation: ${label}`, () => assert.equal(extractInvoice(complete(label)).invoiceNumber, 'FF/26/104'));
}

test('keeps invoice, PO, e-way, IRN, acknowledgement and vehicle numbers semantically separate', () => {
  const fields = extractInvoice(`${complete('Invoice No')}\nPO No: PO-7741\nE-Way Bill No: 252210659224\nVehicle No: MH08H1399\nIRN: 84c1d4e4b725a8a313773582f5f3101b\nAck No: 122633278943121`);
  assert.equal(fields.invoiceNumber, 'FF/26/104');
  assert.equal(fields.poNumber, 'PO-7741');
  assert.equal(fields.logistics.eway_bill_number, '252210659224');
  assert.equal(fields.logistics.vehicle_number, 'MH08H1399');
  assert.equal(fields.eInvoice.ack_number, '122633278943121');
});

test('associates supplier and buyer GSTINs by context rather than occurrence order', () => {
  const fields = extractInvoice(`TAX INVOICE\nBuyer: Forge Works\nBuyer GSTIN: 29AAACB1234C1Z1\nSupplier: ABC Steel\nGSTIN: 27AAECA1234F1Z5\nInvoice No: INV-7\nInvoice Date: 01-09-2026\nItem HSN 7214 1 KGS 100 100\nTaxable Amount: 100\nGrand Total: 100`);
  assert.equal(fields.vendor.gstin, '27AAECA1234F1Z5');
  assert.equal(fields.buyer.gstin, '29AAACB1234C1Z1');
});

test('preserves Tesseract word confidence and bounding boxes in normalized layout', () => {
  const page = normalizeTesseractPage({ text: 'Invoice No INV-1', confidence: 91, blocks: [{ text: 'Invoice No INV-1', confidence: 91, bbox: { x0: 1, y0: 2, x1: 200, y1: 20 }, paragraphs: [{ text: 'Invoice No INV-1', confidence: 91, bbox: { x0: 1, y0: 2, x1: 200, y1: 20 }, lines: [{ text: 'Invoice No INV-1', confidence: 91, bbox: { x0: 1, y0: 2, x1: 200, y1: 20 }, words: [{ text: 'Invoice', confidence: 95, bbox: { x0: 1, y0: 2, x1: 50, y1: 20 } }, { text: 'INV-1', confidence: 88, bbox: { x0: 120, y0: 2, x1: 180, y1: 20 } }] }] }] }] }, 2, 600, 800);
  assert.equal(page.pageNumber, 2);
  assert.equal(page.lines[0].words[1].confidence, 0.88);
  assert.deepEqual(page.lines[0].words[1].bbox, { x0: 120, y0: 2, x1: 180, y1: 20 });
});

function word(text, x, y, width = 50) { return { text, confidence: 0.95, bbox: { x0: x, y0: y, x1: x + width, y1: y + 15 } }; }
function line(words, y) { return { text: words.map(item => item.text).join(' '), confidence: 0.95, bbox: { x0: 0, y0: y, x1: 500, y1: y + 15 }, words }; }

test('does not extract OCR item or quantity tables, including coordinate-based rows', () => {
  const page = { pageNumber: 1, width: 600, height: 800, confidence: 0.95, text: complete('Invoice No'), lines: [
    ...complete('Invoice No').split('\n').slice(0, 6).map((text, index) => line([word(text, 0, index * 20, 300)], index * 20)),
    line([word('Description', 10, 200, 80), word('HSN', 130, 200), word('Qty', 220, 200), word('UOM', 285, 200), word('Rate', 350, 200), word('Amount', 450, 200)], 200),
    line([word('NICKEL', 10, 230), word('ALLOY', 65, 230), word('7505', 130, 230), word('10', 220, 230), word('KGS', 285, 230), word('100', 350, 230), word('1000', 450, 230)], 230),
    line([word('(BLUE', 10, 250), word('ANNEALED)', 60, 250, 80)], 250),
    line([word('Grand', 10, 300), word('Total', 70, 300), word('1180', 450, 300)], 300)
  ] };
  const fields = extractInvoice({ text: page.text, confidence: 95, pages: [page] });
  assert.deepEqual(fields.items, []);
  assert.deepEqual(fields.canonical.items, []);
});

test('classifies related pages without treating every page as another invoice', () => {
  const result = classifyDocument({ pages: [
    { pageNumber: 1, text: 'TAX INVOICE Invoice No A-1 Taxable Amount Grand Total' },
    { pageNumber: 2, text: 'e-Way Bill E-Way Bill No 252210659224 Reason for Transportation' },
    { pageNumber: 3, text: 'WEIGH BRIDGE Gross Weight Tare Weight Net Weight' },
    { pageNumber: 4, text: 'MATERIAL RECEIPT NOTE MRN No 024 Challan Qty Accepted Qty' }
  ] });
  assert.equal(result.documentType, 'PURCHASE_INVOICE');
  assert.deepEqual(result.pages.map(page => page.type), ['TAX_INVOICE', 'E_WAY_BILL', 'WEIGHBRIDGE_SLIP', 'MATERIAL_RECEIPT_NOTE']);
});

test('conflicting invoice-number evidence is never silently accepted', () => {
  const fields = extractInvoice(`${complete('Invoice No')}\nInvoice Number: FF/26/DIFFERENT`);
  const validation = validateInvoice(fields, 99);
  assert.equal(validation.status, 'UNDER_REVIEW');
  assert.ok(validation.errors.some(error => error.includes('Conflicting evidence')));
});

test('financial contradictions require review while rounding differences pass', () => {
  const fields = extractInvoice(complete('Invoice No'));
  assert.equal(validateInvoice(fields, 99).status, 'EXTRACTED');
  fields.amounts.total = 1400;
  const result = validateInvoice(fields, 99);
  assert.equal(result.status, 'UNDER_REVIEW');
  assert.ok(result.errors.some(error => error.includes('does not reconcile')));
});

test('invalid GSTIN structure requires review', () => {
  const fields = extractInvoice(complete('Invoice No'));
  fields.vendor.gstin = '99ABCDE1234F1Z9';
  const result = validateInvoice(fields, 99);
  assert.equal(result.status, 'UNDER_REVIEW');
  assert.ok(result.errors.some(error => error.includes('GSTIN')));
});

test('weighbridge arithmetic is validated when all three weights are present', () => {
  const canonical = extractStructuredDocument({ text: 'WEIGH BRIDGE\nGross Weight: 10000\nTare Weight: 3000\nNet Weight: 6500', confidence: 95, pages: [{ pageNumber: 1, text: 'WEIGH BRIDGE\nGross Weight: 10000\nTare Weight: 3000\nNet Weight: 6500', confidence: 0.95, lines: [] }] });
  const result = validateInvoice({ documentType: canonical.document_type, canonical }, 95);
  assert.equal(result.status, 'UNDER_REVIEW');
  assert.ok(result.errors.some(error => error.includes('Weighbridge')));
});

test('keeps PDF and OCR resource limits configurable at practical defaults', () => {
  const { limits } = require('../lib/ocr/ocrService');
  assert.ok(limits.maxPages >= 20);
  assert.ok(limits.timeoutMs >= 90_000);
  assert.ok(limits.maxConcurrentJobs >= 1);
  assert.ok(limits.maxQueuedJobs >= 1);
});

test('MRN and goods-inward pages never produce OCR item tables', () => {
  const invoiceText = complete('Invoice No');
  const mrnText = 'MATERIAL RECEIPT NOTE\nMRN No: MRN-004\nDescription HSN Qty UOM\nSteel Bar 7214 10 KGS';
  const page = (pageNumber, text) => ({ pageNumber, text, confidence: 0.95, lines: text.split('\n').map(value => ({ text: value, confidence: 0.95, bbox: null, words: [] })) });
  const fields = extractInvoice({ text: `${invoiceText}\n\n${mrnText}`, confidence: 95, pages: [page(1, invoiceText), page(2, mrnText)] });
  const relatedMrn = fields.relatedDocuments.find(item => item.type === 'MATERIAL_RECEIPT_NOTE');
  assert.ok(relatedMrn);
  assert.equal(Object.hasOwn(relatedMrn, 'items'), false);
});

test('uses explicit invoice labels and ignores generic reference and supporting identifiers', () => {
  const base = complete('Invoice No').replace('FF/26/104', 'INV/26/0017');
  const fields = extractInvoice(`${base}\nReference No: REF-77\nPO No: PO-998711\nE-Way Bill No: 252210659224\nAck No: 122633278943121\nVehicle No: MH08H1399\nGSTIN: 27AAECA1234F1Z5`);
  assert.equal(fields.invoiceNumber, 'INV/26/0017');
});

test('does not promote generic reference, PO, e-way, or acknowledgement numbers to invoice number', () => {
  for (const text of ['Reference No: REF-77', 'PO No: PO-998711', 'E-Way Bill No: 252210659224', 'Ack No: 122633278943121']) {
    assert.equal(extractInvoice(`TAX INVOICE\n${text}`).invoiceNumber, null, text);
  }
});

test('accepts punctuation variants and invoice numbers beginning with zero', () => {
  for (const [label, value] of [['Invoice No :', '001/2026-27'], ['Invoice No.', 'A-123'], ['Invoice #', 'INV/008'], ['Inv.No:', 'XY-7']]) {
    assert.equal(extractInvoice(`TAX INVOICE\n${label} ${value}`).invoiceNumber, value);
  }
});

test('reads a value immediately below an exact invoice-number label', () => {
  const text = `TAX INVOICE\nInvoice No\nINV-2026-0008\nInvoice Date: 21/09/2026`;
  assert.equal(extractInvoice(text).invoiceNumber, 'INV-2026-0008');
});

test('does not use Document No from e-way or MRN supporting pages as the invoice number', () => {
  for (const text of ['E-Way Bill\nDocument No: EWB-22', 'MATERIAL RECEIPT NOTE\nDocument No: MRN-22']) {
    const fields = extractInvoice(text);
    assert.equal(fields.invoiceNumber, null, text);
  }
});

test('extracts a value to the right of its invoice label using bounding boxes', () => {
  const text = `TAX INVOICE\nInvoice No\nInvoice Date: 21/09/2026\nSupplier: ABC Steel Industries\nTaxable Amount: 100\nGrand Total: 100`;
  const lines = text.split('\n').map((value, index) => line([word(value, 0, index * 25, 280)], index * 25));
  const label = line([word('Invoice', 10, 25), word('No', 75, 25)], 25);
  const rightValue = line([word('0007/26-A', 170, 25, 100)], 25);
  const page = { pageNumber: 1, text: `${text}\n0007/26-A`, confidence: 0.95, lines: [lines[0], label, lines[2], rightValue, ...lines.slice(3)] };
  const fields = extractInvoice({ text: page.text, confidence: 95, pages: [page] });
  assert.equal(fields.invoiceNumber, '0007/26-A');
  assert.equal(fields.fieldEvidence['invoice.number'].relationship, 'spatial_right');
});

test('low OCR confidence on the invoice value lowers its field confidence', () => {
  const reliable = extractInvoice(complete('Invoice No'));
  const text = complete('Invoice No');
  const lines = text.split('\n').map((value, index) => ({ text: value, confidence: value.startsWith('Invoice No') ? 0.2 : 0.98, bbox: null, words: [] }));
  const uncertain = extractInvoice({ text, confidence: 95, pages: [{ pageNumber: 1, text, confidence: 0.98, lines }] });
  assert.ok(uncertain.fieldEvidence['invoice.number'].confidence < reliable.fieldEvidence['invoice.number'].confidence);
});

test('uses a matching e-invoice Document No as corroboration and flags disagreement', () => {
  const tax = `TAX INVOICE\nInvoice No: INV/26/0017\nInvoice Date: 12/09/2026\nSupplier: ABC Steel Industries\nTaxable Amount: 100\nGrand Total: 100`;
  const report = (number, pageNumber) => ({ pageNumber, text: `E-Invoice Report\nDocument No: ${number}\nAck No: 122633278943121`, confidence: 0.98, lines: `E-Invoice Report\nDocument No: ${number}\nAck No: 122633278943121`.split('\n').map(text => ({ text, confidence: 0.98, bbox: null, words: [] })) });
  const invoicePage = { pageNumber: 1, text: tax, confidence: 0.98, lines: tax.split('\n').map(text => ({ text, confidence: 0.98, bbox: null, words: [] })) };
  const matching = extractInvoice({ text: `${tax}\n\nE-Invoice Report\nDocument No: INV/26/0017`, confidence: 98, pages: [invoicePage, report('INV/26/0017', 2)] });
  assert.equal(matching.invoiceNumber, 'INV/26/0017');
  assert.ok(matching.fieldEvidence['invoice.number'].confidence > 0.9);
  const conflict = extractInvoice({ text: `${tax}\n\nE-Invoice Report\nDocument No: WRONG-8`, confidence: 98, pages: [invoicePage, report('WRONG-8', 2)] });
  assert.equal(conflict.invoiceNumber, 'INV/26/0017');
  assert.ok(conflict.conflicts.some(item => item.field === 'invoice.number'));
  assert.equal(validateInvoice(conflict, 98).status, 'UNDER_REVIEW');
});

test('confidence is finite, normalized, penalizes missing critical evidence, and keeps empty OCR items neutral', () => {
  const good = extractInvoice(complete('Invoice No'));
  const goodScore = validateInvoice(good, 98).confidence;
  const lowOcr = validateInvoice(good, 20).confidence;
  const missing = validateInvoice(extractInvoice('TAX INVOICE\nGrand Total: 100'), 98).confidence;
  for (const score of [goodScore, lowOcr, missing]) assert.ok(Number.isFinite(score) && score >= 0 && score <= 1);
  assert.ok(goodScore > lowOcr);
  assert.ok(goodScore > missing);
});

test('document review UI has no OCR line-item table or JSON editor', () => {
  const source = require('node:fs').readFileSync(require('node:path').resolve(__dirname, '../../app/documents.js'), 'utf8');
  assert.doesNotMatch(source, /Line items|Edit line items|name="items"/i);
  assert.match(source, /confidenceLabel/);
});
