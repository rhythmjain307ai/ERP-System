if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const prisma = require('../lib/prisma');
const { createAuthToken } = require('../middleware/auth');

async function setupIntegration() {
  if (!process.env.TEST_DATABASE_URL) return null;

  await prisma.$connect();
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const permissions = ['master.write', 'inventory.write', 'procurement.write', 'sales.write', 'documents.write', 'documents.review', 'approvals.create', 'approvals.action'];
  const role = await prisma.role.create({ data: { role_name: `test-role-${suffix}`, description: 'Integration test role' } });
  const permissionRecords = await Promise.all(permissions.map((permission_code) => prisma.permission.upsert({ where: { permission_code }, update: { permission_name: permission_code }, create: { permission_code, permission_name: permission_code } })));
  await prisma.role_permission.createMany({ data: permissionRecords.map((permission) => ({ role_id: role.role_id, permission_id: permission.permission_id })) });

  const company = await prisma.company.create({ data: { company_name: `Test Company ${suffix}` } });
  const factory = await prisma.factory.create({ data: { company_id: company.company_id, factory_code: `F-${suffix}`, factory_name: `Test Factory ${suffix}` } });
  const warehouse = await prisma.warehouse.create({ data: { factory_id: factory.factory_id, warehouse_code: `W-${suffix}`, warehouse_name: `Test Warehouse ${suffix}` } });
  const customer = await prisma.customer.create({ data: { company_id: company.company_id, customer_code: `C-${suffix}`, customer_name: `Test Customer ${suffix}` } });
  const vendor = await prisma.vendor.create({ data: { company_id: company.company_id, vendor_code: `V-${suffix}`, vendor_name: `Test Vendor ${suffix}` } });
  const item = await prisma.inventory_item.create({ data: { item_code: `I-${suffix}`, item_name: `Test Item ${suffix}`, base_uom: 'EA' } });
  const workflow = await prisma.approval_workflow.create({ data: { workflow_name: `Test Workflow ${suffix}`, transaction_type: 'TEST' } });
  const user = await prisma.users.create({ data: { username: `test-user-${suffix}`, password_hash: 'not-a-real-password', role_id: role.role_id } });

  return {
    auth: `Bearer ${createAuthToken(user.user_id)}`,
    customerId: customer.customer_id.toString(),
    vendorId: vendor.vendor_id.toString(),
    inventoryItemId: item.inventory_item_id.toString(),
    warehouseId: warehouse.warehouse_id.toString(),
    workflowId: workflow.approval_workflow_id.toString(),
    userId: user.user_id.toString()
  };
}

module.exports = setupIntegration;
