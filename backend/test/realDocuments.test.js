const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { extractText } = require('../lib/ocr/ocrService');
const { extractInvoice } = require('../lib/ocr/invoiceExtractor');
const { validateInvoice } = require('../lib/ocr/invoiceValidator');

const corpus = [
  { key: 'j26', file: 'HMFL_30_J_26 slaes 2.pdf', sha256: '96dc932dc07df09a7c365c325aa742acdce771efa44508ad01faf5cb23743589' },
  { key: 'd48', file: 'HMFL_30_D_48 Sales 2.pdf', sha256: 'b0d7cea89f5a2ffefd35d59e448d451aed63138b5f97611988235285ac91a2a7' },
  { key: 's05', file: 'HMFL_30_S_05.pdf', sha256: 'e9fea4c28d2ad18b330e01572ef2aade8d2103c44c4e5e7a8d509781060480f6' },
  { key: 'sto97', file: 'STO_30_MAY_97 2.pdf', sha256: 'cdf6ca2033d4a890651c88d202501947cf7cc983681675beab29820372caff15' },
  { key: 'rm24d', file: 'HMFL_RM_24_D 2.pdf', sha256: 'c6e73e978fe77ffc91c15926cb6a1ce696861490e7ca439160c407f2609bfd1a' }
];

test('real mixed-document corpus extracts supported facts and routes uncertainty to review', { timeout: 10 * 60_000 }, async t => {
  const directory = process.env.OCR_REAL_FIXTURES_DIR;
  if (!directory) return t.skip('Set OCR_REAL_FIXTURES_DIR to the directory containing the five private regression PDFs.');
  const results = {};
  for (const fixture of corpus) {
    const filePath = path.join(directory, fixture.file);
    const bytes = await fs.readFile(filePath);
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), fixture.sha256, `${fixture.file} does not match the reviewed regression fixture`);
    const ocr = await extractText(filePath, 'application/pdf');
    assert.ok(ocr.pages.length >= 4);
    assert.ok(ocr.pages.every(page => page.pageNumber && Array.isArray(page.lines)));
    assert.ok(ocr.pages.some(page => page.lines.some(line => line.words.some(word => word.bbox && Number.isFinite(word.confidence)))), 'OCR must retain word geometry and confidence');
    const fields = extractInvoice(ocr);
    const validation = validateInvoice(fields, ocr.confidence);
    assert.equal(validation.status, 'UNDER_REVIEW', `${fixture.file} contains scan ambiguity and must not auto-post`);
    results[fixture.key] = { fields, validation };
  }

  const j26 = results.j26.fields;
  assert.equal(j26.invoiceDate, '2026-05-24');
  assert.equal(j26.amounts.total, 547849);
  assert.equal(j26.items[0].hsnSac, '73072100');
  assert.equal(j26.items[0].quantity, 189);
  assert.equal(j26.items[0].unitPrice, 2456.5);
  assert.equal(j26.logistics.vehicle_number, 'MH46AF9531');
  assert.ok(results.j26.validation.errors.some(error => /different invoice|does not reconcile/i.test(error)));

  const d48 = results.d48.fields;
  assert.equal(d48.invoiceNumber, 'HMFL/30/D/048');
  assert.equal(d48.invoiceDate, '2026-05-27');
  assert.equal(d48.logistics.eway_bill_number, '252210659224');
  assert.equal(d48.amounts.total, 3186531);
  assert.deepEqual([d48.items[0].hsnSac, d48.items[0].quantity, d48.items[0].unitPrice, d48.items[0].lineTotal], ['75051220', 765, 3530, 2700450]);

  const s05 = results.s05.fields;
  assert.equal(s05.invoiceNumber, 'HMFL/30/S/005');
  assert.equal(s05.invoiceDate, '2026-05-09');
  assert.equal(s05.logistics.eway_bill_number, '202198681948');
  assert.equal(s05.amounts.total, 985929);
  assert.deepEqual(s05.items.map(item => [item.hsnSac, item.quantity, item.unitPrice, item.lineTotal]), [['72042190', 5385, 110, 592350], ['72042190', 1890, 120, 226800]]);

  const sto = results.sto97.fields;
  assert.equal(sto.invoiceNumber, 'JPCI26-27/041');
  assert.equal(sto.invoiceDate, '2026-05-28');
  assert.ok(sto.canonical.pages.some(page => page.type === 'MATERIAL_RECEIPT_NOTE'));
  assert.equal(sto.amounts.total, null, 'unreliable financial total must remain null');

  const rm24d = results.rm24d.fields;
  assert.equal(rm24d.invoiceNumber, 'S126Y-00817');
  assert.equal(rm24d.invoiceDate, '2026-05-30');
  assert.equal(rm24d.logistics.eway_bill_number, '282212961759');
  assert.equal(rm24d.logistics.vehicle_number, 'MH08H1399');
  assert.deepEqual([rm24d.items[0].hsnSac, rm24d.items[0].quantity, rm24d.items[0].unitPrice], ['75051220', 2430, 3460]);
  const goodsInward = rm24d.relatedDocuments.find(document => document.type === 'GOODS_INWARD_REPORT');
  assert.deepEqual(goodsInward.items.slice(0, 4).map(item => item.received_quantity), [2430, 2390, 2400, 1510]);
});
