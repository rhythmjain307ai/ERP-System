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
async function stock(quantity, item = context.inventoryItemId, lot = null) {
  return prisma.inventory_stock.create({ data: { inventory_item_id: BigInt(item), warehouse_id: BigInt(context.warehouseId), lot_id: lot && BigInt(lot), quantity, reserved_quantity: 0 } });
}
async function order(quantity = '5', confirm = true, item = context.inventoryItemId) {
  const response = await post('orders', { order_number: `SO-3C-${Date.now()}-${Math.random()}`, customer_id: context.customerId, items: [{ inventory_item_id: item, uom: 'EA', ordered_quantity: quantity, unit_rate: '10' }] });
  assert.equal(response.status, 201); const id = response.body.data.customer_order_id; context.created.orderIds.push(BigInt(id));
  if (confirm) assert.equal((await post(`orders/${id}/confirm`)).status, 200);
  return { id, itemId: response.body.data.customer_order_item[0].customer_order_item_id };
}
async function delivery(orderRow, quantity, overrides = {}) {
  const response = await post('deliveries', { delivery_number: `DEL-3C-${Date.now()}-${Math.random()}`, customer_id: context.customerId, customer_order_id: orderRow?.id,
    warehouse_id: context.warehouseId, items: [{ customer_order_item_id: orderRow?.itemId, inventory_item_id: overrides.inventory_item_id || context.inventoryItemId, lot_id: overrides.lot_id, uom: 'EA', delivered_quantity: quantity }] });
  assert.equal(response.status, 201); const id = response.body.data.delivery_id; context.created.deliveryIds.push(BigInt(id)); return id;
}

test('partial then full dispatch updates order fulfillment and inventory exactly', { skip: !integration }, async () => {
  await stock('10'); const so = await order('5');
  const first = await delivery(so, '2'); assert.equal((await post(`deliveries/${first}/dispatch`)).status, 200);
  assert.equal((await prisma.customer_order.findUnique({ where: { customer_order_id: BigInt(so.id) } })).status, 'PARTIALLY_FULFILLED');
  const second = await delivery(so, '3'); assert.equal((await post(`deliveries/${second}/dispatch`)).status, 200);
  assert.equal((await prisma.customer_order.findUnique({ where: { customer_order_id: BigInt(so.id) } })).status, 'FULFILLED');
  assert.equal((await prisma.inventory_stock.findFirst({ where: { inventory_item_id: BigInt(context.inventoryItemId), warehouse_id: BigInt(context.warehouseId), lot_id: null } })).quantity.toString(), '5');
  assert.equal(await prisma.stock_movement.count({ where: { movement_type: 'SALE_ISSUE', reference_id: { in: [BigInt(first), BigInt(second)] } } }), 2);
});

test('unconfirmed order cannot dispatch and leaves stock untouched', { skip: !integration }, async () => {
  await stock('10'); const so = await order('5', false); const id = await delivery(so, '2');
  assert.equal((await post(`deliveries/${id}/dispatch`)).status, 409);
  assert.equal((await prisma.delivery.findUnique({ where: { delivery_id: BigInt(id) } })).status, 'DRAFT');
  assert.equal((await prisma.inventory_stock.findFirst({ where: { inventory_item_id: BigInt(context.inventoryItemId), warehouse_id: BigInt(context.warehouseId), lot_id: null } })).quantity.toString(), '10');
  assert.equal(await prisma.stock_movement.count({ where: { reference_type: 'DELIVERY', reference_id: BigInt(id) } }), 0);
});

test('lot-tracked dispatch requires an OPEN lot for the item and warehouse', { skip: !integration }, async () => {
  const lot = await prisma.inventory_lot.create({ data: { inventory_item_id: BigInt(context.lotInventoryItemId), warehouse_id: BigInt(context.warehouseId), lot_number: `LOT-3C-${Date.now()}`, quantity_received: 5, accepted_quantity: 5 } });
  await stock('5', context.lotInventoryItemId, lot.lot_id.toString()); const so = await order('2', true, context.lotInventoryItemId);
  const missing = await delivery(so, '1', { inventory_item_id: context.lotInventoryItemId });
  assert.equal((await post(`deliveries/${missing}/dispatch`)).status, 400);
  const valid = await delivery(so, '2', { inventory_item_id: context.lotInventoryItemId, lot_id: lot.lot_id.toString() });
  assert.equal((await post(`deliveries/${valid}/dispatch`)).status, 200);
});

test('audit failure rolls back stock, movement, delivery and order status', { skip: !integration }, async () => {
  await stock('10'); const so = await order('5'); const id = await delivery(so, '2');
  const original = prisma.$transaction, run = original.bind(prisma);
  prisma.$transaction = callback => run(tx => callback(new Proxy(tx, { get(target, key) {
    if (key === 'audit_log') return { create: async () => { throw new Error('Injected dispatch audit failure'); } };
    return target[key];
  } })));
  try { assert.equal((await post(`deliveries/${id}/dispatch`)).status, 500); } finally { prisma.$transaction = original; }
  assert.equal((await prisma.delivery.findUnique({ where: { delivery_id: BigInt(id) } })).status, 'DRAFT');
  assert.equal((await prisma.customer_order.findUnique({ where: { customer_order_id: BigInt(so.id) } })).status, 'OPEN');
  assert.equal((await prisma.inventory_stock.findFirst({ where: { inventory_item_id: BigInt(context.inventoryItemId), warehouse_id: BigInt(context.warehouseId), lot_id: null } })).quantity.toString(), '10');
  assert.equal(await prisma.stock_movement.count({ where: { reference_type: 'DELIVERY', reference_id: BigInt(id) } }), 0);
});
