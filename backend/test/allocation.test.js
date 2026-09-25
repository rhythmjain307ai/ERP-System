const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const setup = require('./setup');
const prisma = require('../lib/prisma');
const app = require('../app');
const integration = Boolean(process.env.TEST_DATABASE_URL);
let context;
test.before(async () => { context = await setup(); });
test.after(async () => { try { if (context) await context.cleanup(); } finally { await prisma.$disconnect(); } });
async function ap(amount = '100', vendor = context.vendorId) { return prisma.accounts_payable.create({ data: { vendor_id: BigInt(vendor), invoice_amount: amount, outstanding_amount: amount, due_date: new Date('2099-01-01') } }); }
async function payment(amount = '100') { return prisma.payment.create({ data: { vendor_id: BigInt(context.vendorId), amount, payment_type: 'VENDOR_PAYMENT', mode: 'CASH' } }); }
function allocate(p, rows) { return request(app).post(`/api/procurement/payments/${p.payment_id}/allocations`).set('Authorization', context.auth).send({ allocations: rows.map(([a, amount]) => ({ accounts_payable_id: a.accounts_payable_id.toString(), allocated_amount: amount })) }); }
async function read(a) { return prisma.accounts_payable.findUnique({ where: { accounts_payable_id: a.accounts_payable_id } }); }

test('partial and full allocation recalculate AP and payment balance', { skip: !integration }, async () => {
  const a = await ap(), p = await payment();
  const partial = await allocate(p, [[a, '25.15']]);
  assert.equal(partial.status, 201);
  assert.equal(partial.body.data.unallocated_amount, '74.85');
  assert.equal((await read(a)).status, 'PARTIALLY_PAID');
  assert.equal((await read(a)).outstanding_amount.toFixed(2), '74.85');
  assert.equal((await allocate(p, [[a, '74.85']])).status, 201);
  assert.equal((await read(a)).status, 'PAID');
  assert.equal((await read(a)).outstanding_amount.toFixed(2), '0.00');
});
test('one payment allocates to multiple APs and one AP receives multiple payments', { skip: !integration }, async () => {
  const a = await ap(), b = await ap(), p = await payment('150'), q = await payment('50');
  assert.equal((await allocate(p, [[a, '100'], [b, '50']])).status, 201);
  assert.equal((await allocate(q, [[b, '50']])).status, 201);
  assert.equal((await read(b)).status, 'PAID');
});
test('over-allocation of payment or AP is rejected atomically', { skip: !integration }, async () => {
  const a = await ap('20'), b = await ap('20'), p = await payment('30');
  assert.equal((await allocate(p, [[a, '20'], [b, '20']])).status, 409);
  assert.equal((await allocate(p, [[a, '5'], [b, '25']])).status, 409);
  assert.equal(await prisma.payment_allocation.count({ where: { payment_id: p.payment_id } }), 0);
  assert.equal((await read(a)).paid_amount.toString(), '0');
});
test('allocation rejects nonpositive amounts, duplicate AP, wrong vendor and missing AP', { skip: !integration }, async () => {
  const a = await ap(), other = await ap('100', context.otherVendorId), p = await payment();
  for (const amount of ['0', '-1', '0.001']) assert.equal((await allocate(p, [[a, amount]])).status, 400);
  assert.equal((await allocate(p, [[a, '1'], [a, '1']])).status, 400);
  assert.equal((await allocate(p, [[other, '1']])).status, 400);
  assert.equal((await allocate(p, [[{ accounts_payable_id: 999999999n }, '1']])).status, 400);
});
test('concurrent requests cannot overspend one payment', { skip: !integration }, async () => {
  const a = await ap(), b = await ap(), p = await payment();
  const responses = await Promise.all([allocate(p, [[a, '75']]), allocate(p, [[b, '75']])]);
  assert.deepEqual(responses.map(r => r.status).sort(), [201, 409]);
  assert.equal((await prisma.payment_allocation.aggregate({ where: { payment_id: p.payment_id }, _sum: { allocated_amount: true } }))._sum.allocated_amount.toString(), '75');
});
test('concurrent payments cannot overpay the same AP', { skip: !integration }, async () => {
  const a = await ap(), p = await payment(), q = await payment();
  const responses = await Promise.all([allocate(p, [[a, '75']]), allocate(q, [[a, '75']])]);
  assert.deepEqual(responses.map(r => r.status).sort(), [201, 409]);
  assert.equal((await read(a)).paid_amount.toString(), '75');
});
test('allocation failure after inserts rolls back AP, allocation and audit', { skip: !integration }, async () => {
  const a = await ap(), p = await payment();
  const original = prisma.$transaction, run = original.bind(prisma);
  prisma.$transaction = callback => run(tx => callback(new Proxy(tx, { get(target, property) {
    if (property === 'audit_log') return { create: async () => { throw new Error('Injected allocation audit failure'); } };
    return target[property];
  } })));
  try { assert.equal((await allocate(p, [[a, '20']])).status, 500); } finally { prisma.$transaction = original; }
  assert.equal((await read(a)).paid_amount.toString(), '0');
  assert.equal(await prisma.payment_allocation.count({ where: { payment_id: p.payment_id } }), 0);
});
test('legacy paid totals are not silently overwritten', { skip: !integration }, async () => {
  const a = await ap(), p = await payment();
  await prisma.accounts_payable.update({ where: { accounts_payable_id: a.accounts_payable_id }, data: { paid_amount: '1' } });
  assert.equal((await allocate(p, [[a, '1']])).status, 409);
  assert.equal((await read(a)).paid_amount.toString(), '1');
});
