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
function report(name, query = {}) { return request(app).get('/api/procurement/reports/' + name).set('Authorization', context.auth).query({ company_id: context.companyId, ...query }); }
test('outstanding, aging, vendor ledger, trial balance and general ledger reconcile to partial allocation', { skip: !integration }, async () => {
  const { ap } = await booked(context, '100.15'); const payment = await pay(context, ap, '40.10'); await allocate(context, payment, ap, '40.10');
  const outstanding = await report('vendor-outstanding'); assert.equal(outstanding.status, 200);
  assert.equal(outstanding.body.data.total_outstanding, '60.05'); assert.equal(outstanding.body.data.entries[0].paid_amount, '40.1');
  const aging = await report('accounts-payable-aging'); assert.equal(aging.body.data.total_outstanding, '60.05');
  const ledger = await report('vendors/' + context.vendorId + '/ledger'); assert.equal(ledger.body.data.closing_balance, '60.05');
  const trial = await report('trial-balance'); assert.equal(trial.status, 200); assert.equal(trial.body.data.balanced, true);
  assert.equal(trial.body.data.totals.debits, '140.25'); assert.equal(trial.body.data.totals.credits, '140.25');
  const payable = trial.body.data.entries.find(e => e.account_id === String(context.financeFields.payable_account_id));
  assert.equal(payable.closing_credit, '60.05');
  const gl = await report('general-ledger', { account_id: String(context.financeFields.payable_account_id), from: '2026-09-02' });
  assert.equal(gl.status, 200); assert.equal(gl.body.data.accounts[0].opening_balance, '-100.15');
  assert.equal(gl.body.data.accounts[0].entries[0].running_balance, '-60.05');
  assert.equal(gl.body.data.accounts[0].closing_balance, '-60.05');
  const period = await report('trial-balance', { from: '2026-09-02' });
  assert.equal(period.body.data.totals.debits, '40.1'); assert.equal(period.body.data.totals.credits, '40.1');
});
test('purchase and GST registers preserve components and exclude drafts', { skip: !integration }, async () => {
  const response = await post(context, 'vendor-invoices', { vendor_id: context.vendorId, invoice_number: 'REPORT-TAX', invoice_date: '2026-09-01', due_date: '2099-01-01',
    items: [{ inventory_item_id: context.inventoryItemId, uom: 'EA', quantity: 1, rate: '100', gst_rate: 18 }] });
  assert.equal(response.status, 201);
  const id = BigInt(response.body.data.vendor_invoice_id); context.created.vendorInvoiceIds.push(id);
  assert.equal((await report('purchase-register')).body.data.entries.length, 0);
  assert.equal((await post(context, 'vendor-invoices/' + id + '/book')).status, 200);
  for (const name of ['purchase-register', 'gst-purchase-register']) {
    const result = await report(name, { from: '2026-09-01', to: '2026-09-01' });
    assert.equal(result.status, 200); assert.equal(result.body.data.entries.length, 1);
    assert.equal(result.body.data.totals.taxable_amount, '100'); assert.equal(result.body.data.totals.cgst_amount, '9');
    assert.equal(result.body.data.totals.sgst_amount, '9'); assert.equal(result.body.data.totals.total_amount, '118');
  }
});
test('reversals net reports to zero while historical reports keep original postings', { skip: !integration }, async () => {
  const { invoice, ap } = await booked(context); const payment = await pay(context, ap); await allocate(context, payment, ap);
  assert.equal((await report('cash-flow-impact')).body.data.net_cash_flow, '-100');
  assert.equal((await post(context, 'payments/' + payment.payment_id + '/reverse', { reason: 'Report correction' })).status, 200);
  assert.equal((await post(context, 'vendor-invoices/' + invoice.vendor_invoice_id + '/reverse', { reason: 'Report correction' })).status, 200);
  const cash = await report('cash-flow-impact');
  assert.equal(cash.body.data.total_inflow, '100'); assert.equal(cash.body.data.total_outflow, '100'); assert.equal(cash.body.data.net_cash_flow, '0');
  const register = await report('purchase-register'); assert.equal(register.body.data.totals.total_amount, '0');
  assert.deepEqual(register.body.data.entries.map(e => e.type), ['INVOICE', 'REVERSAL']);
  assert.equal((await report('purchase-register', { to: '2026-09-01' })).body.data.totals.total_amount, '100');
  const trial = await report('trial-balance'); assert.equal(trial.body.data.balanced, true);
  assert.ok(trial.body.data.entries.every(e => e.closing_balance === '0'));
  assert.equal((await report('vendor-outstanding')).body.data.total_outstanding, '0');
  const historical = await report('trial-balance', { to: '2026-09-01' });
  assert.equal(historical.body.data.totals.closing_debit, '100'); assert.equal(historical.body.data.totals.closing_credit, '100');
});
test('cash impact excludes unallocated payments and reports do not write financial state', { skip: !integration }, async () => {
  const { ap } = await booked(context); await pay(context, ap);
  const before = await prisma.audit_log.count({ where: { user_id: BigInt(context.userId) } });
  const result = await report('cash-flow-impact'); assert.equal(result.status, 200);
  assert.equal(result.body.data.net_cash_flow, '0'); assert.deepEqual(result.body.data.entries, []);
  for (const name of ['purchase-register', 'gst-purchase-register', 'trial-balance', 'general-ledger', 'vendor-outstanding', 'accounts-payable-aging']) assert.equal((await report(name)).status, 200);
  assert.equal(await prisma.audit_log.count({ where: { user_id: BigInt(context.userId) } }), before);
  assert.equal((await prisma.accounts_payable.findUnique({ where: { accounts_payable_id: ap.accounts_payable_id } })).paid_amount.toString(), '0');
});
test('reports isolate companies and validate dates, accounts and current-only filters', { skip: !integration }, async () => {
  await booked(context);
  const other = await setup();
  try {
    for (const name of ['purchase-register', 'trial-balance', 'general-ledger', 'vendor-outstanding', 'cash-flow-impact', 'accounts-payable-aging']) {
      const response = await report(name, { company_id: other.companyId }); assert.equal(response.status, 403);
    }
    assert.equal((await report('general-ledger', { company_id: other.companyId, account_id: String(other.financeFields.cash_account_id) })).status, 403);
  } finally { await other.cleanup(); }
  assert.equal((await report('trial-balance', { company_id: '999999999' })).status, 403);
  assert.equal((await report('trial-balance', { company_id: 'bad' })).status, 400);
  assert.equal((await report('trial-balance', { from: '2026-10-01', to: '2026-09-01' })).status, 400);
  assert.equal((await report('purchase-register', { from: '2026-02-30' })).status, 400);
  assert.equal((await report('vendor-outstanding', { as_of: '2026-09-01' })).status, 400);
  assert.equal((await request(app).get('/api/procurement/reports/trial-balance').query({ company_id: context.companyId })).status, 401);
});
