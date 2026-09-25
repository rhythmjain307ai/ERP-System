const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../app');
const prisma = require('../lib/prisma');
const setup = require('./setup');
const { post, booked, pay, allocate } = require('./financeFixtures');
const integration = Boolean(process.env.TEST_DATABASE_URL);
let context;
test.beforeEach(async () => { context = await setup(); });
test.afterEach(async () => { if (context) await context.cleanup(); });
test.after(async () => { await prisma.$disconnect(); });
function ledger(query = {}, route = 'ledger', vendorId = context.vendorId) { return request(app).get(`/api/procurement/vendors/${vendorId}/${route}`).set('Authorization', context.auth).query(query); }
test('vendor statement computes opening, ordered running balances and closing exactly', { skip: !integration }, async () => {
  const { ap } = await booked(context, '100.15');
  const payment = await pay(context, ap, '40.10'); await allocate(context, payment, ap, '40.10');
  const all = await ledger();
  assert.equal(all.status, 200);
  assert.equal(all.body.data.opening_balance, '0');
  assert.deepEqual(all.body.data.entries.map(e => e.running_balance), ['100.15', '60.05']);
  assert.equal(all.body.data.closing_balance, '60.05');
  const range = await ledger({ from: '2026-09-02' }, 'statement');
  assert.equal(range.body.data.opening_balance, '100.15');
  assert.equal(range.body.data.entries.length, 1);
  assert.equal(range.body.data.closing_balance, '60.05');
});
test('reversals appear as adjustments without erasing historical balances', { skip: !integration }, async () => {
  const { invoice, ap } = await booked(context);
  const payment = await pay(context, ap); await allocate(context, payment, ap);
  await post(context, `payments/${payment.payment_id}/reverse`, { reason: 'Correction' });
  await post(context, `vendor-invoices/${invoice.vendor_invoice_id}/reverse`, { reason: 'Correction' });
  const response = await ledger();
  assert.equal(response.body.data.closing_balance, '0');
  assert.deepEqual(response.body.data.entries.map(e => e.type), ['INVOICE', 'PAYMENT', 'ADJUSTMENT', 'ADJUSTMENT']);
  const historical = await ledger({ to: '2026-09-01' });
  assert.equal(historical.body.data.closing_balance, '100');
});
test('ledger isolates vendors, validates range and reports absent vendor', { skip: !integration }, async () => {
  await booked(context);
  const empty = await ledger({}, 'statement', context.otherVendorId);
  assert.equal(empty.body.data.closing_balance, '0'); assert.deepEqual(empty.body.data.entries, []);
  assert.equal((await ledger({ from: '2026-10-01', to: '2026-09-01' })).status, 400);
  assert.equal((await ledger({ from: '2026-02-30' })).status, 400);
  assert.equal((await ledger({}, 'ledger', '999999999')).status, 404);
});
