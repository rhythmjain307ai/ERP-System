const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const setup = require('./setup');
const prisma = require('../lib/prisma');
const app = require('../app');
const { booked, pay, post, allocate } = require('./financeFixtures');
const integration = Boolean(process.env.TEST_DATABASE_URL);
let context, bank;
test.beforeEach(async () => {
  context = await setup(); if (!context) return;
  bank = await prisma.bank_account.create({ data: { company_id: BigInt(context.companyId), bank_name: 'Test bank', account_number: `R-${context.userId}`, gl_account_id: context.financeFields.cash_account_id } });
});
test.afterEach(async () => {
  if (!context) return;
  await prisma.bank_transaction.deleteMany({ where: { bank_account_id: bank.bank_account_id } });
  await prisma.payment.deleteMany({ where: { vendor_id: BigInt(context.vendorId) } });
  await prisma.bank_account.delete({ where: { bank_account_id: bank.bank_account_id } });
  await context.cleanup();
});
test.after(async () => { await prisma.$disconnect(); });
async function fixture(overrides = {}) {
  const { ap } = await booked(context);
  const payment = await pay(context, ap, '100', { mode: 'BANK', bank_account_id: bank.bank_account_id.toString() });
  const response = await post(context, 'bank-transactions', { bank_account_id: bank.bank_account_id.toString(), amount: '100', transaction_type: 'DEBIT', ...overrides });
  assert.equal(response.status, 201); return { payment, row: response.body.data, ap };
}
test('bank payment journals, matching, reconciliation and report totals agree', { skip: !integration }, async () => {
  const { payment, row, ap } = await fixture();
  const allocation = await allocate(context, payment, ap);
  const journal = await prisma.journal_entry.findFirst({ where: { accounting_entry: { source_type: 'PAYMENT_ALLOCATION', source_id: BigInt(allocation.payment_allocation_id) } }, include: { journal_line: true } });
  assert.equal(journal.journal_line.find(l => l.account_id === bank.gl_account_id).credit_amount.toString(), '100');
  assert.equal((await post(context, `bank-transactions/${row.bank_transaction_id}/match`, { payment_id: payment.payment_id })).status, 200);
  const reconciled = await post(context, `bank-transactions/${row.bank_transaction_id}/reconcile`);
  assert.equal(reconciled.status, 200); assert.equal(reconciled.body.data.reconciliation_status, 'RECONCILED');
  assert.equal(reconciled.body.data.reconciled_by, context.userId);
  const report = await request(app).get('/api/procurement/bank-reconciliation').query({ bank_account_id: bank.bank_account_id.toString() }).set('Authorization', context.auth);
  assert.equal(report.status, 200); assert.equal(report.body.data.totals.RECONCILED.debit, '100');
  assert.equal((await post(context, `payments/${payment.payment_id}/reverse`, { reason: 'Correction' })).status, 409);
  assert.equal((await post(context, `bank-transactions/${row.bank_transaction_id}/unmatch`)).status, 409);
});
test('bank matching rejects wrong amount or direction', { skip: !integration }, async () => {
  for (const override of [{ amount: '99' }, { transaction_type: 'CREDIT' }]) {
    const { payment, row } = await fixture(override);
    assert.equal((await post(context, `bank-transactions/${row.bank_transaction_id}/match`, { payment_id: payment.payment_id })).status, 400);
  }
});
test('a payment cannot match two statements, including concurrent matches', { skip: !integration }, async () => {
  const { payment, row } = await fixture();
  const other = await post(context, 'bank-transactions', { bank_account_id: bank.bank_account_id.toString(), amount: '100', transaction_type: 'DEBIT' });
  const results = await Promise.all([row, other.body.data].map(r => post(context, `bank-transactions/${r.bank_transaction_id}/match`, { payment_id: payment.payment_id })));
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  assert.equal(await prisma.bank_transaction.count({ where: { payment_id: BigInt(payment.payment_id) } }), 1);
});
test('unmatching retains audit history and permits payment reversal', { skip: !integration }, async () => {
  const { payment, row } = await fixture();
  await post(context, `bank-transactions/${row.bank_transaction_id}/match`, { payment_id: payment.payment_id });
  assert.equal((await post(context, `bank-transactions/${row.bank_transaction_id}/unmatch`)).status, 200);
  assert.equal((await post(context, `payments/${payment.payment_id}/reverse`, { reason: 'Correction' })).status, 200);
  assert.equal(await prisma.audit_log.count({ where: { table_name: 'bank_transaction', record_id: BigInt(row.bank_transaction_id), action: 'BANK_UNMATCH' } }), 1);
});
test('bank matching audit failure rolls back the link', { skip: !integration }, async () => {
  const { payment, row } = await fixture();
  const original = prisma.$transaction, run = original.bind(prisma);
  prisma.$transaction = callback => run(tx => callback(new Proxy(tx, { get(target, property) {
    if (property === 'audit_log') return { create: async () => { throw new Error('Injected bank audit failure'); } }; return target[property];
  } })));
  try { assert.equal((await post(context, `bank-transactions/${row.bank_transaction_id}/match`, { payment_id: payment.payment_id })).status, 500); } finally { prisma.$transaction = original; }
  assert.equal((await prisma.bank_transaction.findUnique({ where: { bank_transaction_id: BigInt(row.bank_transaction_id) } })).payment_id, null);
});
