if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

const prisma = require('../lib/prisma');
const { createAuthToken } = require('../middleware/auth');

async function setupIntegration() {
  if (!process.env.TEST_DATABASE_URL) return null;

  await prisma.$connect();
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const permissionCodes = ['master.write', 'inventory.write', 'procurement.write', 'sales.write', 'documents.write', 'documents.review', 'approvals.create', 'approvals.action'];
  const role = await prisma.role.create({ data: { role_name: `test-role-${suffix}`, description: 'Integration test role' } });
  const permissions = await Promise.all(permissionCodes.map((permission_code) => prisma.permission.upsert({
    where: { permission_code },
    update: { permission_name: permission_code },
    create: { permission_code, permission_name: permission_code }
  })));
  await prisma.role_permission.createMany({ data: permissions.map(({ permission_id }) => ({ role_id: role.role_id, permission_id })) });

  const company = await prisma.company.create({ data: { company_name: `Test Company ${suffix}` } });
  const factory = await prisma.factory.create({ data: { company_id: company.company_id, factory_code: `F-${suffix}`, factory_name: `Test Factory ${suffix}` } });
  const warehouse = await prisma.warehouse.create({ data: { factory_id: factory.factory_id, warehouse_code: `W-${suffix}`, warehouse_name: `Test Warehouse ${suffix}` } });
  const customer = await prisma.customer.create({ data: { company_id: company.company_id, customer_code: `C-${suffix}`, customer_name: `Test Customer ${suffix}` } });
  const vendor = await prisma.vendor.create({ data: { company_id: company.company_id, vendor_code: `V-${suffix}`, vendor_name: `Test Vendor ${suffix}` } });
  const inventoryItem = await prisma.inventory_item.create({ data: { item_code: `I-${suffix}`, item_name: `Test Item ${suffix}`, base_uom: 'EA' } });
  const workflow = await prisma.approval_workflow.create({ data: { workflow_name: `Test Workflow ${suffix}`, transaction_type: 'TEST' } });
  const user = await prisma.users.create({ data: { username: `test-user-${suffix}`, password_hash: 'not-a-real-password', role_id: role.role_id } });

  const created = {
    requisitionIds: [],
    purchaseOrderIds: [],
    grnIds: [],
    orderIds: [],
    invoiceIds: [],
    approvalTransactionIds: []
  };

  return {
    auth: `Bearer ${createAuthToken(user.user_id)}`,
    customerId: customer.customer_id.toString(),
    vendorId: vendor.vendor_id.toString(),
    warehouseId: warehouse.warehouse_id.toString(),
    inventoryItemId: inventoryItem.inventory_item_id.toString(),
    workflowId: workflow.approval_workflow_id.toString(),
    userId: user.user_id.toString(),
    created,
    async cleanup() {
      const transactionIds = created.approvalTransactionIds.map((value) => BigInt(value));
      await prisma.$transaction([
        prisma.approval_action.deleteMany({ where: { transaction_type: 'TEST', transaction_id: { in: transactionIds } } }),
        prisma.approval_request.deleteMany({ where: { approval_workflow_id: workflow.approval_workflow_id } }),
        prisma.sales_invoice.deleteMany({ where: { sales_invoice_id: { in: created.invoiceIds } } }),
        prisma.customer_order.deleteMany({ where: { customer_order_id: { in: created.orderIds } } }),
        prisma.stock_movement.deleteMany({ where: { inventory_item_id: inventoryItem.inventory_item_id, warehouse_id: warehouse.warehouse_id } }),
        prisma.inventory_stock.deleteMany({ where: { inventory_item_id: inventoryItem.inventory_item_id, warehouse_id: warehouse.warehouse_id } }),
        prisma.inventory_lot.deleteMany({ where: { inventory_item_id: inventoryItem.inventory_item_id, warehouse_id: warehouse.warehouse_id } }),
        prisma.grn.deleteMany({ where: { grn_id: { in: created.grnIds } } }),
        prisma.purchase_order.deleteMany({ where: { purchase_order_id: { in: created.purchaseOrderIds } } }),
        prisma.purchase_requisition.deleteMany({ where: { purchase_requisition_id: { in: created.requisitionIds } } }),
        prisma.approval_workflow.delete({ where: { approval_workflow_id: workflow.approval_workflow_id } }),
        prisma.users.delete({ where: { user_id: user.user_id } }),
        prisma.role.delete({ where: { role_id: role.role_id } }),
        prisma.inventory_item.delete({ where: { inventory_item_id: inventoryItem.inventory_item_id } }),
        prisma.warehouse.delete({ where: { warehouse_id: warehouse.warehouse_id } }),
        prisma.customer.delete({ where: { customer_id: customer.customer_id } }),
        prisma.vendor.delete({ where: { vendor_id: vendor.vendor_id } }),
        prisma.factory.delete({ where: { factory_id: factory.factory_id } }),
        prisma.company.delete({ where: { company_id: company.company_id } })
      ]);
    }
  };
}

module.exports = setupIntegration;
