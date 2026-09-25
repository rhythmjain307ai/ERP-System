const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const setupIntegration = require('./setup');
const prisma = require('../lib/prisma');
const app = require('../app');
const { positiveMoney, financeDate } = require('../lib/finance');
const integration = Boolean(process.env.TEST_DATABASE_URL);
let context, payable, bank;
const root = '/api/procurement/payments';

test('payment money rejects invalid values and preserves exact cents', () => {
  for (const value of [0, -1, true, null, 'NaN', 'Infinity', '1e3', '0.001', '100000000000000']) assert.throws(() => positiveMoney(value), { status: 400 });
  assert.equal(positiveMoney('99999999999999.99').toFixed(2), '99999999999999.99');
  assert.throws(() => financeDate('2026-02-30', 'date'), { status: 400 });
});
test.before(async () => {
  context = await setupIntegration();
  if (!context) return;
  const vendor = await prisma.vendor.findUnique({ where: { vendor_id: BigInt(context.vendorId) } });
  bank = await prisma.bank_account.create({ data: { company_id: vendor.company_id, bank_name: 'Test bank', account_number: `test-${context.userId}` } });
  payable = await prisma.accounts_payable.create({ data: { vendor_id: vendor.vendor_id, invoice_amount: '100', outstanding_amount: '100' } });
});
test.after(async () => {
  try {
    if (context) {
      await prisma.payment_allocation.deleteMany({ where: { payment: { vendor_id: BigInt(context.vendorId) } } });
      await prisma.payment.deleteMany({ where: { vendor_id: BigInt(context.vendorId) } });
      if (bank) await prisma.bank_account.delete({ where: { bank_account_id: bank.bank_account_id } });
      await context.cleanup();
    }
  } finally { await prisma.$disconnect(); }
});
function body(overrides = {}) { return { vendor_id: context.vendorId, accounts_payable_id: payable.accounts_payable_id.toString(), amount: '25.15', mode: 'CASH', payment_type: 'VENDOR_PAYMENT', ...overrides }; }
function post(overrides) { return request(app).post(root).set('Authorization', context.auth).send(body(overrides)); }

test('creates payment and authenticated audit record without allocating or changing AP', { skip: !integration }, async () => {
  const before = await prisma.accounts_payable.findUnique({ where: { accounts_payable_id: payable.accounts_payable_id } });
  const response = await post({ created_by: '999999999' });
  assert.equal(response.status, 201);
  assert.equal(response.body.data.amount, '25.15');
  const id = BigInt(response.body.data.payment_id);
  assert.equal(await prisma.payment_allocation.count({ where: { payment_id: id } }), 0);
  assert.deepEqual(await prisma.accounts_payable.findUnique({ where: { accounts_payable_id: payable.accounts_payable_id } }), before);
  const audit = await prisma.audit_log.findFirst({ where: { table_name: 'payment', record_id: id, action: 'PAYMENT_CREATED' } });
  assert.equal(audit.user_id.toString(), context.userId);
  assert.equal(audit.new_values.intended_accounts_payable_id, payable.accounts_payable_id.toString());
});
test('validates vendor, AP ownership, and amount', { skip: !integration }, async () => {
  for (const values of [{ vendor_id: '999999999' }, { vendor_id: context.otherVendorId }, { accounts_payable_id: '999999999' }, { amount: 0 }, { amount: '-1' }, { amount: '1.001' }]) assert.equal((await post(values)).status, 400);
});
test('validates payment mode, type, cash/bank consistency and date', { skip: !integration }, async () => {
  for (const values of [{ mode: 'INVALID' }, { payment_type: 'CUSTOMER_RECEIPT' }, { customer_id: context.customerId }, { mode: 'BANK' },
    { bank_account_id: bank.bank_account_id.toString() }, { payment_date: '2026-02-30' }]) assert.equal((await post(values)).status, 400);
});
test('creates supported bank modes and rejects inactive bank', { skip: !integration }, async () => {
  for (const mode of ['BANK', 'CHEQUE', 'UPI', 'NEFT', 'RTGS', 'IMPS', 'OTHER']) assert.equal((await post({ mode, bank_account_id: bank.bank_account_id.toString() })).status, 201);
  await prisma.bank_account.update({ where: { bank_account_id: bank.bank_account_id }, data: { is_active: false } });
  try { assert.equal((await post({ mode: 'BANK', bank_account_id: bank.bank_account_id.toString() })).status, 400); }
  finally { await prisma.bank_account.update({ where: { bank_account_id: bank.bank_account_id }, data: { is_active: true } }); }
});
test('rejects inactive vendor and terminal AP', { skip: !integration }, async () => {
  await prisma.vendor.update({ where: { vendor_id: BigInt(context.vendorId) }, data: { is_active: false } });
  try { assert.equal((await post()).status, 400); }
  finally { await prisma.vendor.update({ where: { vendor_id: BigInt(context.vendorId) }, data: { is_active: true } }); }
  await prisma.accounts_payable.update({ where: { accounts_payable_id: payable.accounts_payable_id }, data: { status: 'CANCELLED' } });
  try { assert.equal((await post()).status, 409); }
  finally { await prisma.accounts_payable.update({ where: { accounts_payable_id: payable.accounts_payable_id }, data: { status: 'OPEN' } }); }
});
test('payment creation rolls back when its audit insert fails', { skip: !integration }, async () => {
  const original = prisma.$transaction;
  const run = original.bind(prisma);
  const count = await prisma.payment.count();
  prisma.$transaction = callback => run(tx => callback(new Proxy(tx, { get(target, property) {
    if (property === 'audit_log') return { create: async () => { throw new Error('Injected audit failure'); } };
    return target[property];
  } })));
  try { assert.equal((await post()).status, 500); } finally { prisma.$transaction = original; }
  assert.equal(await prisma.payment.count(), count);
});
test('payment creation requires authentication', async () => {
  assert.equal((await request(app).post(root).send({})).status, 401);
});
