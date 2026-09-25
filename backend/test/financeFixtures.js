const request = require('supertest');
const assert = require('node:assert/strict');
const app = require('../app');
const prisma = require('../lib/prisma');
function post(context, path, body = {}) { return request(app).post(`/api/procurement/${path}`).set('Authorization', context.auth).send(body); }
async function booked(context, amount = '100') {
  const response = await post(context, 'vendor-invoices', { vendor_id: context.vendorId, invoice_number: `FIN-${Date.now()}-${Math.random()}`, invoice_date: '2026-09-01', due_date: '2099-01-01',
    items: [{ inventory_item_id: context.inventoryItemId, uom: 'EA', quantity: 1, rate: amount }] });
  assert.equal(response.status, 201);
  const id = BigInt(response.body.data.vendor_invoice_id); context.created.vendorInvoiceIds.push(id);
  assert.equal((await post(context, `vendor-invoices/${id}/book`)).status, 200);
  return { invoice: await prisma.vendor_invoice.findUnique({ where: { vendor_invoice_id: id } }), ap: await prisma.accounts_payable.findUnique({ where: { vendor_invoice_id: id } }) };
}
async function pay(context, ap, amount = '100', overrides = {}) {
  const response = await post(context, 'payments', { vendor_id: context.vendorId, accounts_payable_id: ap.accounts_payable_id.toString(), amount, mode: 'CASH', payment_type: 'VENDOR_PAYMENT', ...overrides });
  assert.equal(response.status, 201);
  return response.body.data;
}
async function allocate(context, payment, ap, amount = '100') {
  const response = await post(context, `payments/${payment.payment_id}/allocations`, { allocations: [{ accounts_payable_id: ap.accounts_payable_id.toString(), allocated_amount: amount }] });
  assert.equal(response.status, 201); return response.body.data.allocations[0];
}
module.exports = { post, booked, pay, allocate };
