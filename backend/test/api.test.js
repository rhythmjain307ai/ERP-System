const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const setupIntegration = require('./setup');
const app = require('../app');

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
