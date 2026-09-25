const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const setup = require('./setup');
const prisma = require('../lib/prisma');
const app = require('../app');
const { postJournal } = require('../lib/accounting');
const { Money } = require('../lib/accountsPayable');
const integration = Boolean(process.env.TEST_DATABASE_URL);
let context;
test.before(async () => { context = await setup(); });
test.after(async () => { try { if (context) await context.cleanup(); } finally { await prisma.$disconnect(); } });
function post(path, body = {}) { return request(app).post(`/api/procurement/${path}`).set('Authorization', context.auth).send(body); }
async function invoice(overrides = {}) {
  const response = await post('vendor-invoices', { vendor_id: context.vendorId, invoice_number: `ACC-${Date.now()}-${Math.random()}`, invoice_date: '2026-09-01', due_date: '2099-01-01',
    items: [{ inventory_item_id: context.inventoryItemId, uom: 'EA', quantity: 2, rate: 100, discount_amount: 10, gst_rate: 18, cess_rate: 1 }], other_charges: 5, round_off: -0.25, ...overrides });
  assert.equal(response.status, 201);
  const id = BigInt(response.body.data.vendor_invoice_id); context.created.vendorInvoiceIds.push(id); return id;
}
async function journal(source_type, source_id) {
  return prisma.accounting_entry.findFirst({ where: { source_type, source_id }, include: { journal_entry: { include: { journal_line: true } } } });
}
function balanced(entry) {
  const lines = entry.journal_entry[0].journal_line;
  const sum = field => lines.reduce((s, l) => s.plus(l[field].toString()), new Money(0));
  assert.ok(sum('debit_amount').eq(sum('credit_amount')));
  return lines;
}
test('invoice booking posts inventory, charges, input taxes, rounding and AP in a balanced journal', { skip: !integration }, async () => {
  const id = await invoice();
  assert.equal((await post(`vendor-invoices/${id}/book`)).status, 200);
  const entry = await journal('VENDOR_INVOICE', id);
  const lines = balanced(entry);
  const line = key => lines.find(l => l.account_id === context.financeFields[`${key}_account_id`]);
  assert.equal(line('inventory').debit_amount.toString(), '190');
  assert.equal(line('expense').debit_amount.toString(), '5');
  assert.equal(line('input_cgst').debit_amount.toString(), '17.1');
  assert.equal(line('input_sgst').debit_amount.toString(), '17.1');
  assert.equal(line('input_cess').debit_amount.toString(), '1.9');
  assert.equal(line('rounding').credit_amount.toString(), '0.25');
  assert.equal(line('payable').credit_amount.toString(), '230.85');
  assert.equal(entry.created_by.toString(), context.userId);
  assert.equal((await post(`vendor-invoices/${id}/book`)).status, 409);
  assert.equal(await prisma.accounting_entry.count({ where: { source_type: 'VENDOR_INVOICE', source_id: id } }), 1);
});
test('non-stock invoice is debited to expense', { skip: !integration }, async () => {
  await prisma.inventory_item.update({ where: { inventory_item_id: BigInt(context.lotInventoryItemId) }, data: { is_stock_item: false } });
  const id = await invoice({ items: [{ inventory_item_id: context.lotInventoryItemId, uom: 'EA', quantity: 1, rate: 100 }], other_charges: 0, round_off: 0 });
  assert.equal((await post(`vendor-invoices/${id}/book`)).status, 200);
  assert.equal(balanced(await journal('VENDOR_INVOICE', id)).find(l => l.account_id === context.financeFields.expense_account_id).debit_amount.toString(), '100');
});
test('cash allocation posts AP debit and cash credit', { skip: !integration }, async () => {
  const id = await invoice(); await post(`vendor-invoices/${id}/book`);
  const ap = await prisma.accounts_payable.findUnique({ where: { vendor_invoice_id: id } });
  const payment = await post('payments', { vendor_id: context.vendorId, accounts_payable_id: ap.accounts_payable_id.toString(), amount: '25.15', mode: 'CASH', payment_type: 'VENDOR_PAYMENT' });
  assert.equal(payment.status, 201);
  const allocation = await post(`payments/${payment.body.data.payment_id}/allocations`, { allocations: [{ accounts_payable_id: ap.accounts_payable_id.toString(), allocated_amount: '25.15' }] });
  assert.equal(allocation.status, 201);
  const lines = balanced(await journal('PAYMENT_ALLOCATION', BigInt(allocation.body.data.allocations[0].payment_allocation_id)));
  assert.equal(lines.find(l => l.account_id === context.financeFields.payable_account_id).debit_amount.toString(), '25.15');
  assert.equal(lines.find(l => l.account_id === context.financeFields.cash_account_id).credit_amount.toString(), '25.15');
});
test('missing configuration rolls back invoice status and AP', { skip: !integration }, async () => {
  const id = await invoice();
  const config = await prisma.company_finance_config.delete({ where: { company_id: BigInt(context.companyId) } });
  try { assert.equal((await post(`vendor-invoices/${id}/book`)).status, 409); }
  finally { await prisma.company_finance_config.create({ data: config }); }
  assert.equal((await prisma.vendor_invoice.findUnique({ where: { vendor_invoice_id: id } })).status, 'DRAFT');
  assert.equal(await prisma.accounts_payable.count({ where: { vendor_invoice_id: id } }), 0);
  assert.equal(await journal('VENDOR_INVOICE', id), null);
});
test('imbalance rolls back all preceding writes in the source transaction', { skip: !integration }, async () => {
  const id = await invoice();
  await assert.rejects(prisma.$transaction(async tx => {
    await tx.vendor_invoice.update({ where: { vendor_invoice_id: id }, data: { status: 'BOOKED' } });
    await postJournal(tx, { companyId: BigInt(context.companyId), sourceType: 'TEST', sourceId: id, date: new Date(), userId: BigInt(context.userId), lines: [
      { accountId: context.financeFields.inventory_account_id, debit: '100' }, { accountId: context.financeFields.payable_account_id, credit: '99' }
    ] });
  }), /not balanced/);
  assert.equal((await prisma.vendor_invoice.findUnique({ where: { vendor_invoice_id: id } })).status, 'DRAFT');
  assert.equal(await journal('TEST', id), null);
});
test('invalid configured account types are rejected', { skip: !integration }, async () => {
  const fields = Object.fromEntries(Object.entries(context.financeFields).map(([k,v]) => [k,v.toString()]));
  fields.payable_account_id = fields.inventory_account_id;
  const response = await request(app).put(`/api/procurement/finance-config/${context.companyId}`).set('Authorization', context.auth).send(fields);
  assert.equal(response.status, 400);
  assert.equal((await prisma.company_finance_config.findUnique({ where: { company_id: BigInt(context.companyId) } })).payable_account_id, context.financeFields.payable_account_id);
});
