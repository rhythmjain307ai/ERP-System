const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../app');
const prisma = require('../lib/prisma');
const { Money } = require('../lib/accountsPayable');
const setup = require('./setup');

const integration = Boolean(process.env.TEST_DATABASE_URL);
let context;
test.beforeEach(async () => { context = await setup(); });
test.afterEach(async () => { if (context) await context.cleanup(); });
test.after(async () => { await prisma.$disconnect(); });
function api(method, path, body) { const call = request(app)[method](`/api/${path}`).set('Authorization', context.auth); return body === undefined ? call : call.send(body); }

test('complete Order-to-Cash flow preserves inventory, AR, ledger, and balanced accounting', { skip: !integration }, async () => {
  const suffix = `${Date.now()}-${Math.random()}`;
  const customerResponse = await api('post', 'master/customers', { company_id: context.companyId, customer_code: `E2E-${suffix}`, customer_name: 'E2E Customer', payment_terms_days: 30 });
  assert.equal(customerResponse.status, 201);
  const customerId = customerResponse.body.data.customer_id; context.created.customerIds.push(BigInt(customerId));

  const orderResponse = await api('post', 'sales/orders', { order_number: `E2E-SO-${suffix}`, customer_id: customerId,
    items: [{ inventory_item_id: context.inventoryItemId, uom: 'EA', ordered_quantity: '2', unit_rate: '100', gst_rate: '18' }] });
  assert.equal(orderResponse.status, 201); const order = orderResponse.body.data; context.created.orderIds.push(BigInt(order.customer_order_id));
  assert.equal((await api('post', `sales/orders/${order.customer_order_id}/confirm`, {})).status, 200);

  await prisma.inventory_stock.create({ data: { inventory_item_id: BigInt(context.inventoryItemId), warehouse_id: BigInt(context.warehouseId), quantity: '10', reserved_quantity: 0 } });
  const deliveryResponse = await api('post', 'sales/deliveries', { delivery_number: `E2E-DEL-${suffix}`, customer_id: customerId, customer_order_id: order.customer_order_id, warehouse_id: context.warehouseId,
    items: [{ customer_order_item_id: order.customer_order_item[0].customer_order_item_id, inventory_item_id: context.inventoryItemId, uom: 'EA', delivered_quantity: '2' }] });
  assert.equal(deliveryResponse.status, 201); const deliveryId = deliveryResponse.body.data.delivery_id; context.created.deliveryIds.push(BigInt(deliveryId));
  assert.equal((await api('post', `sales/deliveries/${deliveryId}/dispatch`, {})).status, 200);
  const stock = await prisma.inventory_stock.findFirst({ where: { inventory_item_id: BigInt(context.inventoryItemId), warehouse_id: BigInt(context.warehouseId), lot_id: null } });
  assert.equal(stock.quantity.toString(), '8');
  assert.equal(await prisma.stock_movement.count({ where: { movement_type: 'SALE_ISSUE', reference_type: 'DELIVERY', reference_id: BigInt(deliveryId) } }), 1);
  assert.equal((await prisma.customer_order.findUnique({ where: { customer_order_id: BigInt(order.customer_order_id) } })).status, 'FULFILLED');

  const failedDelivery = await api('post', 'sales/deliveries', { delivery_number: `E2E-OVER-${suffix}`, customer_id: customerId, customer_order_id: order.customer_order_id, warehouse_id: context.warehouseId,
    items: [{ customer_order_item_id: order.customer_order_item[0].customer_order_item_id, inventory_item_id: context.inventoryItemId, uom: 'EA', delivered_quantity: '1' }] });
  assert.equal(failedDelivery.status, 201); context.created.deliveryIds.push(BigInt(failedDelivery.body.data.delivery_id));
  assert.equal((await api('post', `sales/deliveries/${failedDelivery.body.data.delivery_id}/dispatch`, {})).status, 409);
  assert.equal((await prisma.inventory_stock.findFirst({ where: { inventory_item_id: BigInt(context.inventoryItemId), warehouse_id: BigInt(context.warehouseId), lot_id: null } })).quantity.toString(), '8');

  const invoiceResponse = await api('post', 'sales/invoices', { invoice_number: `E2E-INV-${suffix}`, customer_id: customerId, customer_order_id: order.customer_order_id, invoice_date: '2026-09-25', delivery_ids: [deliveryId],
    items: [{ customer_order_item_id: order.customer_order_item[0].customer_order_item_id, quantity: '2' }] });
  assert.equal(invoiceResponse.status, 201); const invoiceId = invoiceResponse.body.data.sales_invoice_id; context.created.invoiceIds.push(BigInt(invoiceId));
  assert.equal(invoiceResponse.body.data.total_amount, '236');
  assert.equal((await api('post', `sales/invoices/${invoiceId}/issue`, {})).status, 200);
  const ar = await prisma.accounts_receivable.findUnique({ where: { sales_invoice_id: BigInt(invoiceId) } });
  assert.equal(ar.status, 'OPEN'); assert.equal(ar.outstanding_amount.toString(), '236');

  const paymentResponse = await api('post', 'sales/payments', { customer_id: customerId, payment_type: 'CUSTOMER_RECEIPT', payment_date: '2026-09-25', mode: 'CASH', amount: '236', reference_number: `E2E-RCPT-${suffix}` });
  assert.equal(paymentResponse.status, 201);
  const allocationResponse = await api('post', `sales/payments/${paymentResponse.body.data.payment_id}/allocations`, { allocations: [{ accounts_receivable_id: ar.accounts_receivable_id.toString(), allocated_amount: '236' }] });
  assert.equal(allocationResponse.status, 201);
  const settled = await prisma.accounts_receivable.findUnique({ where: { accounts_receivable_id: ar.accounts_receivable_id } });
  assert.equal(settled.status, 'PAID'); assert.equal(settled.outstanding_amount.toString(), '0');

  const ledger = await api('get', `sales/customers/${customerId}/ledger`);
  assert.equal(ledger.status, 200); assert.deepEqual(ledger.body.data.entries.map(row => row.running_balance), ['236', '0']); assert.equal(ledger.body.data.reconciles_to_current_ar, true);
  const entries = await prisma.accounting_entry.findMany({ where: { OR: [{ source_type: 'SALES_INVOICE', source_id: BigInt(invoiceId) }, { source_type: 'CUSTOMER_PAYMENT_ALLOCATION', source_id: BigInt(allocationResponse.body.data.allocations[0].payment_allocation_id) }] }, include: { journal_entry: { include: { journal_line: true } } } });
  assert.equal(entries.length, 2);
  for (const entry of entries) {
    const journalLines = entry.journal_entry[0].journal_line;
    const total = field => journalLines.reduce((sum, row) => sum.plus(row[field].toString()), new Money(0));
    assert.ok(total('debit_amount').eq(total('credit_amount')));
  }
});
