const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { extractText } = require('../lib/ocr/ocrService');
const { extractInvoice } = require('../lib/ocr/invoiceExtractor');
const { sameInvoice } = require('../lib/ocr/documentProcessor');
const { pdf, invoiceText } = require('./invoiceFixtures');
test('digital PDF extracts text and camelCase invoice fields with real PDF engine', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'erp-pdf-'));
  const file = path.join(dir, 'bill.pdf');
  try {
    await fs.writeFile(file, pdf(invoiceText('INV-PDF-101')));
    const result = await extractText(file, 'application/pdf');
    assert.equal(result.engine, 'pdf-parse');
    const fields = extractInvoice(result.text);
    assert.equal(fields.invoiceNumber, 'INV-PDF-101');
    assert.equal(fields.amounts.total, 100300);
    assert.equal(fields.amounts.cgst, 7650);
    assert.equal(fields.items[0].unitPrice, 850);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
test('duplicate comparison uses GSTIN or normalized vendor plus number and total', () => {
  const a = extractInvoice(invoiceText('INV-101'));
  assert.equal(sameInvoice(a, { ...a, vendor: { name: 'Different OCR spelling', gstin: a.vendor.gstin } }), true);
  assert.equal(sameInvoice(a, { ...a, invoiceNumber: 'INV-102' }), false);
});
test('tax percentages are not tax amounts and ungrouped large totals stay intact', () => {
  const fields = extractInvoice(invoiceText('INV-2026/001'));
  assert.equal(fields.amounts.cgst, 7650);
  assert.equal(fields.items[0].lineTotal, 85000);
  assert.equal(fields.vendor.pan, 'AAECA1234F');
});
