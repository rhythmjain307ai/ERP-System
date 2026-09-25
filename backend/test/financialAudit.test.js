const test = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../lib/prisma');
const setup = require('./setup');
const { post, booked, pay, allocate } = require('./financeFixtures');
const integration = Boolean(process.env.TEST_DATABASE_URL);
let context;
test.beforeEach(async () => { context = await setup(); });
test.afterEach(async () => { if (context) await context.cleanup(); });
test.after(async () => { await prisma.$disconnect(); });
test('financial actors and timestamps follow authenticated user through booking and allocation', { skip: !integration }, async () => {
  const { invoice, ap } = await booked(context);
  const payment = await pay(context, ap, '100', { created_by: '999999', created_at: '2000-01-01' });
  const allocation = await allocate(context, payment, ap);
  for (const row of [invoice, ap, payment, allocation]) assert.equal(String(row.created_by), context.userId);
  assert.equal(String(invoice.booked_by), context.userId);
  for (const date of [invoice.created_at, invoice.booked_at, ap.created_at, payment.created_at, allocation.allocated_at]) assert.ok(Number.isFinite(new Date(date).getTime()));
  const journals = await prisma.journal_entry.findMany({ where: { accounting_entry: { company_id: BigInt(context.companyId) } } });
  assert.equal(journals.length, 2);
  for (const journal of journals) assert.equal(String(journal.created_by), context.userId);
  const logs = await prisma.audit_log.findMany({ where: { user_id: BigInt(context.userId) } });
  for (const action of ['INVOICE_CREATED', 'INVOICE_BOOKED', 'AP_CREATED', 'PAYMENT_CREATED', 'PAYMENT_ALLOCATED', 'JOURNAL_POSTED']) assert.ok(logs.some(log => log.action === action), action);
  assert.equal(logs.find(log => log.action === 'INVOICE_BOOKED').old_values.status, 'DRAFT');
  assert.equal(logs.find(log => log.action === 'INVOICE_BOOKED').new_values.status, 'BOOKED');
});
test('draft cancellation records actor, timestamp and immutable audit snapshot', { skip: !integration }, async () => {
  const response = await post(context, 'vendor-invoices', { vendor_id: context.vendorId, invoice_number: 'AUDIT-CANCEL', invoice_date: '2026-09-01', due_date: '2099-01-01', items: [{ inventory_item_id: context.inventoryItemId, quantity: 1, rate: 10, uom: 'EA' }] });
  assert.equal(response.status, 201);
  const id = BigInt(response.body.data.vendor_invoice_id); context.created.vendorInvoiceIds.push(id);
  assert.equal((await post(context, 'vendor-invoices/' + id + '/cancel', { cancelled_by: '99999' })).status, 200);
  const invoice = await prisma.vendor_invoice.findUnique({ where: { vendor_invoice_id: id } });
  assert.equal(String(invoice.cancelled_by), context.userId); assert.ok(invoice.cancelled_at);
  const log = await prisma.audit_log.findFirst({ where: { record_id: id, action: 'INVOICE_CANCELLED' } });
  assert.equal(log.new_values.status, 'CANCELLED');
  assert.equal(await prisma.accounts_payable.count({ where: { vendor_invoice_id: id } }), 0);
});
test('invoice audit failure rolls back invoice and items without orphan audit', { skip: !integration }, async () => {
  const original = prisma.$transaction, run = original.bind(prisma);
  const before = await prisma.audit_log.count({ where: { user_id: BigInt(context.userId) } });
  prisma.$transaction = callback => run(tx => callback(new Proxy(tx, { get(target, key) {
    if (key === 'audit_log') return { create: async () => { throw new Error('Injected invoice audit failure'); } };
    return target[key];
  } })));
  try {
    assert.equal((await post(context, 'vendor-invoices', { vendor_id: context.vendorId, invoice_number: 'AUDIT-FAIL', invoice_date: '2026-09-01', due_date: '2099-01-01', items: [{ inventory_item_id: context.inventoryItemId, quantity: 1, rate: 10, uom: 'EA' }] })).status, 500);
  } finally { prisma.$transaction = original; }
  assert.equal(await prisma.vendor_invoice.count({ where: { vendor_id: BigInt(context.vendorId) } }), 0);
  assert.equal(await prisma.audit_log.count({ where: { user_id: BigInt(context.userId) } }), before);
});
