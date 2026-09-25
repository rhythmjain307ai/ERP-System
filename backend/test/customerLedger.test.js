const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../app');
const prisma = require('../lib/prisma');
const setup = require('./setup');

const integration = Boolean(process.env.TEST_DATABASE_URL);
let context;
test.beforeEach(async () => { context = await setup(); });
test.afterEach(async () => { if (context) await context.cleanup(); });
test.after(async () => { await prisma.$disconnect(); });
function post(path, body = {}) { return request(app).post(`/api/sales/${path}`).set('Authorization', context.auth).send(body); }
function ledger(customerId = context.customerId, query = {}, route = 'ledger') { return request(app).get(`/api/sales/customers/${customerId}/${route}`).query(query).set('Authorization', context.auth); }
async function invoice(amount = '100', customerId = context.customerId, date = '2026-09-01') {
  const created = await post('invoices', { invoice_number: `LEDGER-INV-${Date.now()}-${Math.random()}`, invoice_type: 'SERVICE_INVOICE', customer_id: customerId,
    invoice_date: date, items: [{ inventory_item_id: context.inventoryItemId, description: 'Service', uom: 'EA', quantity: '1', unit_price: amount, gst_rate: '0' }] });
  assert.equal(created.status, 201); const id = created.body.data.sales_invoice_id; context.created.invoiceIds.push(BigInt(id));
  assert.equal((await post(`invoices/${id}/issue`)).status, 200);
  return prisma.accounts_receivable.findUnique({ where: { sales_invoice_id: BigInt(id) } });
}
async function payment(amount = '40', customerId = context.customerId) {
  const response = await post('payments', { customer_id: customerId, payment_type: 'CUSTOMER_RECEIPT', payment_date: '2026-09-25', mode: 'CASH', amount, reference_number: `RCPT-${Math.random()}` });
  assert.equal(response.status, 201); return response.body.data;
}

test('customer ledger computes ordered running balances and reconciles to AR', { skip: !integration }, async () => {
  const ar = await invoice(), receipt = await payment();
  assert.equal((await post(`payments/${receipt.payment_id}/allocations`, { allocations: [{ accounts_receivable_id: ar.accounts_receivable_id.toString(), allocated_amount: '40' }] })).status, 201);
  const response = await ledger();
  assert.equal(response.status, 200); assert.equal(response.body.data.opening_balance, '0');
  assert.deepEqual(response.body.data.entries.map(row => row.type), ['SALES_INVOICE', 'PAYMENT_ALLOCATION']);
  assert.deepEqual(response.body.data.entries.map(row => row.running_balance), ['100', '60']);
  assert.equal(response.body.data.closing_balance, '60'); assert.equal(response.body.data.current_ar_outstanding, '60'); assert.equal(response.body.data.reconciles_to_current_ar, true);
  assert.equal(response.body.data.entries[1].payment_id, receipt.payment_id);
});
test('date-range statement carries opening balance and exposes allocated payment references', { skip: !integration }, async () => {
  const ar = await invoice(), receipt = await payment();
  await post(`payments/${receipt.payment_id}/allocations`, { allocations: [{ accounts_receivable_id: ar.accounts_receivable_id.toString(), allocated_amount: '40' }] });
  const response = await ledger(context.customerId, { from: '2026-09-25' }, 'statement');
  assert.equal(response.status, 200); assert.equal(response.body.data.opening_balance, '100'); assert.equal(response.body.data.entries.length, 1);
  assert.equal(response.body.data.entries[0].credit_amount, '40'); assert.equal(response.body.data.closing_balance, '60');
});

test('unallocated receipts are disclosed without reducing AR balance', { skip: !integration }, async () => {
  await invoice(); const receipt = await payment('25');
  const response = await ledger();
  assert.equal(response.body.data.closing_balance, '100'); assert.equal(response.body.data.current_ar_outstanding, '100');
  assert.equal(response.body.data.unallocated_receipts_total, '25'); assert.equal(response.body.data.unallocated_receipts[0].payment_id, receipt.payment_id);
});

test('ledger isolates customers and validates dates and missing customers', { skip: !integration }, async () => {
  await invoice();
  const other = await ledger(context.otherCustomerId); assert.equal(other.status, 200); assert.deepEqual(other.body.data.entries, []); assert.equal(other.body.data.closing_balance, '0');
  assert.equal((await ledger(context.customerId, { from: '2026-10-01', to: '2026-09-01' })).status, 400);
  assert.equal((await ledger(context.customerId, { from: '2026-02-30' })).status, 400);
  assert.equal((await ledger('999999999999')).status, 404);
});
