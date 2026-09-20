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

async function resetStock(quantity, inventoryItemId = context.inventoryItemId, lotId = null) {
  const where = { inventory_item_id: BigInt(inventoryItemId), warehouse_id: BigInt(context.warehouseId), lot_id: lotId === null ? null : BigInt(lotId) };
  const existing = await prisma.inventory_stock.findFirst({ where });
  if (existing) return prisma.inventory_stock.update({ where: { inventory_stock_id: existing.inventory_stock_id }, data: { quantity, reserved_quantity: 0 } });
  return prisma.inventory_stock.create({ data: { ...where, quantity, reserved_quantity: 0 } });
}

async function createDeliveryFixture(options = {}) {
  const response = await request(app).post('/api/sales/deliveries').set('Authorization', context.auth).send({
    delivery_number: `DEL-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
    customer_id: options.customerId || context.customerId,
    customer_order_id: options.customerOrderId,
    sales_invoice_id: options.salesInvoiceId,
    warehouse_id: context.warehouseId,
    status: options.status,
    items: [{ customer_order_item_id: options.customerOrderItemId, sales_invoice_item_id: options.salesInvoiceItemId, inventory_item_id: options.inventoryItemId || context.inventoryItemId, lot_id: options.lotId, uom: options.uom || 'EA', delivered_quantity: options.quantity || 4 }]
  });
  assert.equal(response.status, 201);
  const deliveryId = BigInt(response.body.data.delivery_id);
  context.created.deliveryIds.push(deliveryId);
  return { deliveryId, response };
}

async function dispatch(deliveryId) {
  return request(app).post(`/api/sales/deliveries/${deliveryId}/dispatch`).set('Authorization', context.auth).send({});
}

async function createProductionFixture({ lotTrackedOutput = false, plannedQuantity = 5, componentQuantity = 1, secondComponent = false } = {}) {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const warehouse = await prisma.warehouse.findUnique({ where: { warehouse_id: BigInt(context.warehouseId) } });
  const finishedItem = await prisma.inventory_item.create({ data: { item_code: `FG-${suffix}`, item_name: `Finished ${suffix}`, base_uom: 'EA', is_lot_tracked: lotTrackedOutput } });
  context.created.productionItemIds.push(finishedItem.inventory_item_id);
  const bom = await prisma.bill_of_material.create({ data: { finished_item_id: finishedItem.inventory_item_id, bom_code: `BOM-${suffix}`, version: '1' } });
  context.created.bomIds.push(bom.bom_id);
  await prisma.bom_item.create({ data: { bom_id: bom.bom_id, component_item_id: BigInt(context.inventoryItemId), quantity_per_unit: componentQuantity, uom: 'EA' } });
  let secondRawItem = null;
  if (secondComponent) {
    secondRawItem = await prisma.inventory_item.create({ data: { item_code: `RM-${suffix}`, item_name: `Second raw ${suffix}`, base_uom: 'EA' } });
    context.created.productionItemIds.push(secondRawItem.inventory_item_id);
    await prisma.bom_item.create({ data: { bom_id: bom.bom_id, component_item_id: secondRawItem.inventory_item_id, quantity_per_unit: componentQuantity, uom: 'EA' } });
    await prisma.inventory_stock.create({ data: { inventory_item_id: secondRawItem.inventory_item_id, warehouse_id: BigInt(context.warehouseId), quantity: 10, reserved_quantity: 0 } });
  }
  const productionOrder = await prisma.production_order.create({ data: { production_order_number: `PROD-${suffix}`, inventory_item_id: finishedItem.inventory_item_id, bom_id: bom.bom_id, factory_id: warehouse.factory_id, planned_quantity: plannedQuantity } });
  context.created.productionOrderIds.push(productionOrder.production_order_id);
  const workOrder = await prisma.work_order.create({ data: { production_order_id: productionOrder.production_order_id, work_order_number: `WO-${suffix}`, operation_name: 'Assembly', planned_quantity: plannedQuantity } });
  context.created.workOrderIds.push(workOrder.work_order_id);
  return { finishedItem, productionOrder, workOrder, warehouse, secondRawItem };
}

function consumeBody(fixture, quantity = 5, overrides = {}) {
  const items = [{ inventory_item_id: context.inventoryItemId, uom: 'EA', warehouse_id: context.warehouseId, quantity, ...overrides }];
  if (fixture.secondRawItem) items.push({ inventory_item_id: fixture.secondRawItem.inventory_item_id.toString(), uom: 'EA', warehouse_id: context.warehouseId, quantity });
  return { production_quantity: quantity, items };
}

async function consumeProduction(fixture, quantity = 5, overrides = {}) {
  return request(app).post(`/api/production/work-orders/${fixture.workOrder.work_order_id}/consume`).set('Authorization', context.auth).send(consumeBody(fixture, quantity, overrides));
}

async function outputProduction(fixture, quantity = 5, overrides = {}) {
  return request(app).post(`/api/production/work-orders/${fixture.workOrder.work_order_id}/output`).set('Authorization', context.auth).send({ inventory_item_id: fixture.finishedItem.inventory_item_id.toString(), warehouse_id: context.warehouseId, quantity, ...overrides });
}

test('posts BOM-based production consumption for each component', { skip: !integration }, async () => {
  const fixture = await createProductionFixture({ componentQuantity: 1, secondComponent: true });
  await resetStock(10);
  const response = await consumeProduction(fixture, 5);
  assert.equal(response.status, 200);
  assert.equal(Number((await prisma.inventory_stock.findFirst({ where: { inventory_item_id: BigInt(context.inventoryItemId), warehouse_id: BigInt(context.warehouseId), lot_id: null } })).quantity), 5);
  assert.equal(await prisma.stock_movement.count({ where: { reference_type: 'WORK_ORDER', reference_id: fixture.workOrder.work_order_id, movement_type: 'PRODUCTION_CONSUMPTION' } }), 1);
  assert.equal((await prisma.work_order.findUnique({ where: { work_order_id: fixture.workOrder.work_order_id } })).status, 'RUNNING');
});

test('rolls back all consumption when one material is insufficient', { skip: !integration }, async () => {
  const fixture = await createProductionFixture({ componentQuantity: 1 });
  await resetStock(2);
  const response = await consumeProduction(fixture, 5);
  assert.equal(response.status, 400);
  assert.equal(Number((await prisma.inventory_stock.findFirst({ where: { inventory_item_id: BigInt(context.inventoryItemId), warehouse_id: BigInt(context.warehouseId), lot_id: null } })).quantity), 2);
  assert.equal(await prisma.stock_movement.count({ where: { reference_id: fixture.workOrder.work_order_id } }), 0);
});

test('rejects consumption above BOM requirement and cumulative over-consumption', { skip: !integration }, async () => {
  const fixture = await createProductionFixture({ componentQuantity: 1 });
  await resetStock(20);
  assert.equal((await consumeProduction(fixture, 5, { quantity: 6 })).status, 400);
  assert.equal((await consumeProduction(fixture, 3)).status, 200);
  assert.equal((await consumeProduction(fixture, 3)).status, 400);
  assert.equal(await prisma.stock_movement.count({ where: { reference_id: fixture.workOrder.work_order_id, movement_type: 'PRODUCTION_CONSUMPTION' } }), 1);
});

test('rejects invalid component, warehouse, or lot without stock changes', { skip: !integration }, async () => {
  const fixture = await createProductionFixture();
  await resetStock(10);
  const invalidComponent = await request(app).post(`/api/production/work-orders/${fixture.workOrder.work_order_id}/consume`).set('Authorization', context.auth).send({ production_quantity: 1, items: [{ inventory_item_id: context.lotInventoryItemId, uom: 'EA', warehouse_id: context.warehouseId, quantity: 1 }] });
  assert.equal(invalidComponent.status, 400);
  const invalidWarehouse = await consumeProduction(fixture, 1, { warehouse_id: '999999999' });
  assert.equal(invalidWarehouse.status, 400);
  const invalidLot = await consumeProduction(fixture, 1, { lot_id: '999999999' });
  assert.equal(invalidLot.status, 400);
  assert.equal(Number((await prisma.inventory_stock.findFirst({ where: { inventory_item_id: BigInt(context.inventoryItemId), warehouse_id: BigInt(context.warehouseId), lot_id: null } })).quantity), 10);
});

test('serializes concurrent consumption against stock and BOM limits', { skip: !integration }, async () => {
  const fixture = await createProductionFixture({ componentQuantity: 1 });
  await resetStock(5);
  const responses = await Promise.all([consumeProduction(fixture, 5), consumeProduction(fixture, 5)]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 400]);
  assert.equal(Number((await prisma.inventory_stock.findFirst({ where: { inventory_item_id: BigInt(context.inventoryItemId), warehouse_id: BigInt(context.warehouseId), lot_id: null } })).quantity), 0);
  assert.equal(await prisma.stock_movement.count({ where: { reference_id: fixture.workOrder.work_order_id, movement_type: 'PRODUCTION_CONSUMPTION' } }), 1);
});

test('posts finished-goods output and completes the production workflow', { skip: !integration }, async () => {
  const fixture = await createProductionFixture();
  await resetStock(10);
  assert.equal((await consumeProduction(fixture)).status, 200);
  const response = await outputProduction(fixture);
  assert.equal(response.status, 200);
  assert.equal(Number((await prisma.inventory_stock.findFirst({ where: { inventory_item_id: fixture.finishedItem.inventory_item_id, warehouse_id: BigInt(context.warehouseId), lot_id: null } })).quantity), 5);
  assert.equal(await prisma.stock_movement.count({ where: { reference_id: fixture.workOrder.work_order_id, movement_type: 'PRODUCTION_OUTPUT' } }), 1);
  assert.equal(await prisma.production_output.count({ where: { work_order_id: fixture.workOrder.work_order_id } }), 1);
  assert.equal((await prisma.work_order.findUnique({ where: { work_order_id: fixture.workOrder.work_order_id } })).status, 'COMPLETED');
  assert.equal((await prisma.production_order.findUnique({ where: { production_order_id: fixture.productionOrder.production_order_id } })).status, 'COMPLETED');
});

test('rejects output before consumption and above planned quantity', { skip: !integration }, async () => {
  const beforeConsumption = await createProductionFixture({ plannedQuantity: 5 });
  assert.equal((await outputProduction(beforeConsumption)).status, 409);
  const overPlanned = await createProductionFixture({ plannedQuantity: 5 });
  await resetStock(10);
  assert.equal((await consumeProduction(overPlanned, 5)).status, 200);
  assert.equal((await outputProduction(overPlanned, 6)).status, 400);
  assert.equal(await prisma.production_output.count({ where: { work_order_id: overPlanned.workOrder.work_order_id } }), 0);
});

test('rejects duplicate or concurrent output without duplicate movements', { skip: !integration }, async () => {
  const fixture = await createProductionFixture();
  await resetStock(10);
  assert.equal((await consumeProduction(fixture)).status, 200);
  const responses = await Promise.all([outputProduction(fixture), outputProduction(fixture)]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
  assert.equal(await prisma.production_output.count({ where: { work_order_id: fixture.workOrder.work_order_id } }), 1);
  assert.equal(await prisma.stock_movement.count({ where: { reference_id: fixture.workOrder.work_order_id, movement_type: 'PRODUCTION_OUTPUT' } }), 1);
});

test('validates ownership of lot-tracked finished-goods output', { skip: !integration }, async () => {
  const fixture = await createProductionFixture({ lotTrackedOutput: true });
  await resetStock(10);
  assert.equal((await consumeProduction(fixture)).status, 200);
  const wrongLot = await prisma.inventory_lot.create({ data: { inventory_item_id: BigInt(context.lotInventoryItemId), warehouse_id: BigInt(context.warehouseId), lot_number: `WRONG-OUTPUT-${Date.now()}`, quantity_received: 0, accepted_quantity: 0 } });
  const response = await outputProduction(fixture, 5, { lot_id: wrongLot.lot_id.toString() });
  assert.equal(response.status, 400);
  assert.equal(await prisma.production_output.count({ where: { work_order_id: fixture.workOrder.work_order_id } }), 0);
});

test('creates a draft delivery without changing stock', { skip: !integration }, async () => {
  await resetStock(10);
  const before = await prisma.inventory_stock.findFirst({ where: { inventory_item_id: BigInt(context.inventoryItemId), warehouse_id: BigInt(context.warehouseId), lot_id: null } });
  const fixture = await createDeliveryFixture({ quantity: 2, status: 'DISPATCHED' });
  assert.equal(fixture.response.body.data.status, 'DRAFT');
  const after = await prisma.inventory_stock.findUnique({ where: { inventory_stock_id: before.inventory_stock_id } });
  assert.equal(String(after.quantity), String(before.quantity));
  assert.equal(await prisma.stock_movement.count({ where: { reference_type: 'DELIVERY', reference_id: fixture.deliveryId } }), 0);
});

test('dispatches a delivery and creates one sale issue', { skip: !integration }, async () => {
  await resetStock(10);
  const fixture = await createDeliveryFixture({ quantity: 4 });
  const response = await dispatch(fixture.deliveryId);
  assert.equal(response.status, 200);
  assert.equal(response.body.data.status, 'DISPATCHED');
  const stock = await prisma.inventory_stock.findFirst({ where: { inventory_item_id: BigInt(context.inventoryItemId), warehouse_id: BigInt(context.warehouseId), lot_id: null } });
  assert.equal(Number(stock.quantity), 6);
  const movements = await prisma.stock_movement.findMany({ where: { reference_type: 'DELIVERY', reference_id: fixture.deliveryId, movement_type: 'SALE_ISSUE' } });
  assert.equal(movements.length, 1);
  assert.equal(Number(movements[0].quantity), 4);
});

test('blocks insufficient dispatch without changing stock or movements', { skip: !integration }, async () => {
  await resetStock(2);
  const fixture = await createDeliveryFixture({ quantity: 5 });
  const before = await prisma.inventory_stock.findFirst({ where: { inventory_item_id: BigInt(context.inventoryItemId), warehouse_id: BigInt(context.warehouseId), lot_id: null } });
  const response = await dispatch(fixture.deliveryId);
  assert.equal(response.status, 400);
  assert.match(response.body.error.message, /requested 5/);
  assert.match(response.body.error.message, /available 2/);
  assert.match(response.body.error.message, /shortage 3/);
  const after = await prisma.inventory_stock.findUnique({ where: { inventory_stock_id: before.inventory_stock_id } });
  assert.equal(String(after.quantity), String(before.quantity));
  assert.equal(await prisma.stock_movement.count({ where: { reference_type: 'DELIVERY', reference_id: fixture.deliveryId } }), 0);
});

test('rejects an explicit lot mismatch without changing stock', { skip: !integration }, async () => {
  await resetStock(10);
  const lot = await prisma.inventory_lot.create({ data: { inventory_item_id: BigInt(context.lotInventoryItemId), warehouse_id: BigInt(context.warehouseId), lot_number: `MISMATCH-${Date.now()}`, quantity_received: 10, accepted_quantity: 10 } });
  const fixture = await createDeliveryFixture({ quantity: 2, lotId: lot.lot_id.toString() });
  const response = await dispatch(fixture.deliveryId);
  assert.equal(response.status, 400);
  assert.match(response.body.error.message, /lot does not match/);
  const stock = await prisma.inventory_stock.findFirst({ where: { inventory_item_id: BigInt(context.inventoryItemId), warehouse_id: BigInt(context.warehouseId), lot_id: null } });
  assert.equal(Number(stock.quantity), 10);
});

test('rejects a customer-order link mismatch without changing stock', { skip: !integration }, async () => {
  await resetStock(10);
  const order = await request(app).post('/api/sales/orders').set('Authorization', context.auth).send({ order_number: `SO-LINK-${Date.now()}`, customer_id: context.customerId, items: [{ inventory_item_id: context.lotInventoryItemId, uom: 'EA', ordered_quantity: 2 }] });
  assert.equal(order.status, 201);
  const orderId = BigInt(order.body.data.customer_order_id);
  const orderItemId = order.body.data.customer_order_item[0].customer_order_item_id;
  context.created.orderIds.push(orderId);
  const fixture = await createDeliveryFixture({ customerOrderId: orderId.toString(), customerOrderItemId: orderItemId, quantity: 2 });
  const response = await dispatch(fixture.deliveryId);
  assert.equal(response.status, 400);
  assert.match(response.body.error.message, /customer-order item/);
  const stock = await prisma.inventory_stock.findFirst({ where: { inventory_item_id: BigInt(context.inventoryItemId), warehouse_id: BigInt(context.warehouseId), lot_id: null } });
  assert.equal(Number(stock.quantity), 10);
});

test('rejects a sales-invoice link mismatch without changing stock', { skip: !integration }, async () => {
  await resetStock(10);
  const invoice = await request(app).post('/api/sales/invoices').set('Authorization', context.auth).send({ invoice_number: `INV-LINK-${Date.now()}`, customer_id: context.customerId, items: [{ inventory_item_id: context.lotInventoryItemId, description: 'Mismatch', uom: 'EA', quantity: 2 }] });
  assert.equal(invoice.status, 201);
  const invoiceId = BigInt(invoice.body.data.sales_invoice_id);
  const invoiceItemId = invoice.body.data.sales_invoice_item[0].sales_invoice_item_id;
  context.created.invoiceIds.push(invoiceId);
  const fixture = await createDeliveryFixture({ salesInvoiceId: invoiceId.toString(), salesInvoiceItemId: invoiceItemId, quantity: 2 });
  const response = await dispatch(fixture.deliveryId);
  assert.equal(response.status, 400);
  assert.match(response.body.error.message, /sales-invoice item/);
  const stock = await prisma.inventory_stock.findFirst({ where: { inventory_item_id: BigInt(context.inventoryItemId), warehouse_id: BigInt(context.warehouseId), lot_id: null } });
  assert.equal(Number(stock.quantity), 10);
});

test('rejects duplicate dispatch without further deduction or movement', { skip: !integration }, async () => {
  await resetStock(10);
  const fixture = await createDeliveryFixture({ quantity: 4 });
  assert.equal((await dispatch(fixture.deliveryId)).status, 200);
  const second = await dispatch(fixture.deliveryId);
  assert.equal(second.status, 409);
  const stock = await prisma.inventory_stock.findFirst({ where: { inventory_item_id: BigInt(context.inventoryItemId), warehouse_id: BigInt(context.warehouseId), lot_id: null } });
  assert.equal(Number(stock.quantity), 6);
  assert.equal(await prisma.stock_movement.count({ where: { reference_type: 'DELIVERY', reference_id: fixture.deliveryId, movement_type: 'SALE_ISSUE' } }), 1);
});

test('serializes simultaneous dispatch requests for one delivery', { skip: !integration }, async () => {
  await resetStock(10);
  const fixture = await createDeliveryFixture({ quantity: 4 });
  const responses = await Promise.all([dispatch(fixture.deliveryId), dispatch(fixture.deliveryId)]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
  const stock = await prisma.inventory_stock.findFirst({ where: { inventory_item_id: BigInt(context.inventoryItemId), warehouse_id: BigInt(context.warehouseId), lot_id: null } });
  assert.equal(Number(stock.quantity), 6);
  assert.equal(await prisma.stock_movement.count({ where: { reference_type: 'DELIVERY', reference_id: fixture.deliveryId, movement_type: 'SALE_ISSUE' } }), 1);
});

test('serializes simultaneous deliveries consuming one stock balance', { skip: !integration }, async () => {
  await resetStock(5);
  const first = await createDeliveryFixture({ quantity: 4 });
  const second = await createDeliveryFixture({ quantity: 4 });
  const responses = await Promise.all([dispatch(first.deliveryId), dispatch(second.deliveryId)]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 400]);
  const stock = await prisma.inventory_stock.findFirst({ where: { inventory_item_id: BigInt(context.inventoryItemId), warehouse_id: BigInt(context.warehouseId), lot_id: null } });
  assert.equal(Number(stock.quantity), 1);
  assert.equal(await prisma.stock_movement.count({ where: { reference_type: 'DELIVERY', reference_id: { in: [first.deliveryId, second.deliveryId] }, movement_type: 'SALE_ISSUE' } }), 1);
});

test('rejects a delivery whose customer differs from its customer order', { skip: !integration }, async () => {
  await resetStock(10);
  const order = await request(app).post('/api/sales/orders').set('Authorization', context.auth).send({ order_number: `SO-CUSTOMER-${Date.now()}`, customer_id: context.otherCustomerId, items: [{ inventory_item_id: context.inventoryItemId, uom: 'EA', ordered_quantity: 5 }] });
  assert.equal(order.status, 201);
  const orderId = BigInt(order.body.data.customer_order_id);
  const orderItemId = order.body.data.customer_order_item[0].customer_order_item_id;
  context.created.orderIds.push(orderId);
  const fixture = await createDeliveryFixture({ customerOrderId: orderId.toString(), customerOrderItemId: orderItemId, quantity: 2 });
  const response = await dispatch(fixture.deliveryId);
  assert.equal(response.status, 400);
  assert.match(response.body.error.message, /customer-order customer/);
  const delivery = await prisma.delivery.findUnique({ where: { delivery_id: fixture.deliveryId } });
  const stock = await prisma.inventory_stock.findFirst({ where: { inventory_item_id: BigInt(context.inventoryItemId), warehouse_id: BigInt(context.warehouseId), lot_id: null } });
  assert.equal(delivery.status, 'DRAFT');
  assert.equal(Number(stock.quantity), 10);
  assert.equal(await prisma.stock_movement.count({ where: { reference_type: 'DELIVERY', reference_id: fixture.deliveryId } }), 0);
});

test('rejects a delivery whose customer differs from its sales invoice', { skip: !integration }, async () => {
  await resetStock(10);
  const invoice = await request(app).post('/api/sales/invoices').set('Authorization', context.auth).send({ invoice_number: `INV-CUSTOMER-${Date.now()}`, customer_id: context.otherCustomerId, items: [{ inventory_item_id: context.inventoryItemId, description: 'Customer mismatch', uom: 'EA', quantity: 5 }] });
  assert.equal(invoice.status, 201);
  const invoiceId = BigInt(invoice.body.data.sales_invoice_id);
  const invoiceItemId = invoice.body.data.sales_invoice_item[0].sales_invoice_item_id;
  context.created.invoiceIds.push(invoiceId);
  const fixture = await createDeliveryFixture({ salesInvoiceId: invoiceId.toString(), salesInvoiceItemId: invoiceItemId, quantity: 2 });
  const response = await dispatch(fixture.deliveryId);
  assert.equal(response.status, 400);
  assert.match(response.body.error.message, /sales-invoice customer/);
  const delivery = await prisma.delivery.findUnique({ where: { delivery_id: fixture.deliveryId } });
  const stock = await prisma.inventory_stock.findFirst({ where: { inventory_item_id: BigInt(context.inventoryItemId), warehouse_id: BigInt(context.warehouseId), lot_id: null } });
  assert.equal(delivery.status, 'DRAFT');
  assert.equal(Number(stock.quantity), 10);
  assert.equal(await prisma.stock_movement.count({ where: { reference_type: 'DELIVERY', reference_id: fixture.deliveryId } }), 0);
});

test('rejects linked order and invoice records belonging to different customers', { skip: !integration }, async () => {
  await resetStock(10);
  const order = await request(app).post('/api/sales/orders').set('Authorization', context.auth).send({ order_number: `SO-BOTH-CUSTOMER-${Date.now()}`, customer_id: context.customerId, items: [{ inventory_item_id: context.inventoryItemId, uom: 'EA', ordered_quantity: 5 }] });
  const invoice = await request(app).post('/api/sales/invoices').set('Authorization', context.auth).send({ invoice_number: `INV-BOTH-CUSTOMER-${Date.now()}`, customer_id: context.otherCustomerId, items: [{ inventory_item_id: context.inventoryItemId, description: 'Different customer', uom: 'EA', quantity: 5 }] });
  assert.equal(order.status, 201);
  assert.equal(invoice.status, 201);
  const orderId = BigInt(order.body.data.customer_order_id);
  const invoiceId = BigInt(invoice.body.data.sales_invoice_id);
  context.created.orderIds.push(orderId);
  context.created.invoiceIds.push(invoiceId);
  const fixture = await createDeliveryFixture({ customerOrderId: orderId.toString(), customerOrderItemId: order.body.data.customer_order_item[0].customer_order_item_id, salesInvoiceId: invoiceId.toString(), salesInvoiceItemId: invoice.body.data.sales_invoice_item[0].sales_invoice_item_id, quantity: 2 });
  const response = await dispatch(fixture.deliveryId);
  assert.equal(response.status, 400);
  assert.match(response.body.error.message, /sales-invoice customer/);
  const delivery = await prisma.delivery.findUnique({ where: { delivery_id: fixture.deliveryId } });
  assert.equal(delivery.status, 'DRAFT');
  assert.equal(await prisma.stock_movement.count({ where: { reference_type: 'DELIVERY', reference_id: fixture.deliveryId } }), 0);
});

test('dispatches exactly the customer order line quantity', { skip: !integration }, async () => {
  await resetStock(10);
  const order = await request(app).post('/api/sales/orders').set('Authorization', context.auth).send({ order_number: `SO-EXACT-${Date.now()}`, customer_id: context.customerId, items: [{ inventory_item_id: context.inventoryItemId, uom: 'EA', ordered_quantity: 5 }] });
  assert.equal(order.status, 201);
  const orderId = BigInt(order.body.data.customer_order_id);
  const orderItemId = order.body.data.customer_order_item[0].customer_order_item_id;
  context.created.orderIds.push(orderId);
  const fixture = await createDeliveryFixture({ customerOrderId: orderId.toString(), customerOrderItemId: orderItemId, quantity: 5 });
  assert.equal((await dispatch(fixture.deliveryId)).status, 200);
  const delivered = await prisma.delivery_item.aggregate({ where: { customer_order_item_id: BigInt(orderItemId), delivery: { status: { in: ['DISPATCHED', 'DELIVERED'] } } }, _sum: { delivered_quantity: true } });
  assert.equal(Number(delivered._sum.delivered_quantity), 5);
});

test('rejects an order over-delivery without changing stock', { skip: !integration }, async () => {
  await resetStock(10);
  const order = await request(app).post('/api/sales/orders').set('Authorization', context.auth).send({ order_number: `SO-OVER-${Date.now()}`, customer_id: context.customerId, items: [{ inventory_item_id: context.inventoryItemId, uom: 'EA', ordered_quantity: 5 }] });
  assert.equal(order.status, 201);
  const orderId = BigInt(order.body.data.customer_order_id);
  const orderItemId = order.body.data.customer_order_item[0].customer_order_item_id;
  context.created.orderIds.push(orderId);
  const first = await createDeliveryFixture({ customerOrderId: orderId.toString(), customerOrderItemId: orderItemId, quantity: 4 });
  assert.equal((await dispatch(first.deliveryId)).status, 200);
  const second = await createDeliveryFixture({ customerOrderId: orderId.toString(), customerOrderItemId: orderItemId, quantity: 2 });
  const before = await prisma.inventory_stock.findFirst({ where: { inventory_item_id: BigInt(context.inventoryItemId), warehouse_id: BigInt(context.warehouseId), lot_id: null } });
  const response = await dispatch(second.deliveryId);
  assert.equal(response.status, 400);
  assert.match(response.body.error.message, /ordered_quantity 5/);
  assert.match(response.body.error.message, /previously dispatched 4/);
  assert.match(response.body.error.message, /current requested 2/);
  assert.match(response.body.error.message, /excess 1/);
  const after = await prisma.inventory_stock.findUnique({ where: { inventory_stock_id: before.inventory_stock_id } });
  assert.equal(String(after.quantity), String(before.quantity));
  assert.equal((await prisma.delivery.findUnique({ where: { delivery_id: second.deliveryId } })).status, 'DRAFT');
});

test('dispatches exactly the sales invoice line quantity', { skip: !integration }, async () => {
  await resetStock(10);
  const invoice = await request(app).post('/api/sales/invoices').set('Authorization', context.auth).send({ invoice_number: `INV-EXACT-${Date.now()}`, customer_id: context.customerId, items: [{ inventory_item_id: context.inventoryItemId, description: 'Exact', uom: 'EA', quantity: 5 }] });
  assert.equal(invoice.status, 201);
  const invoiceId = BigInt(invoice.body.data.sales_invoice_id);
  const invoiceItemId = invoice.body.data.sales_invoice_item[0].sales_invoice_item_id;
  context.created.invoiceIds.push(invoiceId);
  const fixture = await createDeliveryFixture({ salesInvoiceId: invoiceId.toString(), salesInvoiceItemId: invoiceItemId, quantity: 5 });
  assert.equal((await dispatch(fixture.deliveryId)).status, 200);
  const delivered = await prisma.delivery_item.aggregate({ where: { sales_invoice_item_id: BigInt(invoiceItemId), delivery: { status: { in: ['DISPATCHED', 'DELIVERED'] } } }, _sum: { delivered_quantity: true } });
  assert.equal(Number(delivered._sum.delivered_quantity), 5);
});

test('rejects an invoice over-delivery without changing stock', { skip: !integration }, async () => {
  await resetStock(10);
  const invoice = await request(app).post('/api/sales/invoices').set('Authorization', context.auth).send({ invoice_number: `INV-OVER-${Date.now()}`, customer_id: context.customerId, items: [{ inventory_item_id: context.inventoryItemId, description: 'Over', uom: 'EA', quantity: 5 }] });
  assert.equal(invoice.status, 201);
  const invoiceId = BigInt(invoice.body.data.sales_invoice_id);
  const invoiceItemId = invoice.body.data.sales_invoice_item[0].sales_invoice_item_id;
  context.created.invoiceIds.push(invoiceId);
  const first = await createDeliveryFixture({ salesInvoiceId: invoiceId.toString(), salesInvoiceItemId: invoiceItemId, quantity: 4 });
  assert.equal((await dispatch(first.deliveryId)).status, 200);
  const second = await createDeliveryFixture({ salesInvoiceId: invoiceId.toString(), salesInvoiceItemId: invoiceItemId, quantity: 2 });
  const before = await prisma.inventory_stock.findFirst({ where: { inventory_item_id: BigInt(context.inventoryItemId), warehouse_id: BigInt(context.warehouseId), lot_id: null } });
  const response = await dispatch(second.deliveryId);
  assert.equal(response.status, 400);
  assert.match(response.body.error.message, /quantity 5/);
  assert.match(response.body.error.message, /previously dispatched 4/);
  assert.match(response.body.error.message, /current requested 2/);
  assert.match(response.body.error.message, /excess 1/);
  const after = await prisma.inventory_stock.findUnique({ where: { inventory_stock_id: before.inventory_stock_id } });
  assert.equal(String(after.quantity), String(before.quantity));
});

test('serializes simultaneous deliveries for one customer order line', { skip: !integration }, async () => {
  await resetStock(10);
  const order = await request(app).post('/api/sales/orders').set('Authorization', context.auth).send({ order_number: `SO-CONCURRENT-LIMIT-${Date.now()}`, customer_id: context.customerId, items: [{ inventory_item_id: context.inventoryItemId, uom: 'EA', ordered_quantity: 5 }] });
  assert.equal(order.status, 201);
  const orderId = BigInt(order.body.data.customer_order_id);
  const orderItemId = order.body.data.customer_order_item[0].customer_order_item_id;
  context.created.orderIds.push(orderId);
  const first = await createDeliveryFixture({ customerOrderId: orderId.toString(), customerOrderItemId: orderItemId, quantity: 4 });
  const second = await createDeliveryFixture({ customerOrderId: orderId.toString(), customerOrderItemId: orderItemId, quantity: 4 });
  const responses = await Promise.all([dispatch(first.deliveryId), dispatch(second.deliveryId)]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 400]);
  const delivered = await prisma.delivery_item.aggregate({ where: { customer_order_item_id: BigInt(orderItemId), delivery: { status: { in: ['DISPATCHED', 'DELIVERED'] } } }, _sum: { delivered_quantity: true } });
  assert.equal(Number(delivered._sum.delivered_quantity), 4);
});

test('serializes simultaneous deliveries for one sales invoice line', { skip: !integration }, async () => {
  await resetStock(10);
  const invoice = await request(app).post('/api/sales/invoices').set('Authorization', context.auth).send({ invoice_number: `INV-CONCURRENT-LIMIT-${Date.now()}`, customer_id: context.customerId, items: [{ inventory_item_id: context.inventoryItemId, description: 'Concurrent', uom: 'EA', quantity: 5 }] });
  assert.equal(invoice.status, 201);
  const invoiceId = BigInt(invoice.body.data.sales_invoice_id);
  const invoiceItemId = invoice.body.data.sales_invoice_item[0].sales_invoice_item_id;
  context.created.invoiceIds.push(invoiceId);
  const first = await createDeliveryFixture({ salesInvoiceId: invoiceId.toString(), salesInvoiceItemId: invoiceItemId, quantity: 4 });
  const second = await createDeliveryFixture({ salesInvoiceId: invoiceId.toString(), salesInvoiceItemId: invoiceItemId, quantity: 4 });
  const responses = await Promise.all([dispatch(first.deliveryId), dispatch(second.deliveryId)]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 400]);
  const delivered = await prisma.delivery_item.aggregate({ where: { sales_invoice_item_id: BigInt(invoiceItemId), delivery: { status: { in: ['DISPATCHED', 'DELIVERED'] } } }, _sum: { delivered_quantity: true } });
  assert.equal(Number(delivered._sum.delivered_quantity), 4);
});

async function createReceiptFixture(orderedQuantity, receivedQuantity, options = {}) {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const purchaseOrderItem = { inventory_item_id: options.purchaseOrderInventoryItemId || context.inventoryItemId, uom: options.purchaseOrderUom || 'EA', ordered_quantity: orderedQuantity };
  const purchaseOrder = await request(app).post('/api/procurement/purchase-orders').set('Authorization', context.auth).send({ po_number: `PO-GRN-${suffix}`, vendor_id: options.purchaseOrderVendorId || context.vendorId, items: [purchaseOrderItem] });
  assert.equal(purchaseOrder.status, 201);
  const purchaseOrderId = BigInt(purchaseOrder.body.data.purchase_order_id);
  const purchaseOrderItemId = purchaseOrder.body.data.purchase_order_item[0].purchase_order_item_id;
  context.created.purchaseOrderIds.push(purchaseOrderId);
  const grnItem = { purchase_order_item_id: purchaseOrderItemId, inventory_item_id: options.grnInventoryItemId || purchaseOrderItem.inventory_item_id, uom: options.grnUom || purchaseOrderItem.uom, received_quantity: receivedQuantity, lot_id: options.lotId, accepted_quantity: options.acceptedQuantity, rejected_quantity: options.rejectedQuantity, rejection_reason: options.rejectionReason };
  const grn = await request(app).post('/api/procurement/grns').set('Authorization', context.auth).send({ grn_number: `GRN-${suffix}`, purchase_order_id: purchaseOrderId.toString(), vendor_id: options.grnVendorId || options.purchaseOrderVendorId || context.vendorId, warehouse_id: context.warehouseId, items: [grnItem] });
  assert.equal(grn.status, 201);
  const grnId = BigInt(grn.body.data.grn_id);
  context.created.grnIds.push(grnId);
  return { purchaseOrderId, grnId, grnItemId: BigInt(grn.body.data.grn_item[0].grn_item_id) };
}

test('persists accepted and rejected quantities with rejection reason', { skip: !integration }, async () => {
  const fixture = await createReceiptFixture(100, 100, { acceptedQuantity: 80, rejectedQuantity: 20, rejectionReason: 'Damaged material' });
  const before = await prisma.inventory_stock.findFirst({ where: { inventory_item_id: BigInt(context.inventoryItemId), warehouse_id: BigInt(context.warehouseId), lot_id: null } });
  const beforeMovements = await prisma.stock_movement.count({ where: { reference_id: fixture.grnId, movement_type: 'PURCHASE_RECEIPT' } });
  const response = await request(app).post(`/api/procurement/grns/${fixture.grnId}/post`).set('Authorization', context.auth).send({ inspection_status: 'PARTIAL', items: [{ grn_item_id: fixture.grnItemId.toString(), accepted_quantity: 80, rejected_quantity: 20, rejection_reason: 'Damaged material' }] });
  assert.equal(response.status, 200);
  const grnItem = await prisma.grn_item.findUnique({ where: { grn_item_id: fixture.grnItemId } });
  const after = await prisma.inventory_stock.findFirst({ where: { inventory_item_id: BigInt(context.inventoryItemId), warehouse_id: BigInt(context.warehouseId), lot_id: null } });
  assert.equal(Number(grnItem.received_quantity), 100);
  assert.equal(Number(grnItem.accepted_quantity), 80);
  assert.equal(Number(grnItem.rejected_quantity), 20);
  assert.equal(grnItem.rejection_reason, 'Damaged material');
  assert.equal(Number(after?.quantity || 0) - Number(before?.quantity || 0), 80);
  assert.equal(await prisma.stock_movement.count({ where: { reference_id: fixture.grnId, movement_type: 'PURCHASE_RECEIPT' } }), beforeMovements + 1);
});

test('rejects a PO-linked GRN with an unlinked item', { skip: !integration }, async () => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const purchaseOrder = await request(app).post('/api/procurement/purchase-orders').set('Authorization', context.auth).send({ po_number: `PO-UNLINKED-${suffix}`, vendor_id: context.vendorId, items: [{ inventory_item_id: context.inventoryItemId, uom: 'EA', ordered_quantity: 5 }] });
  assert.equal(purchaseOrder.status, 201);
  const purchaseOrderId = BigInt(purchaseOrder.body.data.purchase_order_id);
  context.created.purchaseOrderIds.push(purchaseOrderId);
  const response = await request(app).post('/api/procurement/grns').set('Authorization', context.auth).send({ grn_number: `GRN-UNLINKED-${suffix}`, purchase_order_id: purchaseOrderId.toString(), vendor_id: context.vendorId, warehouse_id: context.warehouseId, items: [{ inventory_item_id: context.inventoryItemId, uom: 'EA', received_quantity: 5 }] });
  assert.equal(response.status, 400);
  assert.match(response.body.error.message, /PO-linked GRN items must reference a purchase order item/);
});

test('supports a non-PO GRN', { skip: !integration }, async () => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const grn = await request(app).post('/api/procurement/grns').set('Authorization', context.auth).send({ grn_number: `GRN-NO-PO-${suffix}`, vendor_id: context.vendorId, warehouse_id: context.warehouseId, items: [{ inventory_item_id: context.inventoryItemId, uom: 'EA', received_quantity: 5 }] });
  assert.equal(grn.status, 201);
  context.created.grnIds.push(BigInt(grn.body.data.grn_id));
});

test('rejects rejected quantity whose sum exceeds received quantity', { skip: !integration }, async () => {
  const fixture = await createReceiptFixture(100, 100);
  const response = await request(app).post(`/api/procurement/grns/${fixture.grnId}/post`).set('Authorization', context.auth).send({ inspection_status: 'PARTIAL', items: [{ grn_item_id: fixture.grnItemId.toString(), accepted_quantity: 80, rejected_quantity: 21 }] });
  assert.equal(response.status, 400);
  assert.match(response.body.error.message, /must equal received_quantity/);
});

test('rejects rejected quantity whose sum is below received quantity', { skip: !integration }, async () => {
  const fixture = await createReceiptFixture(100, 100);
  const response = await request(app).post(`/api/procurement/grns/${fixture.grnId}/post`).set('Authorization', context.auth).send({ inspection_status: 'PARTIAL', items: [{ grn_item_id: fixture.grnItemId.toString(), accepted_quantity: 80, rejected_quantity: 19 }] });
  assert.equal(response.status, 400);
  assert.match(response.body.error.message, /must equal received_quantity/);
});

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

test('serializes concurrent GRN posting so only one request succeeds', { skip: !integration }, async () => {
  const fixture = await createReceiptFixture(5, 5);
  const before = await prisma.inventory_stock.findFirst({ where: { inventory_item_id: BigInt(context.inventoryItemId), warehouse_id: BigInt(context.warehouseId), lot_id: null } });
  const responses = await Promise.all([
    request(app).post(`/api/procurement/grns/${fixture.grnId}/post`).set('Authorization', context.auth).send({ inspection_status: 'PASSED', items: [{ grn_item_id: fixture.grnItemId.toString(), accepted_quantity: 5 }] }),
    request(app).post(`/api/procurement/grns/${fixture.grnId}/post`).set('Authorization', context.auth).send({ inspection_status: 'PASSED', items: [{ grn_item_id: fixture.grnItemId.toString(), accepted_quantity: 5 }] })
  ]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
  const after = await prisma.inventory_stock.findFirst({ where: { inventory_item_id: BigInt(context.inventoryItemId), warehouse_id: BigInt(context.warehouseId), lot_id: null } });
  assert.equal(Number(after.quantity) - Number(before?.quantity || 0), 5);
  assert.equal(await prisma.stock_movement.count({ where: { reference_type: 'GRN', reference_id: fixture.grnId, movement_type: 'PURCHASE_RECEIPT' } }), 1);
});

async function createConcurrentReceiptFixtures({ lotId, inventoryItemId = context.inventoryItemId, orderedQuantity = 10 }) {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const purchaseOrder = await request(app).post('/api/procurement/purchase-orders').set('Authorization', context.auth).send({ po_number: `PO-CONCURRENT-${suffix}`, vendor_id: context.vendorId, items: [{ inventory_item_id: inventoryItemId, uom: 'EA', ordered_quantity: orderedQuantity }] });
  assert.equal(purchaseOrder.status, 201);
  const purchaseOrderId = BigInt(purchaseOrder.body.data.purchase_order_id);
  const purchaseOrderItemId = purchaseOrder.body.data.purchase_order_item[0].purchase_order_item_id;
  context.created.purchaseOrderIds.push(purchaseOrderId);
  const grnIds = [];
  for (const [index, receivedQuantity] of [4, 6].entries()) {
    const grn = await request(app).post('/api/procurement/grns').set('Authorization', context.auth).send({ grn_number: `GRN-CONCURRENT-${suffix}-${index}`, purchase_order_id: purchaseOrderId.toString(), vendor_id: context.vendorId, warehouse_id: context.warehouseId, items: [{ purchase_order_item_id: purchaseOrderItemId, inventory_item_id: inventoryItemId, uom: 'EA', received_quantity: receivedQuantity, lot_id: lotId }] });
    assert.equal(grn.status, 201);
    const grnId = BigInt(grn.body.data.grn_id);
    context.created.grnIds.push(grnId);
    grnIds.push({ grnId, grnItemId: BigInt(grn.body.data.grn_item[0].grn_item_id), acceptedQuantity: receivedQuantity });
  }
  return { grnIds, inventoryItemId: BigInt(inventoryItemId), warehouseId: BigInt(context.warehouseId), lotId: lotId === undefined ? null : BigInt(lotId) };
}

test('posts different no-lot GRNs concurrently into one stock row', { skip: !integration }, async () => {
  const fixture = await createConcurrentReceiptFixtures({});
  const before = await prisma.inventory_stock.findMany({ where: { inventory_item_id: fixture.inventoryItemId, warehouse_id: fixture.warehouseId, lot_id: null } });
  const responses = await Promise.all(fixture.grnIds.map((item) => request(app).post(`/api/procurement/grns/${item.grnId}/post`).set('Authorization', context.auth).send({ inspection_status: 'PASSED', items: [{ grn_item_id: item.grnItemId.toString(), accepted_quantity: item.acceptedQuantity }] })));
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 200]);
  const after = await prisma.inventory_stock.findMany({ where: { inventory_item_id: fixture.inventoryItemId, warehouse_id: fixture.warehouseId, lot_id: null } });
  assert.equal(after.length, 1);
  assert.equal(Number(after[0].quantity) - Number(before[0]?.quantity || 0), 10);
  for (const item of fixture.grnIds) assert.equal(await prisma.stock_movement.count({ where: { reference_type: 'GRN', reference_id: item.grnId, movement_type: 'PURCHASE_RECEIPT' } }), 1);
});

test('posts different same-lot GRNs concurrently into one stock row', { skip: !integration }, async () => {
  const lot = await prisma.inventory_lot.create({ data: { inventory_item_id: BigInt(context.lotInventoryItemId), warehouse_id: BigInt(context.warehouseId), lot_number: `CONCURRENT-LOT-${Date.now()}`, heat_number: 'CONCURRENT-HEAT', quantity_received: 0, accepted_quantity: 0 } });
  const fixture = await createConcurrentReceiptFixtures({ lotId: lot.lot_id.toString(), inventoryItemId: context.lotInventoryItemId });
  const before = await prisma.inventory_stock.findMany({ where: { inventory_item_id: fixture.inventoryItemId, warehouse_id: fixture.warehouseId, lot_id: fixture.lotId } });
  const responses = await Promise.all(fixture.grnIds.map((item) => request(app).post(`/api/procurement/grns/${item.grnId}/post`).set('Authorization', context.auth).send({ inspection_status: 'PASSED', items: [{ grn_item_id: item.grnItemId.toString(), accepted_quantity: item.acceptedQuantity }] })));
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 200]);
  const after = await prisma.inventory_stock.findMany({ where: { inventory_item_id: fixture.inventoryItemId, warehouse_id: fixture.warehouseId, lot_id: fixture.lotId } });
  assert.equal(after.length, 1);
  assert.equal(Number(after[0].quantity) - Number(before[0]?.quantity || 0), 10);
  for (const item of fixture.grnIds) assert.equal(await prisma.stock_movement.count({ where: { reference_type: 'GRN', reference_id: item.grnId, movement_type: 'PURCHASE_RECEIPT' } }), 1);
});

test('rejects an existing lot owned by a different item without changing it', { skip: !integration }, async () => {
  const wrongLot = await prisma.inventory_lot.create({ data: { inventory_item_id: BigInt(context.inventoryItemId), warehouse_id: BigInt(context.warehouseId), lot_number: `WRONG-LOT-${Date.now()}`, heat_number: 'WRONG-HEAT', quantity_received: 10, accepted_quantity: 10 } });
  const fixture = await createReceiptFixture(5, 5, { purchaseOrderInventoryItemId: context.lotInventoryItemId, grnInventoryItemId: context.lotInventoryItemId, lotId: wrongLot.lot_id.toString() });
  const beforeLot = await prisma.inventory_lot.findUnique({ where: { lot_id: wrongLot.lot_id } });
  const beforeStock = await prisma.inventory_stock.count({ where: { inventory_item_id: BigInt(context.lotInventoryItemId), warehouse_id: BigInt(context.warehouseId) } });
  const response = await request(app).post(`/api/procurement/grns/${fixture.grnId}/post`).set('Authorization', context.auth).send({ inspection_status: 'PASSED', items: [{ grn_item_id: fixture.grnItemId.toString(), accepted_quantity: 5 }] });
  assert.equal(response.status, 400);
  const afterLot = await prisma.inventory_lot.findUnique({ where: { lot_id: wrongLot.lot_id } });
  assert.equal(String(afterLot.quantity_received), String(beforeLot.quantity_received));
  assert.equal(String(afterLot.accepted_quantity), String(beforeLot.accepted_quantity));
  assert.equal(await prisma.inventory_stock.count({ where: { inventory_item_id: BigInt(context.lotInventoryItemId), warehouse_id: BigInt(context.warehouseId) } }), beforeStock);
});

test('rejects a GRN whose vendor differs from its purchase order', { skip: !integration }, async () => {
  const fixture = await createReceiptFixture(5, 5, { grnVendorId: context.otherVendorId });
  const response = await request(app).post(`/api/procurement/grns/${fixture.grnId}/post`).set('Authorization', context.auth).send({ inspection_status: 'PASSED', items: [{ grn_item_id: fixture.grnItemId.toString(), accepted_quantity: 5 }] });
  assert.equal(response.status, 400);
  const grn = await prisma.grn.findUnique({ where: { grn_id: fixture.grnId } });
  assert.equal(grn.inspection_status, 'PENDING');
});

test('rejects a GRN line whose item differs from its purchase order line', { skip: !integration }, async () => {
  const fixture = await createReceiptFixture(5, 5, { grnInventoryItemId: context.lotInventoryItemId });
  const response = await request(app).post(`/api/procurement/grns/${fixture.grnId}/post`).set('Authorization', context.auth).send({ inspection_status: 'PASSED', items: [{ grn_item_id: fixture.grnItemId.toString(), accepted_quantity: 5 }] });
  assert.equal(response.status, 400);
  const movementCount = await prisma.stock_movement.count({ where: { reference_id: fixture.grnId } });
  assert.equal(movementCount, 0);
});

test('rejects a GRN line whose UOM differs from its purchase order line', { skip: !integration }, async () => {
  const fixture = await createReceiptFixture(5, 5, { grnUom: 'KG' });
  const response = await request(app).post(`/api/procurement/grns/${fixture.grnId}/post`).set('Authorization', context.auth).send({ inspection_status: 'PASSED', items: [{ grn_item_id: fixture.grnItemId.toString(), accepted_quantity: 5 }] });
  assert.equal(response.status, 400);
  const grn = await prisma.grn.findUnique({ where: { grn_id: fixture.grnId } });
  assert.equal(grn.inspection_status, 'PENDING');
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
