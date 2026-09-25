const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../app');
const prisma = require('../lib/prisma');
const { Money } = require('../lib/accountsPayable');
const setup = require('./setup');

const integration = Boolean(process.env.TEST_DATABASE_URL);
let context, banks = [];
test.beforeEach(async () => { context = await setup(); banks = []; });
test.afterEach(async () => { if (context) { await prisma.bank_account.deleteMany({ where: { bank_account_id: { in: banks } } }); await context.cleanup(); } });
test.after(async () => { await prisma.$disconnect(); });
function post(path, body = {}) { return request(app).post(`/api/sales/${path}`).set('Authorization', context.auth).send(body); }
async function draft(overrides = {}) {
  const response = await post('invoices', { invoice_number: `SALES-ACC-${Date.now()}-${Math.random()}`, invoice_type: 'SERVICE_INVOICE', customer_id: context.customerId,
    invoice_date: '2026-09-25', other_charges: '5', round_off: '-0.25', items: [{ inventory_item_id: context.inventoryItemId, description: 'Service', uom: 'EA', quantity: '2', unit_price: '100', gst_rate: '18' }], ...overrides });
  assert.equal(response.status, 201); context.created.invoiceIds.push(BigInt(response.body.data.sales_invoice_id)); return response.body.data;
}
async function journal(sourceType, sourceId) { return prisma.accounting_entry.findFirst({ where: { source_type: sourceType, source_id: BigInt(sourceId) }, include: { journal_entry: { include: { journal_line: true } } } }); }
function lines(entry) {
  const result = entry.journal_entry[0].journal_line;
  const sum = field => result.reduce((total, row) => total.plus(row[field].toString()), new Money(0));
  assert.ok(sum('debit_amount').eq(sum('credit_amount'))); return result;
}
async function receipt(amount, overrides = {}) {
  const response = await post('payments', { customer_id: context.customerId, payment_type: 'CUSTOMER_RECEIPT', payment_date: '2026-09-25', mode: 'CASH', amount, ...overrides });
  assert.equal(response.status, 201); return response.body.data;
}

test('invoice issuance posts balanced AR, sales revenue, output GST, and rounding lines', { skip: !integration }, async () => {
  const invoice = await draft();
  const issued = await post(`invoices/${invoice.sales_invoice_id}/issue`);
  assert.equal(issued.status, 200);
  const entry = await journal('SALES_INVOICE', invoice.sales_invoice_id), posted = lines(entry), by = key => posted.find(row => row.account_id === context.financeFields[`${key}_account_id`]);
  assert.equal(by('receivable').debit_amount.toString(), '240.75');
  assert.equal(by('sales_revenue').credit_amount.toString(), '205');
  assert.equal(by('output_cgst').credit_amount.toString(), '18');
  assert.equal(by('output_sgst').credit_amount.toString(), '18');
  assert.equal(by('rounding').debit_amount.toString(), '0.25');
  assert.equal(entry.created_by.toString(), context.userId);
  assert.equal((await post(`invoices/${invoice.sales_invoice_id}/issue`)).status, 409);
  assert.equal(await prisma.accounting_entry.count({ where: { source_type: 'SALES_INVOICE', source_id: BigInt(invoice.sales_invoice_id) } }), 1);
});
test('cash receipt allocation posts cash debit and AR credit', { skip: !integration }, async () => {
  const invoice = await draft({ other_charges: 0, round_off: 0, items: [{ inventory_item_id: context.inventoryItemId, description: 'Service', uom: 'EA', quantity: '1', unit_price: '100', gst_rate: '0' }] });
  await post(`invoices/${invoice.sales_invoice_id}/issue`);
  const ar = await prisma.accounts_receivable.findUnique({ where: { sales_invoice_id: BigInt(invoice.sales_invoice_id) } }), payment = await receipt('40');
  const allocation = await post(`payments/${payment.payment_id}/allocations`, { allocations: [{ accounts_receivable_id: ar.accounts_receivable_id.toString(), allocated_amount: '40' }] });
  assert.equal(allocation.status, 201);
  const posted = lines(await journal('CUSTOMER_PAYMENT_ALLOCATION', allocation.body.data.allocations[0].payment_allocation_id));
  assert.equal(posted.find(row => row.account_id === context.financeFields.cash_account_id).debit_amount.toString(), '40');
  assert.equal(posted.find(row => row.account_id === context.financeFields.receivable_account_id).credit_amount.toString(), '40');
});

test('bank receipt allocation uses the active bank GL mapping', { skip: !integration }, async () => {
  const invoice = await draft({ other_charges: 0, round_off: 0, items: [{ inventory_item_id: context.inventoryItemId, description: 'Service', uom: 'EA', quantity: '1', unit_price: '50', gst_rate: '0' }] });
  await post(`invoices/${invoice.sales_invoice_id}/issue`);
  const ar = await prisma.accounts_receivable.findUnique({ where: { sales_invoice_id: BigInt(invoice.sales_invoice_id) } });
  const bank = await prisma.bank_account.create({ data: { company_id: BigInt(context.companyId), bank_name: 'Sales bank', account_number: `sales-${context.userId}`, gl_account_id: context.financeFields.inventory_account_id } }); banks.push(bank.bank_account_id);
  const payment = await receipt('50', { mode: 'BANK', bank_account_id: bank.bank_account_id.toString() });
  const allocation = await post(`payments/${payment.payment_id}/allocations`, { allocations: [{ accounts_receivable_id: ar.accounts_receivable_id.toString(), allocated_amount: '50' }] });
  assert.equal(allocation.status, 201);
  const posted = lines(await journal('CUSTOMER_PAYMENT_ALLOCATION', allocation.body.data.allocations[0].payment_allocation_id));
  assert.equal(posted.find(row => row.account_id === bank.gl_account_id).debit_amount.toString(), '50');
});

test('missing sales mapping rolls back invoice status, AR, and accounting', { skip: !integration }, async () => {
  const invoice = await draft(); const companyId = BigInt(context.companyId), mapping = context.financeFields.receivable_account_id;
  await prisma.company_finance_config.update({ where: { company_id: companyId }, data: { receivable_account_id: null } });
  try { assert.equal((await post(`invoices/${invoice.sales_invoice_id}/issue`)).status, 400); }
  finally { await prisma.company_finance_config.update({ where: { company_id: companyId }, data: { receivable_account_id: mapping } }); }
  assert.equal((await prisma.sales_invoice.findUnique({ where: { sales_invoice_id: BigInt(invoice.sales_invoice_id) } })).status, 'DRAFT');
  assert.equal(await prisma.accounts_receivable.count({ where: { sales_invoice_id: BigInt(invoice.sales_invoice_id) } }), 0);
  assert.equal(await journal('SALES_INVOICE', invoice.sales_invoice_id), null);
});

test('unbalanced invoice data rolls back every issuance write', { skip: !integration }, async () => {
  const invoice = await draft({ other_charges: 0, round_off: 0, items: [{ inventory_item_id: context.inventoryItemId, description: 'Service', uom: 'EA', quantity: '1', unit_price: '100', gst_rate: '0' }] });
  await prisma.sales_invoice.update({ where: { sales_invoice_id: BigInt(invoice.sales_invoice_id) }, data: { total_amount: '99' } });
  assert.equal((await post(`invoices/${invoice.sales_invoice_id}/issue`)).status, 400);
  assert.equal((await prisma.sales_invoice.findUnique({ where: { sales_invoice_id: BigInt(invoice.sales_invoice_id) } })).status, 'DRAFT');
  assert.equal(await prisma.accounts_receivable.count({ where: { sales_invoice_id: BigInt(invoice.sales_invoice_id) } }), 0);
  assert.equal(await journal('SALES_INVOICE', invoice.sales_invoice_id), null);
});
