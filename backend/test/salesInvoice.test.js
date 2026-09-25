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

async function createOrder(quantity = '5', rate = '100', gst = '18') {
  const response = await post('orders', {
    order_number: `SO-3D-${Date.now()}-${Math.random()}`,
    customer_id: context.customerId,
    items: [{ inventory_item_id: context.inventoryItemId, uom: 'EA', ordered_quantity: quantity, unit_rate: rate, gst_rate: gst }]
  });
  assert.equal(response.status, 201);
  const orderId = response.body.data.customer_order_id;
  context.created.orderIds.push(BigInt(orderId));
  assert.equal((await post(`orders/${orderId}/confirm`)).status, 200);
  return { id: orderId, itemId: response.body.data.customer_order_item[0].customer_order_item_id };
}

async function dispatch(order, quantity) {
  await prisma.inventory_stock.create({ data: { inventory_item_id: BigInt(context.inventoryItemId), warehouse_id: BigInt(context.warehouseId), quantity: '20', reserved_quantity: 0 } });
  const created = await post('deliveries', {
    delivery_number: `DEL-3D-${Date.now()}-${Math.random()}`,
    customer_id: context.customerId,
    customer_order_id: order.id,
    warehouse_id: context.warehouseId,
    items: [{ customer_order_item_id: order.itemId, inventory_item_id: context.inventoryItemId, uom: 'EA', delivered_quantity: quantity }]
  });
  assert.equal(created.status, 201);
  const deliveryId = created.body.data.delivery_id;
  context.created.deliveryIds.push(BigInt(deliveryId));
  assert.equal((await post(`deliveries/${deliveryId}/dispatch`)).status, 200);
  return deliveryId;
}

async function createInvoice(body = {}, track = true) {
  const response = await post('invoices', {
    invoice_number: `INV-3D-${Date.now()}-${Math.random()}`,
    customer_id: context.customerId,
    invoice_date: '2026-09-25',
    items: [{ inventory_item_id: context.inventoryItemId, uom: 'EA', quantity: '1', unit_price: '10', gst_rate: '18' }],
    ...body
  });
  if (track && response.status === 201) context.created.invoiceIds.push(BigInt(response.body.data.sales_invoice_id));
  return response;
}

test('delivery-based invoice calculates order prices and GST on the server and issues with traceability', { skip: !integration }, async () => {
  const order = await createOrder();
  const deliveryId = await dispatch(order, '5');
  const created = await createInvoice({
    customer_order_id: order.id,
    delivery_ids: [deliveryId],
    taxable_amount: '0', total_amount: '1', cgst_amount: '0',
    items: [{ customer_order_item_id: order.itemId, inventory_item_id: context.inventoryItemId, uom: 'EA', quantity: '5', unit_price: '0.01', gst_rate: '0', line_total: '0.01' }]
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.data.status, 'DRAFT');
  assert.equal(created.body.data.taxable_amount, '500');
  assert.equal(created.body.data.cgst_amount, '45');
  assert.equal(created.body.data.sgst_amount, '45');
  assert.equal(created.body.data.igst_amount, '0');
  assert.equal(created.body.data.total_amount, '590');
  assert.equal(created.body.data.sales_invoice_item[0].unit_price, '100');
  assert.equal(created.body.data.delivery[0].delivery_id, deliveryId);

  const issued = await post(`invoices/${created.body.data.sales_invoice_id}/issue`);
  assert.equal(issued.status, 200);
  assert.equal(issued.body.data.status, 'ISSUED');
});
test('invoice validation rejects missing customer, empty lines, invalid quantities and invalid prices', { skip: !integration }, async () => {
  assert.equal((await createInvoice({ customer_id: '999999999999', items: [{ inventory_item_id: context.inventoryItemId, uom: 'EA', quantity: '1', unit_price: '10' }] }, false)).status, 400);
  assert.equal((await createInvoice({ items: [] }, false)).status, 400);
  assert.equal((await createInvoice({ items: [{ inventory_item_id: context.inventoryItemId, uom: 'EA', quantity: '0', unit_price: '10' }] }, false)).status, 400);
  assert.equal((await createInvoice({ items: [{ inventory_item_id: context.inventoryItemId, uom: 'EA', quantity: '1', unit_price: '-1' }] }, false)).status, 400);
});

test('invoice cannot issue more than the linked dispatched quantity', { skip: !integration }, async () => {
  const order = await createOrder('5');
  const deliveryId = await dispatch(order, '2');
  const invoice = await createInvoice({ customer_order_id: order.id, delivery_ids: [deliveryId], items: [{ customer_order_item_id: order.itemId, quantity: '3' }] });
  assert.equal(invoice.status, 201);
  const issued = await post(`invoices/${invoice.body.data.sales_invoice_id}/issue`);
  assert.equal(issued.status, 409);
  assert.match(issued.body.error.message, /exceeds delivered quantity/);
  assert.equal((await prisma.sales_invoice.findUnique({ where: { sales_invoice_id: BigInt(invoice.body.data.sales_invoice_id) } })).status, 'DRAFT');
});

test('a dispatched delivery cannot be linked to a second invoice and failed creation rolls back', { skip: !integration }, async () => {
  const order = await createOrder();
  const deliveryId = await dispatch(order, '5');
  const body = { customer_order_id: order.id, delivery_ids: [deliveryId], items: [{ customer_order_item_id: order.itemId, quantity: '5' }] };
  const first = await createInvoice(body);
  assert.equal(first.status, 201);
  const before = await prisma.sales_invoice.count({ where: { customer_id: BigInt(context.customerId) } });
  const duplicate = await createInvoice(body, false);
  assert.equal(duplicate.status, 409);
  assert.equal(await prisma.sales_invoice.count({ where: { customer_id: BigInt(context.customerId) } }), before);
});

test('non-service invoice needs delivery while service invoice may issue without one', { skip: !integration }, async () => {
  const taxInvoice = await createInvoice();
  assert.equal(taxInvoice.status, 201);
  assert.equal((await post(`invoices/${taxInvoice.body.data.sales_invoice_id}/issue`)).status, 409);

  const service = await createInvoice({ invoice_type: 'SERVICE_INVOICE' });
  assert.equal(service.status, 201);
  const issued = await post(`invoices/${service.body.data.sales_invoice_id}/issue`);
  assert.equal(issued.status, 200);
  assert.equal(issued.body.data.status, 'ISSUED');
});
