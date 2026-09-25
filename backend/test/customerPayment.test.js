const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../app');
const prisma = require('../lib/prisma');
const setup = require('./setup');

const integration = Boolean(process.env.TEST_DATABASE_URL);
let context, bank;
test.beforeEach(async () => {
  context = await setup();
  bank = await prisma.bank_account.create({ data: { company_id: BigInt(context.companyId), bank_name: 'Receipt test bank', account_number: `receipt-${context.userId}` } });
});
test.afterEach(async () => {
  if (context) {
    if (bank) await prisma.bank_account.deleteMany({ where: { bank_account_id: bank.bank_account_id } });
    await context.cleanup();
  }
});
test.after(async () => { await prisma.$disconnect(); });
function body(overrides = {}) { return { customer_id: context.customerId, amount: '25.15', mode: 'CASH', payment_type: 'CUSTOMER_RECEIPT', payment_date: '2026-09-25', ...overrides }; }
function post(overrides = {}) { return request(app).post('/api/sales/payments').set('Authorization', context.auth).send(body(overrides)); }

test('creates an unallocated customer receipt with authenticated audit actor', { skip: !integration }, async () => {
  const response = await post({ created_by: '999999999', reference_number: ' RCPT-1 ' });
  assert.equal(response.status, 201); assert.equal(response.body.data.amount, '25.15'); assert.equal(response.body.data.customer_id, context.customerId); assert.equal(response.body.data.vendor_id, null);
  const id = BigInt(response.body.data.payment_id);
  assert.equal(await prisma.payment_allocation.count({ where: { payment_id: id } }), 0);
  const audit = await prisma.audit_log.findFirst({ where: { action: 'CUSTOMER_PAYMENT_CREATED', record_id: id } });
  assert.equal(audit.user_id.toString(), context.userId);
});
test('validates customer, amount, type, and exact-one party', { skip: !integration }, async () => {
  for (const values of [{ customer_id: '999999999999' }, { amount: 0 }, { amount: '-1' }, { amount: '1.001' }, { payment_type: 'VENDOR_PAYMENT' }, { vendor_id: context.vendorId }]) assert.equal((await post(values)).status, 400);
  await prisma.customer.update({ where: { customer_id: BigInt(context.customerId) }, data: { is_active: false } });
  try { assert.equal((await post()).status, 400); } finally { await prisma.customer.update({ where: { customer_id: BigInt(context.customerId) }, data: { is_active: true } }); }
});

test('validates payment mode, date, bank ownership, and allocation separation', { skip: !integration }, async () => {
  for (const values of [{ mode: 'INVALID' }, { mode: 'BANK' }, { bank_account_id: bank.bank_account_id.toString() }, { payment_date: '2026-02-30' }, { accounts_receivable_id: '1' }, { sales_invoice_id: '1' }]) assert.equal((await post(values)).status, 400);
  for (const mode of ['BANK', 'CHEQUE', 'UPI', 'NEFT', 'RTGS', 'IMPS', 'OTHER']) assert.equal((await post({ mode, bank_account_id: bank.bank_account_id.toString() })).status, 201);
});

test('inactive bank is rejected', { skip: !integration }, async () => {
  await prisma.bank_account.update({ where: { bank_account_id: bank.bank_account_id }, data: { is_active: false } });
  assert.equal((await post({ mode: 'BANK', bank_account_id: bank.bank_account_id.toString() })).status, 400);
});

test('receipt creation rolls back when audit insertion fails', { skip: !integration }, async () => {
  const before = await prisma.payment.count({ where: { customer_id: BigInt(context.customerId) } });
  const original = prisma.$transaction, run = original.bind(prisma);
  prisma.$transaction = callback => run(tx => callback(new Proxy(tx, { get(target, key) {
    if (key === 'audit_log') return { create: async () => { throw new Error('Injected customer payment audit failure'); } };
    return target[key];
  } })));
  try { assert.equal((await post()).status, 500); } finally { prisma.$transaction = original; }
  assert.equal(await prisma.payment.count({ where: { customer_id: BigInt(context.customerId) } }), before);
});
