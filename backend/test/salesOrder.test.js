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

function send(method, path, body) { return request(app)[method](`/api/sales/${path}`).set('Authorization', context.auth).send(body); }
async function create(overrides = {}) {
  const body = { order_number: `SO-3A-${Date.now()}-${Math.random()}`, customer_id: context.customerId,
    items: [{ inventory_item_id: context.inventoryItemId, uom: 'EA', ordered_quantity: '2', unit_rate: '12.3456', gst_rate: '18', line_amount: '0.01' }], ...overrides };
  const response = await send('post', 'orders', body);
  if (response.status === 201) context.created.orderIds.push(BigInt(response.body.data.customer_order_id));
  return response;
}

test('creates a Decimal-safe DRAFT order and ignores client line totals', { skip: !integration }, async () => {
  const response = await create({ status: 'DRAFT' });
  assert.equal(response.status, 201);
  assert.equal(response.body.data.status, 'DRAFT');
  assert.equal(response.body.data.customer_order_item[0].line_amount, '24.69');
  assert.equal(response.body.data.totals.taxable_amount, '24.69');
  assert.equal(response.body.data.totals.tax_amount, '4.44');
  assert.equal(response.body.data.totals.total_amount, '29.13');
  assert.equal(await prisma.audit_log.count({ where: { action: 'SALES_ORDER_CREATED', record_id: BigInt(response.body.data.customer_order_id), user_id: BigInt(context.userId) } }), 1);
});

test('rejects missing or inactive customers atomically', { skip: !integration }, async () => {
  assert.equal((await create({ customer_id: '999999999' })).status, 400);
  await prisma.customer.update({ where: { customer_id: BigInt(context.customerId) }, data: { is_active: false } });
  assert.equal((await create()).status, 400);
  assert.equal(await prisma.customer_order.count({ where: { order_number: { startsWith: 'SO-3A-' } } }), 0);
});

test('requires at least one line', { skip: !integration }, async () => {
  const response = await create({ items: [] });
  assert.equal(response.status, 400);
  assert.match(response.body.error.message, /1 to 100/);
});

test('rejects invalid quantities', { skip: !integration }, async () => {
  for (const quantity of ['0', '-1', '1.0001', 'bad']) {
    const response = await create({ items: [{ inventory_item_id: context.inventoryItemId, uom: 'EA', ordered_quantity: quantity, unit_rate: '1' }] });
    assert.equal(response.status, 400, quantity);
  }
});

test('rejects invalid rates and unsupported discounts', { skip: !integration }, async () => {
  for (const item of [
    { inventory_item_id: context.inventoryItemId, uom: 'EA', ordered_quantity: '1', unit_rate: '-1' },
    { inventory_item_id: context.inventoryItemId, uom: 'EA', ordered_quantity: '1', unit_rate: '1.00001' },
    { inventory_item_id: context.inventoryItemId, uom: 'EA', ordered_quantity: '1', unit_rate: '1', discount_amount: '0.1' }
  ]) assert.equal((await create({ items: [item] })).status, 400);
});

test('rejects invalid items and UOMs', { skip: !integration }, async () => {
  assert.equal((await create({ items: [{ inventory_item_id: '999999999', uom: 'EA', ordered_quantity: '1' }] })).status, 400);
  const response = await create({ items: [{ inventory_item_id: context.inventoryItemId, uom: 'KG', ordered_quantity: '1' }] });
  assert.equal(response.status, 400);
  assert.match(response.body.error.message, /base UOM/);
});

test('permits DRAFT replacement and recalculates totals', { skip: !integration }, async () => {
  const order = await create();
  const response = await send('patch', `orders/${order.body.data.customer_order_id}`, { remarks: 'revised', items: [{ inventory_item_id: context.inventoryItemId, uom: 'EA', ordered_quantity: '3', unit_rate: '10', gst_rate: '5', line_amount: '999' }] });
  assert.equal(response.status, 200);
  assert.equal(response.body.data.customer_order_item[0].line_amount, '30');
  assert.equal(response.body.data.totals.total_amount, '31.5');
});

test('confirmation is explicit and invalid transitions are rejected', { skip: !integration }, async () => {
  const order = await create({ status: 'DRAFT' });
  const id = order.body.data.customer_order_id;
  assert.equal((await send('post', `orders/${id}/confirm`)).status, 200);
  assert.equal((await send('post', `orders/${id}/confirm`)).status, 409);
  assert.equal((await send('post', `orders/${id}/cancel`)).status, 200);
  assert.equal((await send('post', `orders/${id}/confirm`)).status, 409);
});

test('confirmed orders are immutable and actor comes from authentication', { skip: !integration }, async () => {
  const order = await create();
  const id = order.body.data.customer_order_id;
  await send('post', `orders/${id}/confirm`, { requester_id: '999999999' });
  assert.equal((await send('patch', `orders/${id}`, { remarks: 'forged mutation' })).status, 409);
  const log = await prisma.audit_log.findFirst({ where: { action: 'SALES_ORDER_CONFIRMED', record_id: BigInt(id) } });
  assert.equal(log.user_id.toString(), context.userId);
  assert.equal((await prisma.customer_order.findUnique({ where: { customer_order_id: BigInt(id) } })).remarks, null);
});
