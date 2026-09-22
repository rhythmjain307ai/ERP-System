const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
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

test('normalizes snake_case and camelCase invoice fields without losing extracted data', () => {
  const invoice = extractInvoice(invoiceText);
  assert.equal(invoice.invoiceNumber, 'INV-10452');
  assert.equal(invoice.invoice_number, 'INV-10452');
  assert.equal(invoice.vendor.gstin, '27AAECA1234F1Z5');
  assert.equal(invoice.vendor_gstin, '27AAECA1234F1Z5');
  assert.equal(invoice.amounts.total, 100300);
  assert.equal(invoice.total, 100300);
});

test('marks incomplete extraction as needing review', () => {
  const result = validateInvoice(extractInvoice('unreadable scan'), 10);
  assert.equal(result.status, 'UNDER_REVIEW');
  assert.ok(result.errors.some((error) => error.includes('Invoice number')));
});

test('marks a supported complete invoice as processed when OCR is confident', () => {
  const result = validateInvoice(extractInvoice(invoiceText), 99);
  assert.equal(result.errors.length, 0);
  assert.equal(result.status, 'EXTRACTED');
});

test('frontend summary renders a successful OCR extraction', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../app/app.js'), 'utf8');
  const elements = {};
  const makeElement = (id = '') => ({
    id,
    hidden: false,
    value: '',
    textContent: '',
    innerHTML: '',
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {},
    querySelectorAll() { return []; },
    querySelector() { return null; },
    onclick: null
  });
  const document = {
    getElementById: (id) => {
      if (!elements[id]) elements[id] = makeElement(id);
      return elements[id];
    },
    querySelectorAll() { return []; },
    querySelector() { return null; }
  };
  const context = {
    document,
    window: { setTimeout: () => 0, clearTimeout: () => {}, ERP_AUTH_TOKEN: '' },
    localStorage: { getItem: () => '', setItem() {} },
    URL: { createObjectURL: () => 'blob://mock', revokeObjectURL() {} },
    fetch: async () => ({ ok: true, headers: { get: () => 'application/json' }, json: async () => ({ success: true }) }),
    console,
    Intl,
    setTimeout: () => 0,
    clearTimeout: () => {}
  };
  vm.createContext(context);
  vm.runInContext(source, context);

  const markup = context.documentSummary({
    document_id: 42,
    document_type: 'PURCHASE_INVOICE',
    metadata: { originalFileName: 'invoice-10452.png' },
    invoice_extraction_review: {
      extraction_status: 'PROCESSED',
      confidence_score: 0.96,
      extracted_fields: {
        invoiceNumber: 'INV-10452',
        vendor: { name: 'Bharat Steel Industries' },
        amounts: { total: 1180 }
      }
    }
  });

  assert.match(markup, /INV-10452/);
  assert.match(markup, /Bharat Steel Industries/);
  assert.match(markup, /₹/);
});
