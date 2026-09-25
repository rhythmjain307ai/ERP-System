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

async function draftInvoice(overrides = {}) {
  const response = await post('invoices', {
    invoice_number: `AR-INV-${Date.now()}-${Math.random()}`,
    invoice_type: 'SERVICE_INVOICE', customer_id: context.customerId, invoice_date: '2026-09-25', due_date: '2026-10-25',
    items: [{ inventory_item_id: context.inventoryItemId, description: 'Service', uom: 'EA', quantity: '2', unit_price: '100', gst_rate: '18' }],
    ...overrides
  });
  assert.equal(response.status, 201);
  context.created.invoiceIds.push(BigInt(response.body.data.sales_invoice_id));
  return response.body.data;
}

test('issuing an invoice atomically creates exactly one OPEN receivable with correct balances', { skip: !integration }, async () => {
  const invoice = await draftInvoice();
  const issued = await post(`invoices/${invoice.sales_invoice_id}/issue`);
  assert.equal(issued.status, 200);
  assert.equal(issued.body.data.status, 'ISSUED');
  assert.equal(issued.body.data.accounts_receivable.invoice_amount, '236');
  assert.equal(issued.body.data.accounts_receivable.received_amount, '0');
  assert.equal(issued.body.data.accounts_receivable.outstanding_amount, '236');
  assert.equal(issued.body.data.accounts_receivable.status, 'OPEN');
  assert.equal(await prisma.accounts_receivable.count({ where: { sales_invoice_id: BigInt(invoice.sales_invoice_id) } }), 1);
  assert.equal((await post(`invoices/${invoice.sales_invoice_id}/issue`)).status, 409);
  assert.equal(await prisma.accounts_receivable.count({ where: { sales_invoice_id: BigInt(invoice.sales_invoice_id) } }), 1);
});
test('AR creation failure rolls back invoice issuance', { skip: !integration }, async () => {
  const invoice = await draftInvoice();
  const original = prisma.$transaction, run = original.bind(prisma);
  prisma.$transaction = callback => run(tx => callback(new Proxy(tx, { get(target, key) {
    if (key === 'accounts_receivable') return { ...target[key], create: async () => { throw new Error('Injected AR creation failure'); } };
    return target[key];
  } })));
  try { assert.equal((await post(`invoices/${invoice.sales_invoice_id}/issue`)).status, 500); } finally { prisma.$transaction = original; }
  assert.equal((await prisma.sales_invoice.findUnique({ where: { sales_invoice_id: BigInt(invoice.sales_invoice_id) } })).status, 'DRAFT');
  assert.equal(await prisma.accounts_receivable.count({ where: { sales_invoice_id: BigInt(invoice.sales_invoice_id) } }), 0);
});

test('AR list, detail, customer and due-date filters return effective balances', { skip: !integration }, async () => {
  const invoice = await draftInvoice();
  await post(`invoices/${invoice.sales_invoice_id}/issue`);
  const ar = await prisma.accounts_receivable.findUnique({ where: { sales_invoice_id: BigInt(invoice.sales_invoice_id) } });
  const list = await get('accounts-receivable', { customer_id: context.customerId, status: 'OPEN', due_from: '2026-10-01', due_to: '2026-10-31' });
  assert.equal(list.status, 200); assert.equal(list.body.meta.total, 1); assert.equal(list.body.data[0].outstanding_amount, '236');
  const customer = await get(`customers/${context.customerId}/accounts-receivable`);
  assert.equal(customer.status, 200); assert.equal(customer.body.meta.total, 1);
  const detail = await get(`accounts-receivable/${ar.accounts_receivable_id}`);
  assert.equal(detail.status, 200); assert.equal(detail.body.data.sales_invoice.invoice_number, invoice.invoice_number);
  assert.equal((await get('accounts-receivable', { due_from: '2026-11-01', due_to: '2026-10-01' })).status, 400);
});

test('overdue AR is detected and included in the correct aging bucket', { skip: !integration }, async () => {
  const invoice = await draftInvoice();
  await post(`invoices/${invoice.sales_invoice_id}/issue`);
  const due = new Date(); due.setUTCDate(due.getUTCDate() - 10);
  await prisma.accounts_receivable.update({ where: { sales_invoice_id: BigInt(invoice.sales_invoice_id) }, data: { due_date: due } });
  const overdue = await get('accounts-receivable', { status: 'OVERDUE' });
  assert.equal(overdue.status, 200); assert.equal(overdue.body.meta.total, 1); assert.equal(overdue.body.data[0].status, 'OVERDUE');
  const aging = await get('accounts-receivable/aging');
  assert.equal(aging.status, 200); assert.equal(aging.body.data.buckets.days_1_30.count, 1); assert.equal(aging.body.data.total_outstanding, '236');
});

test('receivable status migration accepts paid terminology and rejects legacy status names', { skip: !integration }, async () => {
  const invoice = await draftInvoice(); await post(`invoices/${invoice.sales_invoice_id}/issue`);
  const ar = await prisma.accounts_receivable.findUnique({ where: { sales_invoice_id: BigInt(invoice.sales_invoice_id) } });
  await prisma.accounts_receivable.update({ where: { accounts_receivable_id: ar.accounts_receivable_id }, data: { status: 'PARTIALLY_PAID' } });
  await prisma.accounts_receivable.update({ where: { accounts_receivable_id: ar.accounts_receivable_id }, data: { status: 'PAID' } });
  await assert.rejects(prisma.accounts_receivable.update({ where: { accounts_receivable_id: ar.accounts_receivable_id }, data: { status: 'RECEIVED' } }));
});
