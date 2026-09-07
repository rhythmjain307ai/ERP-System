const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../app');

const integration = process.env.RUN_API_TESTS === '1';

test('rejects invalid line-item payloads', async () => {
  const response = await request(app).post('/api/procurement/requisitions').send({ requisition_number: 'PR-TEST', items: [{ inventory_item_id: '1', uom: 'EA', requested_quantity: 0 }] });
  assert.equal(response.status, 400);
  assert.match(response.body.error.message, /greater than zero/);
});

test('returns 404 for unknown routes', async () => {
  const response = await request(app).get('/api/unknown-record');
  assert.equal(response.status, 404);
  assert.equal(response.body.success, false);
});

test('creates a purchase requisition with items', { skip: !integration }, async () => {
  const response = await request(app).post('/api/procurement/requisitions').send({ requisition_number: `PR-${Date.now()}`, items: [{ inventory_item_id: '1', uom: 'EA', requested_quantity: 2 }] });
  assert.equal(response.status, 201);
  assert.equal(response.body.data.purchase_requisition_item.length, 1);
});

test('creates a customer order with items', { skip: !integration }, async () => {
  const response = await request(app).post('/api/sales/orders').send({ order_number: `SO-${Date.now()}`, customer_id: '1', items: [{ inventory_item_id: '1', uom: 'EA', ordered_quantity: 2 }] });
  assert.equal(response.status, 201);
});

test('creates a sales invoice with items', { skip: !integration }, async () => {
  const response = await request(app).post('/api/sales/invoices').send({ invoice_number: `INV-${Date.now()}`, customer_id: '1', items: [{ inventory_item_id: '1', description: 'Test', uom: 'EA', quantity: 2 }] });
  assert.equal(response.status, 201);
});

test('creates approval requests with incrementing versions', { skip: !integration }, async () => {
  const transactionId = String(Date.now());
  const body = { approval_workflow_id: '1', transaction_type: 'TEST', transaction_id: transactionId };
  const first = await request(app).post('/api/approvals/requests').send(body);
  const second = await request(app).post('/api/approvals/requests').send(body);
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.equal(second.body.data.request_version, first.body.data.request_version + 1);
});
