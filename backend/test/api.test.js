const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const setupIntegration = require('./setup');
const app = require('../app');
const prisma = require('../lib/prisma');

const integration = Boolean(process.env.TEST_DATABASE_URL);
let context;

test.before(async () => {
  context = await setupIntegration();
});

test.after(async () => {
  if (context) await context.cleanup();
  await require('../lib/prisma').$disconnect();
});

test('requires authentication for writes', async () => {
  const response = await request(app).post('/api/procurement/requisitions').send({ requisition_number: 'PR-UNAUTH', items: [] });
  assert.equal(response.status, 401);
});

test('returns 404 for unknown routes', async () => {
  const response = await request(app).get('/api/unknown-record');
  assert.equal(response.status, 404);
  assert.equal(response.body.success, false);
});

test('runs integration tests only with TEST_DATABASE_URL', { skip: !integration }, () => {
  assert.ok(context);
});

test('rejects invalid line-item payloads', { skip: !integration }, async () => {
  const response = await request(app).post('/api/procurement/requisitions').set('Authorization', context.auth).send({ requisition_number: `PR-INVALID-${Date.now()}`, items: [{ inventory_item_id: context.inventoryItemId, uom: 'EA', requested_quantity: 0 }] });
  assert.equal(response.status, 400);
  assert.match(response.body.error.message, /greater than zero/);
});

test('creates a purchase requisition with items', { skip: !integration }, async () => {
  const response = await request(app).post('/api/procurement/requisitions').set('Authorization', context.auth).send({ requisition_number: `PR-${Date.now()}`, items: [{ inventory_item_id: context.inventoryItemId, uom: 'EA', requested_quantity: 2 }] });
  assert.equal(response.status, 201);
  assert.equal(response.body.data.purchase_requisition_item.length, 1);
  context.created.requisitionIds.push(BigInt(response.body.data.purchase_requisition_id));
});

test('creates a customer order with items', { skip: !integration }, async () => {
  const response = await request(app).post('/api/sales/orders').set('Authorization', context.auth).send({ order_number: `SO-${Date.now()}`, customer_id: context.customerId, items: [{ inventory_item_id: context.inventoryItemId, uom: 'EA', ordered_quantity: 2 }] });
  assert.equal(response.status, 201);
  assert.equal(response.body.data.customer_order_item.length, 1);
  context.created.orderIds.push(BigInt(response.body.data.customer_order_id));
});

test('creates a sales invoice with items', { skip: !integration }, async () => {
  const response = await request(app).post('/api/sales/invoices').set('Authorization', context.auth).send({ invoice_number: `INV-${Date.now()}`, customer_id: context.customerId, items: [{ inventory_item_id: context.inventoryItemId, description: 'Test', uom: 'EA', quantity: 2 }] });
  assert.equal(response.status, 201);
  assert.equal(response.body.data.sales_invoice_item.length, 1);
  context.created.invoiceIds.push(BigInt(response.body.data.sales_invoice_id));
});

async function createReceiptFixture(orderedQuantity, receivedQuantity) {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const purchaseOrder = await request(app).post('/api/procurement/purchase-orders').set('Authorization', context.auth).send({ po_number: `PO-GRN-${suffix}`, vendor_id: context.vendorId, items: [{ inventory_item_id: context.inventoryItemId, uom: 'EA', ordered_quantity: orderedQuantity }] });
  assert.equal(purchaseOrder.status, 201);
  const purchaseOrderId = BigInt(purchaseOrder.body.data.purchase_order_id);
  const purchaseOrderItemId = purchaseOrder.body.data.purchase_order_item[0].purchase_order_item_id;
  context.created.purchaseOrderIds.push(purchaseOrderId);
  const grn = await request(app).post('/api/procurement/grns').set('Authorization', context.auth).send({ grn_number: `GRN-${suffix}`, purchase_order_id: purchaseOrderId.toString(), vendor_id: context.vendorId, warehouse_id: context.warehouseId, items: [{ purchase_order_item_id: purchaseOrderItemId, inventory_item_id: context.inventoryItemId, uom: 'EA', received_quantity: receivedQuantity }] });
  assert.equal(grn.status, 201);
  const grnId = BigInt(grn.body.data.grn_id);
  context.created.grnIds.push(grnId);
  return { purchaseOrderId, grnId, grnItemId: BigInt(grn.body.data.grn_item[0].grn_item_id) };
}

test('posts a fully accepted GRN and receives the purchase order', { skip: !integration }, async () => {
  const fixture = await createReceiptFixture(5, 5);
  const before = await prisma.inventory_stock.findFirst({ where: { inventory_item_id: BigInt(context.inventoryItemId), warehouse_id: BigInt(context.warehouseId), lot_id: null } });
  const movementCount = await prisma.stock_movement.count({ where: { reference_type: 'GRN', reference_id: fixture.grnId, movement_type: 'PURCHASE_RECEIPT' } });
  const response = await request(app).post(`/api/procurement/grns/${fixture.grnId}/post`).set('Authorization', context.auth).send({ inspection_status: 'PASSED', items: [{ grn_item_id: fixture.grnItemId.toString(), accepted_quantity: 5 }] });
  assert.equal(response.status, 200);
  const after = await prisma.inventory_stock.findFirst({ where: { inventory_item_id: BigInt(context.inventoryItemId), warehouse_id: BigInt(context.warehouseId), lot_id: null } });
  const purchaseOrder = await prisma.purchase_order.findUnique({ where: { purchase_order_id: fixture.purchaseOrderId } });
  assert.equal(Number(after.quantity) - Number(before?.quantity || 0), 5);
  assert.equal(await prisma.stock_movement.count({ where: { reference_type: 'GRN', reference_id: fixture.grnId, movement_type: 'PURCHASE_RECEIPT' } }) - movementCount, 1);
  assert.equal(purchaseOrder.status, 'RECEIVED');
});

test('posts a partial GRN using only the accepted quantity', { skip: !integration }, async () => {
  const fixture = await createReceiptFixture(10, 8);
  const before = await prisma.inventory_stock.findFirst({ where: { inventory_item_id: BigInt(context.inventoryItemId), warehouse_id: BigInt(context.warehouseId), lot_id: null } });
  const response = await request(app).post(`/api/procurement/grns/${fixture.grnId}/post`).set('Authorization', context.auth).send({ inspection_status: 'PARTIAL', items: [{ grn_item_id: fixture.grnItemId.toString(), accepted_quantity: 3 }] });
  assert.equal(response.status, 200);
  const after = await prisma.inventory_stock.findFirst({ where: { inventory_item_id: BigInt(context.inventoryItemId), warehouse_id: BigInt(context.warehouseId), lot_id: null } });
  const purchaseOrder = await prisma.purchase_order.findUnique({ where: { purchase_order_id: fixture.purchaseOrderId } });
  assert.equal(Number(after.quantity) - Number(before?.quantity || 0), 3);
  assert.equal(purchaseOrder.status, 'PARTIALLY_RECEIVED');
});

test('posts a failed GRN without inventory changes', { skip: !integration }, async () => {
  const fixture = await createReceiptFixture(5, 5);
  const before = await prisma.inventory_stock.findFirst({ where: { inventory_item_id: BigInt(context.inventoryItemId), warehouse_id: BigInt(context.warehouseId), lot_id: null } });
  const movementCount = await prisma.stock_movement.count({ where: { reference_type: 'GRN', reference_id: fixture.grnId, movement_type: 'PURCHASE_RECEIPT' } });
  const response = await request(app).post(`/api/procurement/grns/${fixture.grnId}/post`).set('Authorization', context.auth).send({ inspection_status: 'FAILED', items: [{ grn_item_id: fixture.grnItemId.toString(), accepted_quantity: 0 }] });
  assert.equal(response.status, 200);
  const after = await prisma.inventory_stock.findFirst({ where: { inventory_item_id: BigInt(context.inventoryItemId), warehouse_id: BigInt(context.warehouseId), lot_id: null } });
  assert.equal(Number(after?.quantity || 0), Number(before?.quantity || 0));
  assert.equal(await prisma.stock_movement.count({ where: { reference_type: 'GRN', reference_id: fixture.grnId, movement_type: 'PURCHASE_RECEIPT' } }), movementCount);
});

test('rejects duplicate GRN posting without changing stock or movements', { skip: !integration }, async () => {
  const fixture = await createReceiptFixture(5, 5);
  const first = await request(app).post(`/api/procurement/grns/${fixture.grnId}/post`).set('Authorization', context.auth).send({ inspection_status: 'PASSED', items: [{ grn_item_id: fixture.grnItemId.toString(), accepted_quantity: 5 }] });
  assert.equal(first.status, 200);
  const stock = await prisma.inventory_stock.findFirst({ where: { inventory_item_id: BigInt(context.inventoryItemId), warehouse_id: BigInt(context.warehouseId), lot_id: null } });
  const movementCount = await prisma.stock_movement.count({ where: { reference_type: 'GRN', reference_id: fixture.grnId, movement_type: 'PURCHASE_RECEIPT' } });
  const second = await request(app).post(`/api/procurement/grns/${fixture.grnId}/post`).set('Authorization', context.auth).send({ inspection_status: 'PASSED', items: [{ grn_item_id: fixture.grnItemId.toString(), accepted_quantity: 5 }] });
  assert.equal(second.status, 409);
  const unchangedStock = await prisma.inventory_stock.findFirst({ where: { inventory_item_id: BigInt(context.inventoryItemId), warehouse_id: BigInt(context.warehouseId), lot_id: null } });
  assert.equal(Number(unchangedStock.quantity), Number(stock.quantity));
  assert.equal(await prisma.stock_movement.count({ where: { reference_type: 'GRN', reference_id: fixture.grnId, movement_type: 'PURCHASE_RECEIPT' } }), movementCount);
});

test('rejects accepted quantity above received and remaining PO quantity', { skip: !integration }, async () => {
  const receivedFixture = await createReceiptFixture(5, 4);
  const tooMuchReceived = await request(app).post(`/api/procurement/grns/${receivedFixture.grnId}/post`).set('Authorization', context.auth).send({ inspection_status: 'PASSED', items: [{ grn_item_id: receivedFixture.grnItemId.toString(), accepted_quantity: 5 }] });
  assert.equal(tooMuchReceived.status, 400);

  const remainingFixture = await createReceiptFixture(5, 3);
  const first = await request(app).post(`/api/procurement/grns/${remainingFixture.grnId}/post`).set('Authorization', context.auth).send({ inspection_status: 'PARTIAL', items: [{ grn_item_id: remainingFixture.grnItemId.toString(), accepted_quantity: 3 }] });
  assert.equal(first.status, 200);
  const secondGrn = await request(app).post('/api/procurement/grns').set('Authorization', context.auth).send({ grn_number: `GRN-REMAINING-${Date.now()}`, purchase_order_id: remainingFixture.purchaseOrderId.toString(), vendor_id: context.vendorId, warehouse_id: context.warehouseId, items: [{ purchase_order_item_id: (await prisma.purchase_order_item.findFirst({ where: { purchase_order_id: remainingFixture.purchaseOrderId } })).purchase_order_item_id.toString(), inventory_item_id: context.inventoryItemId, uom: 'EA', received_quantity: 3 }] });
  assert.equal(secondGrn.status, 201);
  const secondGrnId = BigInt(secondGrn.body.data.grn_id);
  context.created.grnIds.push(secondGrnId);
  const remainingViolation = await request(app).post(`/api/procurement/grns/${secondGrnId}/post`).set('Authorization', context.auth).send({ inspection_status: 'PASSED', items: [{ grn_item_id: secondGrn.body.data.grn_item[0].grn_item_id, accepted_quantity: 3 }] });
  assert.equal(remainingViolation.status, 400);
});

test('increments approval request versions', { skip: !integration }, async () => {
  const transactionId = String(Date.now());
  context.created.approvalTransactionIds.push(transactionId);
  const body = { approval_workflow_id: context.workflowId, transaction_type: 'TEST', transaction_id: transactionId };
  const first = await request(app).post('/api/approvals/requests').set('Authorization', context.auth).send(body);
  const second = await request(app).post('/api/approvals/requests').set('Authorization', context.auth).send(body);
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.equal(second.body.data.request_version, first.body.data.request_version + 1);
});

test('does not expose password hashes in user responses', { skip: !integration }, async () => {
  const list = await request(app).get('/api/master/users');
  assert.equal(list.status, 200);
  assert.ok(list.body.data.every((user) => !Object.hasOwn(user, 'password_hash')));

  const get = await request(app).get(`/api/master/users/${context.userId}`);
  assert.equal(get.status, 200);
  assert.equal(Object.hasOwn(get.body.data, 'password_hash'), false);
});
