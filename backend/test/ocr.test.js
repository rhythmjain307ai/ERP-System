const test = require('node:test');
const assert = require('node:assert/strict');
const { extractInvoice } = require('../lib/ocr/invoiceExtractor');
const { validateInvoice } = require('../lib/ocr/invoiceValidator');

const invoiceText = `TAX INVOICE
Supplier: ABC Steel Industries
GSTIN: 27AAECA1234F1Z5
Invoice No: INV-10452
Invoice Date: 21/09/2026
Steel bar HSN: 7214 100 KG 850.00 85000.00
Taxable Amount: 85000.00
CGST: 7650.00
SGST: 7650.00
Grand Total: 100300.00`;

test('extracts common Indian invoice fields from OCR text', () => {
  const invoice = extractInvoice(invoiceText);
  assert.equal(invoice.invoiceNumber, 'INV-10452');
  assert.equal(invoice.invoiceDate, '2026-09-21');
  assert.equal(invoice.vendor.gstin, '27AAECA1234F1Z5');
  assert.equal(invoice.amounts.total, 100300);
  assert.equal(invoice.items.length, 1);
});

test('marks incomplete extraction as needing review', () => {
  const result = validateInvoice(extractInvoice('unreadable scan'), 10);
  assert.equal(result.status, 'NEEDS_REVIEW');
  assert.ok(result.errors.some((error) => error.includes('Invoice number')));
});

test('marks a supported complete invoice as processed when OCR is confident', () => {
  const result = validateInvoice(extractInvoice(invoiceText), 99);
  assert.equal(result.errors.length, 0);
  assert.equal(result.status, 'PROCESSED');
});
