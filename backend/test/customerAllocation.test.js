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

async function receivable(amount = '100', customerId = context.customerId) {
  const invoice = await post('invoices', { invoice_number: `ALLOC-INV-${Date.now()}-${Math.random()}`, invoice_type: 'SERVICE_INVOICE', customer_id: customerId,
    invoice_date: '2026-09-25', items: [{ inventory_item_id: context.inventoryItemId, description: 'Service', uom: 'EA', quantity: '1', unit_price: amount, gst_rate: '0' }] });
  assert.equal(invoice.status, 201); const invoiceId = invoice.body.data.sales_invoice_id; context.created.invoiceIds.push(BigInt(invoiceId));
  assert.equal((await post(`invoices/${invoiceId}/issue`)).status, 200);
  const ar = await prisma.accounts_receivable.findUnique({ where: { sales_invoice_id: BigInt(invoiceId) } });
  return { id: ar.accounts_receivable_id.toString(), invoiceId };
}

async function receipt(amount = '100', customerId = context.customerId) {
  const response = await post('payments', { customer_id: customerId, payment_type: 'CUSTOMER_RECEIPT', payment_date: '2026-09-25', mode: 'CASH', amount });
  assert.equal(response.status, 201); return response.body.data.payment_id;
}

async function allocate(paymentId, allocations) { return post(`payments/${paymentId}/allocations`, { allocations }); }

test('full allocation marks AR and invoice PAID', { skip: !integration }, async () => {
  const ar = await receivable(), payment = await receipt();
  const response = await allocate(payment, [{ accounts_receivable_id: ar.id, allocated_amount: '100' }]);
  assert.equal(response.status, 201); assert.equal(response.body.data.unallocated_amount, '0');
  const stored = await prisma.accounts_receivable.findUnique({ where: { accounts_receivable_id: BigInt(ar.id) } });
  assert.equal(stored.received_amount.toString(), '100'); assert.equal(stored.outstanding_amount.toString(), '0'); assert.equal(stored.status, 'PAID');
  assert.equal((await prisma.sales_invoice.findUnique({ where: { sales_invoice_id: BigInt(ar.invoiceId) } })).status, 'PAID');
});
test('partial allocation updates exact balances and PARTIALLY_PAID status', { skip: !integration }, async () => {
  const ar = await receivable(), payment = await receipt('40');
  assert.equal((await allocate(payment, [{ accounts_receivable_id: ar.id, allocated_amount: '40' }])).status, 201);
  const stored = await prisma.accounts_receivable.findUnique({ where: { accounts_receivable_id: BigInt(ar.id) } });
  assert.equal(stored.received_amount.toString(), '40'); assert.equal(stored.outstanding_amount.toString(), '60'); assert.equal(stored.status, 'PARTIALLY_PAID');
  assert.equal((await prisma.sales_invoice.findUnique({ where: { sales_invoice_id: BigInt(ar.invoiceId) } })).status, 'PARTIALLY_PAID');
});

test('one payment can settle multiple AR records atomically', { skip: !integration }, async () => {
  const first = await receivable('40'), second = await receivable('60'), payment = await receipt('100');
  const response = await allocate(payment, [{ accounts_receivable_id: second.id, allocated_amount: '60' }, { accounts_receivable_id: first.id, allocated_amount: '40' }]);
  assert.equal(response.status, 201); assert.equal(response.body.data.allocations.length, 2);
  assert.equal(await prisma.accounts_receivable.count({ where: { accounts_receivable_id: { in: [BigInt(first.id), BigInt(second.id)] }, status: 'PAID' } }), 2);
});

test('one AR can be settled by multiple payments', { skip: !integration }, async () => {
  const ar = await receivable(), first = await receipt('30'), second = await receipt('70');
  assert.equal((await allocate(first, [{ accounts_receivable_id: ar.id, allocated_amount: '30' }])).status, 201);
  assert.equal((await allocate(second, [{ accounts_receivable_id: ar.id, allocated_amount: '70' }])).status, 201);
  const stored = await prisma.accounts_receivable.findUnique({ where: { accounts_receivable_id: BigInt(ar.id) } });
  assert.equal(stored.received_amount.toString(), '100'); assert.equal(stored.status, 'PAID');
});

test('rejects payment and AR over-allocation, wrong customer, duplicate target, and AP target', { skip: !integration }, async () => {
  const ar = await receivable(), small = await receipt('50'), large = await receipt('200');
  assert.equal((await allocate(small, [{ accounts_receivable_id: ar.id, allocated_amount: '51' }])).status, 409);
  assert.equal((await allocate(large, [{ accounts_receivable_id: ar.id, allocated_amount: '101' }])).status, 409);
  assert.equal((await allocate(large, [{ accounts_receivable_id: ar.id, allocated_amount: '1' }, { accounts_receivable_id: ar.id, allocated_amount: '1' }])).status, 400);
  assert.equal((await allocate(large, [{ accounts_payable_id: '1', allocated_amount: '1' }])).status, 400);
  const other = await receivable('10', context.otherCustomerId);
  assert.equal((await allocate(large, [{ accounts_receivable_id: other.id, allocated_amount: '10' }])).status, 400);
});

test('concurrent payments cannot drive AR outstanding below zero', { skip: !integration }, async () => {
  const ar = await receivable(), first = await receipt('70'), second = await receipt('70');
  const results = await Promise.all([allocate(first, [{ accounts_receivable_id: ar.id, allocated_amount: '70' }]), allocate(second, [{ accounts_receivable_id: ar.id, allocated_amount: '70' }])]);
  assert.deepEqual(results.map(row => row.status).sort(), [201, 409]);
  const stored = await prisma.accounts_receivable.findUnique({ where: { accounts_receivable_id: BigInt(ar.id) } });
  assert.equal(stored.received_amount.toString(), '70'); assert.equal(stored.outstanding_amount.toString(), '30');
  assert.equal(await prisma.payment_allocation.count({ where: { accounts_receivable_id: BigInt(ar.id), reversed_at: null } }), 1);
});

test('allocation audit failure rolls back allocation, AR, and invoice status', { skip: !integration }, async () => {
  const ar = await receivable(), payment = await receipt('25');
  const original = prisma.$transaction, run = original.bind(prisma);
  prisma.$transaction = callback => run(tx => callback(new Proxy(tx, { get(target, key) {
    if (key === 'audit_log') return { create: async () => { throw new Error('Injected allocation audit failure'); } };
    return target[key];
  } })));
  try { assert.equal((await allocate(payment, [{ accounts_receivable_id: ar.id, allocated_amount: '25' }])).status, 500); } finally { prisma.$transaction = original; }
  const stored = await prisma.accounts_receivable.findUnique({ where: { accounts_receivable_id: BigInt(ar.id) } });
  assert.equal(stored.received_amount.toString(), '0'); assert.equal(stored.outstanding_amount.toString(), '100'); assert.equal(stored.status, 'OPEN');
  assert.equal((await prisma.sales_invoice.findUnique({ where: { sales_invoice_id: BigInt(ar.invoiceId) } })).status, 'ISSUED');
  assert.equal(await prisma.payment_allocation.count({ where: { payment_id: BigInt(payment) } }), 0);
});
