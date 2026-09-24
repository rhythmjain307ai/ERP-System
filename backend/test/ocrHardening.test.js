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

test('reconstructs a coordinate-based table and joins a multi-line description', () => {
  const page = { pageNumber: 1, width: 600, height: 800, confidence: 0.95, text: complete('Invoice No'), lines: [
    ...complete('Invoice No').split('\n').slice(0, 6).map((text, index) => line([word(text, 0, index * 20, 300)], index * 20)),
    line([word('Description', 10, 200, 80), word('HSN', 130, 200), word('Qty', 220, 200), word('UOM', 285, 200), word('Rate', 350, 200), word('Amount', 450, 200)], 200),
    line([word('NICKEL', 10, 230), word('ALLOY', 65, 230), word('7505', 130, 230), word('10', 220, 230), word('KGS', 285, 230), word('100', 350, 230), word('1000', 450, 230)], 230),
    line([word('(BLUE', 10, 250), word('ANNEALED)', 60, 250, 80)], 250),
    line([word('Grand', 10, 300), word('Total', 70, 300), word('1180', 450, 300)], 300)
  ] };
  const fields = extractInvoice({ text: page.text, confidence: 95, pages: [page] });
  assert.equal(fields.items.length, 1);
  assert.match(fields.items[0].description, /NICKEL ALLOY.*BLUE ANNEALED/);
  assert.equal(fields.items[0].hsnSac, '7505');
  assert.equal(fields.items[0].quantity, 10);
  assert.equal(fields.items[0].unitPrice, 100);
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
