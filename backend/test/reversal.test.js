const test = require('node:test');
const assert = require('node:assert/strict');
const setup = require('./setup');
const prisma = require('../lib/prisma');
const { post, booked, pay, allocate } = require('./financeFixtures');
const { postJournal } = require('../lib/accounting');
const integration = Boolean(process.env.TEST_DATABASE_URL);
let context;
test.before(async () => { context = await setup(); });
test.after(async () => { try { if (context) await context.cleanup(); } finally { await prisma.$disconnect(); } });
const reason = { reason: 'Supplier correction' };

test('invoice reversal keeps invoice lines and cancels AP with exact reversing journal', { skip: !integration }, async () => {
  const { invoice, ap } = await booked(context);
  const response = await post(context, `vendor-invoices/${invoice.vendor_invoice_id}/reverse`, reason);
  assert.equal(response.status, 200);
  const updated = await prisma.vendor_invoice.findUnique({ where: { vendor_invoice_id: invoice.vendor_invoice_id } });
  assert.equal(updated.status, 'BOOKED'); assert.ok(updated.reversed_at);
  assert.equal(updated.total_amount.toString(), '100');
  const payable = await prisma.accounts_payable.findUnique({ where: { accounts_payable_id: ap.accounts_payable_id } });
  assert.equal(payable.status, 'CANCELLED'); assert.equal(payable.outstanding_amount.toString(), '0');
  const original = await prisma.accounting_entry.findFirst({ where: { source_type: 'VENDOR_INVOICE', source_id: invoice.vendor_invoice_id }, include: { journal_entry: { include: { journal_line: true } }, reversed_by_entry: { include: { journal_entry: { include: { journal_line: true } } } } } });
  assert.equal(original.status, 'REVERSED');
  for (const line of original.journal_entry[0].journal_line) {
    const reversed = original.reversed_by_entry.journal_entry[0].journal_line.find(l => l.account_id === line.account_id);
    assert.equal(reversed.debit_amount.toString(), line.credit_amount.toString());
    assert.equal(reversed.credit_amount.toString(), line.debit_amount.toString());
  }
  assert.equal((await post(context, `vendor-invoices/${invoice.vendor_invoice_id}/reverse`, reason)).status, 409);
});
test('payment reversal restores AP and retains allocations; another payment can settle it', { skip: !integration }, async () => {
  const { invoice, ap } = await booked(context);
  const p = await pay(context, ap); const allocation = await allocate(context, p, ap);
  assert.equal((await post(context, `vendor-invoices/${invoice.vendor_invoice_id}/reverse`, reason)).status, 409);
  assert.equal((await post(context, `payments/${p.payment_id}/reverse`, reason)).status, 200);
  assert.ok((await prisma.payment_allocation.findUnique({ where: { payment_allocation_id: BigInt(allocation.payment_allocation_id) } })).reversed_at);
  const restored = await prisma.accounts_payable.findUnique({ where: { accounts_payable_id: ap.accounts_payable_id } });
  assert.equal(restored.status, 'OPEN'); assert.equal(restored.paid_amount.toString(), '0'); assert.equal(restored.outstanding_amount.toString(), '100');
  assert.equal((await post(context, `payments/${p.payment_id}/reverse`, reason)).status, 409);
  const q = await pay(context, ap); await allocate(context, q, ap);
  assert.equal((await prisma.accounts_payable.findUnique({ where: { accounts_payable_id: ap.accounts_payable_id } })).status, 'PAID');
});
test('partial payment reversal preserves other payment allocations', { skip: !integration }, async () => {
  const { ap } = await booked(context), p = await pay(context, ap, '40'), q = await pay(context, ap, '60');
  await allocate(context, p, ap, '40'); await allocate(context, q, ap, '60');
  assert.equal((await post(context, `payments/${p.payment_id}/reverse`, reason)).status, 200);
  const updated = await prisma.accounts_payable.findUnique({ where: { accounts_payable_id: ap.accounts_payable_id } });
  assert.equal(updated.paid_amount.toString(), '60'); assert.equal(updated.outstanding_amount.toString(), '40');
});
test('manual journal reversal works but managed journal reversal is refused', { skip: !integration }, async () => {
  const { invoice } = await booked(context);
  const managed = await prisma.journal_entry.findFirst({ where: { accounting_entry: { source_type: 'VENDOR_INVOICE', source_id: invoice.vendor_invoice_id } } });
  assert.equal((await post(context, `journals/${managed.journal_entry_id}/reverse`, reason)).status, 409);
  const manual = await prisma.$transaction(tx => postJournal(tx, { companyId: BigInt(context.companyId), sourceType: 'MANUAL', sourceId: 1n, date: new Date('2026-09-01'), userId: BigInt(context.userId), lines: [
    { accountId: context.financeFields.expense_account_id, debit: '5' }, { accountId: context.financeFields.cash_account_id, credit: '5' }
  ] }));
  assert.equal((await post(context, `journals/${manual.journal.journal_entry_id}/reverse`, reason)).status, 200);
  assert.equal((await post(context, `journals/${manual.journal.journal_entry_id}/reverse`, reason)).status, 409);
});
test('reversal rejects missing reason and dates preceding the posting', { skip: !integration }, async () => {
  const { invoice } = await booked(context);
  assert.equal((await post(context, `vendor-invoices/${invoice.vendor_invoice_id}/reverse`)).status, 400);
  assert.equal((await post(context, `vendor-invoices/${invoice.vendor_invoice_id}/reverse`, { ...reason, reversal_date: '2020-01-01' })).status, 400);
});
test('reversal failure rolls back reversing entries and source state', { skip: !integration }, async () => {
  const { invoice, ap } = await booked(context);
  const original = prisma.$transaction, run = original.bind(prisma);
  prisma.$transaction = callback => run(tx => callback(new Proxy(tx, { get(target, property) {
    if (property === 'audit_log') return { create: async () => { throw new Error('Injected reversal audit failure'); } };
    return target[property];
  } })));
  try { assert.equal((await post(context, `vendor-invoices/${invoice.vendor_invoice_id}/reverse`, reason)).status, 500); }
  finally { prisma.$transaction = original; }
  assert.equal((await prisma.vendor_invoice.findUnique({ where: { vendor_invoice_id: invoice.vendor_invoice_id } })).reversed_at, null);
  assert.equal((await prisma.accounts_payable.findUnique({ where: { accounts_payable_id: ap.accounts_payable_id } })).status, 'OPEN');
  const entry = await prisma.accounting_entry.findFirst({ where: { source_type: 'VENDOR_INVOICE', source_id: invoice.vendor_invoice_id }, include: { reversed_by_entry: true } });
  assert.equal(entry.status, 'POSTED'); assert.equal(entry.reversed_by_entry, null);
});
