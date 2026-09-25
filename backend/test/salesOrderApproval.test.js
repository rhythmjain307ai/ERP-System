const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../app');
const prisma = require('../lib/prisma');
const { createAuthToken } = require('../middleware/auth');
const setup = require('./setup');

const integration = Boolean(process.env.TEST_DATABASE_URL);
let context, approval;
test.beforeEach(async () => {
  context = await setup(); const suffix = `${Date.now()}-${Math.random()}`;
  const role = await prisma.role.create({ data: { role_name: `sales-approver-${suffix}` } });
  const permission = await prisma.permission.findUnique({ where: { permission_code: 'approvals.action' } });
  await prisma.role_permission.create({ data: { role_id: role.role_id, permission_id: permission.permission_id } });
  const employee = await prisma.employee.create({ data: { company_id: BigInt(context.companyId), employee_code: `APR-${suffix}`, first_name: 'Sales Approver' } });
  const user = await prisma.users.create({ data: { username: `sales-approver-${suffix}`, password_hash: 'not-a-password', role_id: role.role_id, employee_id: employee.employee_id } });
  const workflow = await prisma.approval_workflow.create({ data: { workflow_name: `Sales Order Approval ${suffix}`, transaction_type: 'SALES_ORDER', approval_step: { create: { step_number: 1, role_id: role.role_id, step_name: 'Sales order manager approval' } } } });
  approval = { role, employee, user, workflow, auth: `Bearer ${createAuthToken(user.user_id)}` };
});
test.afterEach(async () => {
  if (!context) return;
  if (approval) {
    await prisma.approval_action.deleteMany({ where: { approval_workflow_id: approval.workflow.approval_workflow_id } });
    await prisma.approval_request.deleteMany({ where: { approval_workflow_id: approval.workflow.approval_workflow_id } });
    await prisma.approval_step.deleteMany({ where: { approval_workflow_id: approval.workflow.approval_workflow_id } });
    await prisma.approval_workflow.delete({ where: { approval_workflow_id: approval.workflow.approval_workflow_id } });
    await prisma.audit_log.deleteMany({ where: { user_id: approval.user.user_id } });
    await prisma.users.delete({ where: { user_id: approval.user.user_id } });
    await prisma.employee.delete({ where: { employee_id: approval.employee.employee_id } });
    await prisma.role.delete({ where: { role_id: approval.role.role_id } });
  }
  await context.cleanup();
});
test.after(async () => { await prisma.$disconnect(); });

async function order() {
  const response = await request(app).post('/api/sales/orders').set('Authorization', context.auth).send({ order_number: `SO-APP-${Date.now()}-${Math.random()}`, customer_id: context.customerId,
    items: [{ inventory_item_id: context.inventoryItemId, uom: 'EA', ordered_quantity: '2', unit_rate: '100' }] });
  assert.equal(response.status, 201); const id = response.body.data.customer_order_id; context.created.orderIds.push(BigInt(id)); return id;
}
function submit(id, overrides = {}) { return request(app).post('/api/approvals/requests').set('Authorization', context.auth).send({ approval_workflow_id: approval.workflow.approval_workflow_id.toString(), transaction_type: 'SALES_ORDER', transaction_id: id, requester_id: approval.user.user_id.toString(), ...overrides }); }
function action(auth, requestId, value = 'APPROVED') { return request(app).post('/api/approvals/actions').set('Authorization', auth).send({ approval_request_id: requestId, action: value, action_by: context.userId, transaction_type: 'SALES_ORDER' }); }

test('configured workflow prevents direct confirmation and approves through its role', { skip: !integration }, async () => {
  const id = await order();
  assert.equal((await request(app).post(`/api/sales/orders/${id}/confirm`).set('Authorization', context.auth)).status, 409);
  const requested = await submit(id); assert.equal(requested.status, 201); assert.equal(requested.body.data.requester_id, context.userId);
  assert.equal((await action(context.auth, requested.body.data.approval_request_id)).status, 403);
  const approved = await action(approval.auth, requested.body.data.approval_request_id);
  assert.equal(approved.status, 201); assert.equal(approved.body.data.request.status, 'APPROVED');
  assert.equal((await prisma.customer_order.findUnique({ where: { customer_order_id: BigInt(id) } })).status, 'OPEN');
  assert.equal(approved.body.data.action.action_by, approval.user.user_id.toString());
  assert.equal((await action(approval.auth, requested.body.data.approval_request_id)).status, 409);
});

test('rejection preserves history and permits versioned resubmission', { skip: !integration }, async () => {
  const id = await order(); const first = await submit(id); assert.equal(first.body.data.request_version, 1);
  const rejected = await action(approval.auth, first.body.data.approval_request_id, 'REJECTED');
  assert.equal(rejected.status, 201); assert.equal(rejected.body.data.request.status, 'REJECTED');
  assert.equal((await prisma.customer_order.findUnique({ where: { customer_order_id: BigInt(id) } })).status, 'DRAFT');
  const second = await submit(id); assert.equal(second.status, 201); assert.equal(second.body.data.request_version, 2);
  assert.equal(await prisma.approval_request.count({ where: { transaction_type: 'SALES_ORDER', transaction_id: BigInt(id) } }), 2);
  assert.equal((await action(approval.auth, second.body.data.approval_request_id)).status, 201);
});

test('pending or approved requests cannot be duplicated', { skip: !integration }, async () => {
  const id = await order(); const first = await submit(id); assert.equal((await submit(id)).status, 409);
  await action(approval.auth, first.body.data.approval_request_id);
  assert.equal((await submit(id)).status, 409);
});
