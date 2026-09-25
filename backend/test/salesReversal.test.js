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
function get(path, query = {}) { return request(app).get(`/api/sales/${path}`).query(query).set('Authorization', context.auth); }
async function draft(amount = '100', date = '2026-09-01') {
  const response = await post('invoices', { invoice_number: `REV-SALES-${Date.now()}-${Math.random()}`, invoice_type: 'SERVICE_INVOICE', customer_id: context.customerId,
    invoice_date: date, items: [{ inventory_item_id: context.inventoryItemId, description: 'Service', uom: 'EA', quantity: '1', unit_price: amount, gst_rate: '0' }] });
  assert.equal(response.status, 201); context.created.invoiceIds.push(BigInt(response.body.data.sales_invoice_id)); return response.body.data;
}
async function issued(amount = '100') { const invoice = await draft(amount); assert.equal((await post(`invoices/${invoice.sales_invoice_id}/issue`)).status, 200); return invoice; }
async function pay(invoice, amount) {
  const ar = await prisma.accounts_receivable.findUnique({ where: { sales_invoice_id: BigInt(invoice.sales_invoice_id) } });
  const payment = await post('payments', { customer_id: context.customerId, payment_type: 'CUSTOMER_RECEIPT', payment_date: '2026-09-25', mode: 'CASH', amount });
  assert.equal(payment.status, 201);
  const allocation = await post(`payments/${payment.body.data.payment_id}/allocations`, { allocations: [{ accounts_receivable_id: ar.accounts_receivable_id.toString(), allocated_amount: amount }] });
  assert.equal(allocation.status, 201); return { payment: payment.body.data, allocation: allocation.body.data.allocations[0], ar };
}
const reason = { reason: 'Customer correction', reversal_date: '2026-09-25' };

test('sales invoice reversal cancels AR and creates exact reversing journal without deleting history', { skip: !integration }, async () => {
  const invoice = await issued();
  const response = await post(`invoices/${invoice.sales_invoice_id}/reverse`, reason);
  assert.equal(response.status, 200); assert.equal(response.body.data.invoice.status, 'CANCELLED');
  const ar = await prisma.accounts_receivable.findUnique({ where: { sales_invoice_id: BigInt(invoice.sales_invoice_id) } });
  assert.equal(ar.status, 'CANCELLED'); assert.equal(ar.outstanding_amount.toString(), '0');
  const original = await prisma.accounting_entry.findFirst({ where: { source_type: 'SALES_INVOICE', source_id: BigInt(invoice.sales_invoice_id) }, include: { journal_entry: { include: { journal_line: true } }, reversed_by_entry: { include: { journal_entry: { include: { journal_line: true } } } } } });
  assert.equal(original.status, 'REVERSED');
  for (const line of original.journal_entry[0].journal_line) {
    const reversed = original.reversed_by_entry.journal_entry[0].journal_line.find(row => row.account_id === line.account_id);
    assert.equal(reversed.debit_amount.toString(), line.credit_amount.toString()); assert.equal(reversed.credit_amount.toString(), line.debit_amount.toString());
  }
  assert.equal((await post(`invoices/${invoice.sales_invoice_id}/reverse`, reason)).status, 409);
});

test('customer payment reversal restores AR and invoice while retaining allocation audit rows', { skip: !integration }, async () => {
  const invoice = await issued(), transaction = await pay(invoice, '100');
  assert.equal((await post(`invoices/${invoice.sales_invoice_id}/reverse`, reason)).status, 409);
  assert.equal((await post(`payments/${transaction.payment.payment_id}/reverse`, reason)).status, 200);
  const allocation = await prisma.payment_allocation.findUnique({ where: { payment_allocation_id: BigInt(transaction.allocation.payment_allocation_id) } });
  assert.ok(allocation.reversed_at);
  const ar = await prisma.accounts_receivable.findUnique({ where: { accounts_receivable_id: transaction.ar.accounts_receivable_id } });
  assert.equal(ar.status, 'OVERDUE'); assert.equal(ar.received_amount.toString(), '0'); assert.equal(ar.outstanding_amount.toString(), '100');
  assert.equal((await prisma.sales_invoice.findUnique({ where: { sales_invoice_id: BigInt(invoice.sales_invoice_id) } })).status, 'ISSUED');
  assert.equal((await post(`payments/${transaction.payment.payment_id}/reverse`, reason)).status, 409);
  assert.equal((await post(`invoices/${invoice.sales_invoice_id}/reverse`, reason)).status, 200);
});

test('reversing one customer payment preserves other active allocations', { skip: !integration }, async () => {
  const invoice = await issued(), first = await pay(invoice, '40'), second = await pay(invoice, '60');
  assert.equal((await post(`payments/${first.payment.payment_id}/reverse`, reason)).status, 200);
  const ar = await prisma.accounts_receivable.findUnique({ where: { accounts_receivable_id: first.ar.accounts_receivable_id } });
  assert.equal(ar.received_amount.toString(), '60'); assert.equal(ar.outstanding_amount.toString(), '40'); assert.equal(ar.status, 'OVERDUE');
  assert.equal((await prisma.payment.findUnique({ where: { payment_id: BigInt(second.payment.payment_id) } })).status, 'CREATED');
});

test('DRAFT cancellation is controlled and issued invoice requires reversal', { skip: !integration }, async () => {
  const draftInvoice = await draft();
  assert.equal((await post(`invoices/${draftInvoice.sales_invoice_id}/cancel`)).status, 200);
  assert.equal((await prisma.sales_invoice.findUnique({ where: { sales_invoice_id: BigInt(draftInvoice.sales_invoice_id) } })).status, 'CANCELLED');
  assert.equal(await prisma.accounts_receivable.count({ where: { sales_invoice_id: BigInt(draftInvoice.sales_invoice_id) } }), 0);
  const posted = await issued(); assert.equal((await post(`invoices/${posted.sales_invoice_id}/cancel`)).status, 409);
});

test('customer ledger retains dated invoice and payment reversal adjustments', { skip: !integration }, async () => {
  const invoice = await issued(), transaction = await pay(invoice, '100');
  await post(`payments/${transaction.payment.payment_id}/reverse`, reason); await post(`invoices/${invoice.sales_invoice_id}/reverse`, reason);
  const current = await get(`customers/${context.customerId}/ledger`);
  assert.equal(current.status, 200); assert.deepEqual(current.body.data.entries.map(row => row.type), ['SALES_INVOICE', 'PAYMENT_ALLOCATION', 'ADJUSTMENT', 'ADJUSTMENT']); assert.equal(current.body.data.closing_balance, '0');
  const historical = await get(`customers/${context.customerId}/statement`, { to: '2026-09-01' });
  assert.equal(historical.body.data.entries.length, 1); assert.equal(historical.body.data.closing_balance, '100');
});

test('reversal audit failure rolls back journal and source state', { skip: !integration }, async () => {
  const invoice = await issued(); const original = prisma.$transaction, run = original.bind(prisma);
  prisma.$transaction = callback => run(tx => callback(new Proxy(tx, { get(target, key) {
    if (key === 'audit_log') return { create: async () => { throw new Error('Injected sales reversal audit failure'); } };
    return target[key];
  } })));
  try { assert.equal((await post(`invoices/${invoice.sales_invoice_id}/reverse`, reason)).status, 500); } finally { prisma.$transaction = original; }
  assert.equal((await prisma.sales_invoice.findUnique({ where: { sales_invoice_id: BigInt(invoice.sales_invoice_id) } })).status, 'ISSUED');
  assert.equal((await prisma.accounts_receivable.findUnique({ where: { sales_invoice_id: BigInt(invoice.sales_invoice_id) } })).status, 'OPEN');
  const entry = await prisma.accounting_entry.findFirst({ where: { source_type: 'SALES_INVOICE', source_id: BigInt(invoice.sales_invoice_id) }, include: { reversed_by_entry: true } });
  assert.equal(entry.status, 'POSTED'); assert.equal(entry.reversed_by_entry, null);
});
