const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const DEVELOPMENT_PASSWORD_HASH = 'DEV_ONLY_PLACEHOLDER_HASH_PASSWORD_VERIFICATION_NOT_IMPLEMENTED';
const seedDate = new Date('2026-09-01T00:00:00.000Z');

async function main() {
  console.log('Seeding development data for backend/prisma/schema.prisma...');

  const foundation = await prisma.$transaction(async (tx) => {
    const company = await tx.company.findFirst({ where: { company_name: 'HMFL Manufacturing Pvt Ltd' } });
    const savedCompany = company
      ? await tx.company.update({ where: { company_id: company.company_id }, data: { legal_name: 'HMFL Manufacturing Pvt Ltd', city: 'Pune', state: 'Maharashtra', state_code: '27', country: 'India' } })
      : await tx.company.create({ data: { company_name: 'HMFL Manufacturing Pvt Ltd', legal_name: 'HMFL Manufacturing Pvt Ltd', city: 'Pune', state: 'Maharashtra', state_code: '27', country: 'India' } });
    const factory = await tx.factory.upsert({
      where: { company_id_factory_code: { company_id: savedCompany.company_id, factory_code: 'DEV-MF' } },
      update: { factory_name: 'Main Factory', city: 'Pune', state: 'Maharashtra', state_code: '27', is_active: true },
      create: { company_id: savedCompany.company_id, factory_code: 'DEV-MF', factory_name: 'Main Factory', city: 'Pune', state: 'Maharashtra', state_code: '27' }
    });
    const warehouses = {};
    for (const warehouse of [['DEV-RMS', 'Raw Material Store'], ['DEV-FGS', 'Finished Goods Store']]) {
      warehouses[warehouse[0]] = await tx.warehouse.upsert({
        where: { factory_id_warehouse_code: { factory_id: factory.factory_id, warehouse_code: warehouse[0] } },
        update: { warehouse_name: warehouse[1], is_active: true },
        create: { factory_id: factory.factory_id, warehouse_code: warehouse[0], warehouse_name: warehouse[1], location: 'Main Factory' }
      });
    }
    const departments = {};
    for (const department of ['Procurement', 'Stores', 'Production', 'Finance', 'Sales', 'HR']) {
      const code = `DEV-${department.slice(0, 3).toUpperCase()}`;
      departments[department] = await tx.department.upsert({
        where: { company_id_department_code: { company_id: savedCompany.company_id, department_code: code } },
        update: { department_name: department },
        create: { company_id: savedCompany.company_id, department_code: code, department_name: department }
      });
    }
    return { company: savedCompany, factory, warehouses, departments };
  });

  const access = await prisma.$transaction(async (tx) => {
    const permissionCodes = ['master.write', 'inventory.write', 'procurement.write', 'sales.write', 'documents.write', 'documents.review', 'approvals.create', 'approvals.action'];
    const permissions = {};
    for (const code of permissionCodes) permissions[code] = await tx.permission.upsert({ where: { permission_code: code }, update: { permission_name: code }, create: { permission_code: code, permission_name: code, description: `Development permission: ${code}` } });
    const roleNames = ['Admin', 'Procurement Manager', 'Stores Manager', 'Production Manager', 'Finance Manager', 'Sales Manager'];
    const roles = {};
    for (const roleName of roleNames) roles[roleName] = await tx.role.upsert({ where: { role_name: roleName }, update: { description: `Development role for ${roleName}` }, create: { role_name: roleName, description: `Development role for ${roleName}` } });
    for (const roleName of roleNames) {
      const codes = roleName === 'Admin' ? permissionCodes : roleName === 'Procurement Manager' ? ['procurement.write', 'approvals.create'] : roleName === 'Stores Manager' ? ['master.write', 'inventory.write', 'approvals.action'] : roleName === 'Production Manager' ? ['inventory.write', 'approvals.action'] : roleName === 'Finance Manager' ? ['documents.review', 'approvals.action'] : ['sales.write', 'documents.write', 'approvals.create'];
      for (const code of codes) await tx.role_permission.upsert({ where: { role_id_permission_id: { role_id: roles[roleName].role_id, permission_id: permissions[code].permission_id } }, update: {}, create: { role_id: roles[roleName].role_id, permission_id: permissions[code].permission_id } });
    }
    const employees = {};
    const employeeData = [['DEV-EMP-001', 'Aarav', 'Shah', 'Admin', 'Finance'], ['DEV-EMP-002', 'Meera', 'Kulkarni', 'Procurement Manager', 'Procurement'], ['DEV-EMP-003', 'Rohan', 'Patil', 'Stores Manager', 'Stores'], ['DEV-EMP-004', 'Ishita', 'Deshmukh', 'Production Manager', 'Production'], ['DEV-EMP-005', 'Vikram', 'Joshi', 'Finance Manager', 'Finance'], ['DEV-EMP-006', 'Neha', 'Bansal', 'Sales Manager', 'Sales']];
    for (const [code, firstName, lastName, roleName, departmentName] of employeeData) employees[roleName] = await tx.employee.upsert({ where: { company_id_employee_code: { company_id: foundation.company.company_id, employee_code: code } }, update: { first_name: firstName, last_name: lastName, designation: roleName, factory_id: foundation.factory.factory_id, department_id: foundation.departments[departmentName].department_id }, create: { company_id: foundation.company.company_id, factory_id: foundation.factory.factory_id, department_id: foundation.departments[departmentName].department_id, employee_code: code, first_name: firstName, last_name: lastName, designation: roleName, joining_date: new Date('2025-01-01') } });
    const users = {};
    for (const roleName of roleNames) {
      const username = `dev.${roleName.toLowerCase().replace(/ /g, '.')}`;
      users[roleName] = await tx.users.upsert({ where: { username }, update: { employee_id: employees[roleName].employee_id, role_id: roles[roleName].role_id, password_hash: DEVELOPMENT_PASSWORD_HASH, is_active: true }, create: { username, employee_id: employees[roleName].employee_id, role_id: roles[roleName].role_id, password_hash: DEVELOPMENT_PASSWORD_HASH } });
    }
    return { roles, users };
  });

  const master = await prisma.$transaction(async (tx) => {
    const categories = {};
    for (const name of ['Raw Material', 'Finished Good', 'Consumable', 'Service']) categories[name] = await tx.item_category.upsert({ where: { category_name: name }, update: { description: `Development ${name.toLowerCase()} category` }, create: { category_name: name, description: `Development ${name.toLowerCase()} category` } });
    const items = {};
    const itemData = [['DEV-RM-STEEL', 'EN8 Round Steel Bar', 'Raw Material', 'KG', 'RAW_MATERIAL', true, true, 18], ['DEV-FG-SHAFT', 'Forged Drive Shaft 48mm', 'Finished Good', 'PCS', 'FINISHED_GOOD', true, false, 18], ['DEV-CONS-LUBE', 'Die Lubricant', 'Consumable', 'LTR', 'CONSUMABLE', true, false, 18], ['DEV-SVC-MAINT', 'Forge Machine Maintenance', 'Service', 'JOB', 'SERVICE', false, false, 18]];
    for (const [code, name, category, uom, type, stock, lotTracked, gst] of itemData) items[code] = await tx.inventory_item.upsert({ where: { item_code: code }, update: { item_name: name, item_category_id: categories[category].item_category_id, base_uom: uom, item_type: type, is_stock_item: stock, is_lot_tracked: lotTracked, gst_rate: gst, is_active: true }, create: { item_code: code, item_name: name, item_category_id: categories[category].item_category_id, base_uom: uom, item_type: type, is_stock_item: stock, is_lot_tracked: lotTracked, gst_rate: gst } });
    const vendor1 = await tx.vendor.upsert({ where: { company_id_vendor_code: { company_id: foundation.company.company_id, vendor_code: 'DEV-VEN-001' } }, update: { vendor_name: 'Bharat Steel Traders', payment_terms_days: 30, is_active: true }, create: { company_id: foundation.company.company_id, vendor_code: 'DEV-VEN-001', vendor_name: 'Bharat Steel Traders', city: 'Pune', state: 'Maharashtra', state_code: '27', payment_terms_days: 30 } });
    const vendor2 = await tx.vendor.upsert({ where: { company_id_vendor_code: { company_id: foundation.company.company_id, vendor_code: 'DEV-VEN-002' } }, update: { vendor_name: 'Precision Furnace Services', payment_terms_days: 15, is_active: true }, create: { company_id: foundation.company.company_id, vendor_code: 'DEV-VEN-002', vendor_name: 'Precision Furnace Services', city: 'Pune', state: 'Maharashtra', state_code: '27', payment_terms_days: 15 } });
    const customer1 = await tx.customer.upsert({ where: { company_id_customer_code: { company_id: foundation.company.company_id, customer_code: 'DEV-CUS-001' } }, update: { customer_name: 'Acme Auto Components', payment_terms_days: 30, is_active: true }, create: { company_id: foundation.company.company_id, customer_code: 'DEV-CUS-001', customer_name: 'Acme Auto Components', city: 'Pune', state: 'Maharashtra', state_code: '27', payment_terms_days: 30 } });
    const customer2 = await tx.customer.upsert({ where: { company_id_customer_code: { company_id: foundation.company.company_id, customer_code: 'DEV-CUS-002' } }, update: { customer_name: 'Prime Axles Ltd', payment_terms_days: 45, is_active: true }, create: { company_id: foundation.company.company_id, customer_code: 'DEV-CUS-002', customer_name: 'Prime Axles Ltd', city: 'Faridabad', state: 'Haryana', state_code: '06', payment_terms_days: 45 } });
    const machine = await tx.machine.upsert({ where: { factory_id_machine_code: { factory_id: foundation.factory.factory_id, machine_code: 'DEV-FORG-01' } }, update: { machine_name: 'Forging Press 01', status: 'ACTIVE' }, create: { factory_id: foundation.factory.factory_id, machine_code: 'DEV-FORG-01', machine_name: 'Forging Press 01', machine_type: 'Hydraulic Press' } });
    const expenseCategory = await tx.expense_category.upsert({ where: { category_name: 'Power and Fuel' }, update: { category_group: 'OPERATING_EXPENSE' }, create: { category_name: 'Power and Fuel', category_group: 'OPERATING_EXPENSE', description: 'Development expense category' } });
    const bank = await tx.bank_account.upsert({ where: { company_id_account_number: { company_id: foundation.company.company_id, account_number: 'DEV-000123456789' } }, update: { bank_name: 'Development Cooperative Bank', account_name: 'HMFL Operations', is_active: true }, create: { company_id: foundation.company.company_id, bank_name: 'Development Cooperative Bank', account_name: 'HMFL Operations', account_number: 'DEV-000123456789', ifsc_code: 'DEV00000001' } });
    const accounts = {};
    for (const [code, name, type] of [['1000', 'Bank', 'ASSET'], ['1100', 'Accounts Receivable', 'ASSET'], ['1200', 'Inventory', 'ASSET'], ['2000', 'Accounts Payable', 'LIABILITY'], ['4000', 'Sales Revenue', 'INCOME'], ['5000', 'Purchases', 'EXPENSE'], ['1400', 'GST Input', 'ASSET'], ['2100', 'GST Output', 'LIABILITY'], ['1300', 'Production WIP', 'ASSET']]) accounts[code] = await tx.chart_of_account.upsert({ where: { company_id_account_code: { company_id: foundation.company.company_id, account_code: code } }, update: { account_name: name, account_type: type, is_active: true }, create: { company_id: foundation.company.company_id, account_code: code, account_name: name, account_type: type } });
    return { categories, items, vendors: { vendor1, vendor2 }, customers: { customer1, customer2 }, machine, expenseCategory, bank, accounts };
  });

  const inventory = await prisma.$transaction(async (tx) => {
    const raw = master.items['DEV-RM-STEEL'];
    const warehouseId = foundation.warehouses['DEV-RMS'].warehouse_id;
    const savedLot = await tx.inventory_lot.upsert({ where: { warehouse_id_lot_number: { warehouse_id: warehouseId, lot_number: 'DEV-LOT-001' } }, update: { inventory_item_id: raw.inventory_item_id, heat_number: 'DEV-HEAT-2026-001', supplier_id: master.vendors.vendor1.vendor_id, quantity_received: 1000, accepted_quantity: 1000, status: 'OPEN', remarks: 'Development opening lot' }, create: { inventory_item_id: raw.inventory_item_id, warehouse_id: warehouseId, lot_number: 'DEV-LOT-001', heat_number: 'DEV-HEAT-2026-001', supplier_id: master.vendors.vendor1.vendor_id, received_date: seedDate, quantity_received: 1000, accepted_quantity: 1000, remarks: 'Development opening lot' } });
    await tx.inventory_stock.deleteMany({ where: { inventory_item_id: raw.inventory_item_id, warehouse_id: warehouseId, lot_id: savedLot.lot_id } });
    await tx.inventory_stock.create({ data: { inventory_item_id: raw.inventory_item_id, warehouse_id: warehouseId, lot_id: savedLot.lot_id, quantity: 1000, reserved_quantity: 0 } });
    await tx.stock_movement.deleteMany({ where: { inventory_item_id: raw.inventory_item_id, warehouse_id: warehouseId, lot_id: savedLot.lot_id, movement_type: 'ADJUSTMENT_IN', remarks: 'Opening balance' } });
    await tx.stock_movement.create({ data: { inventory_item_id: raw.inventory_item_id, warehouse_id: warehouseId, lot_id: savedLot.lot_id, movement_type: 'ADJUSTMENT_IN', quantity: 1000, movement_date: seedDate, reference_type: 'OPENING_BALANCE', remarks: 'Opening balance' } });
    const finished = master.items['DEV-FG-SHAFT'];
    const finishedWarehouseId = foundation.warehouses['DEV-FGS'].warehouse_id;
    await tx.inventory_stock.deleteMany({ where: { inventory_item_id: finished.inventory_item_id, warehouse_id: finishedWarehouseId, lot_id: null } });
    await tx.inventory_stock.create({ data: { inventory_item_id: finished.inventory_item_id, warehouse_id: finishedWarehouseId, quantity: 50, reserved_quantity: 0 } });
    await tx.stock_movement.deleteMany({ where: { inventory_item_id: finished.inventory_item_id, warehouse_id: finishedWarehouseId, movement_type: 'ADJUSTMENT_IN', remarks: 'Opening balance' } });
    await tx.stock_movement.create({ data: { inventory_item_id: finished.inventory_item_id, warehouse_id: finishedWarehouseId, movement_type: 'ADJUSTMENT_IN', quantity: 50, movement_date: seedDate, reference_type: 'OPENING_BALANCE', remarks: 'Opening balance' } });
    return { lot: savedLot };
  });

  await prisma.$transaction(async (tx) => {
    const bom = await tx.bill_of_material.upsert({ where: { bom_code: 'DEV-BOM-SHAFT-001' }, update: { finished_item_id: master.items['DEV-FG-SHAFT'].inventory_item_id, version: '1', is_active: true }, create: { finished_item_id: master.items['DEV-FG-SHAFT'].inventory_item_id, bom_code: 'DEV-BOM-SHAFT-001', version: '1', effective_from: seedDate } });
    await tx.bom_item.upsert({ where: { bom_id_component_item_id: { bom_id: bom.bom_id, component_item_id: master.items['DEV-RM-STEEL'].inventory_item_id } }, update: { quantity_per_unit: 2, uom: 'KG', scrap_percentage: 0 }, create: { bom_id: bom.bom_id, component_item_id: master.items['DEV-RM-STEEL'].inventory_item_id, quantity_per_unit: 2, uom: 'KG' } });
    const order = await tx.production_order.upsert({ where: { production_order_number: 'DEV-PROD-001' }, update: { inventory_item_id: master.items['DEV-FG-SHAFT'].inventory_item_id, bom_id: bom.bom_id, factory_id: foundation.factory.factory_id, planned_quantity: 50, status: 'PLANNED', remarks: 'Development production order' }, create: { production_order_number: 'DEV-PROD-001', inventory_item_id: master.items['DEV-FG-SHAFT'].inventory_item_id, bom_id: bom.bom_id, factory_id: foundation.factory.factory_id, planned_quantity: 50, planned_start_date: seedDate, remarks: 'Development production order' } });
  await tx.work_order.upsert({ where: { work_order_number: 'DEV-WO-001' }, update: { production_order_id: order.production_order_id, machine_id: master.machine.machine_id, operation_name: 'Forging', planned_quantity: 50, status: 'PENDING' }, create: { work_order_number: 'DEV-WO-001', production_order_id: order.production_order_id, machine_id: master.machine.machine_id, operation_name: 'Forging', planned_quantity: 50, remarks: 'Development work order' } });
  });

  await prisma.$transaction(async (tx) => {
    const definitions = [['Purchase Requisition', 'PURCHASE_REQUISITION', 'Procurement Manager'], ['Purchase Order', 'PURCHASE_ORDER', 'Procurement Manager'], ['Expense', 'EXPENSE', 'Finance Manager'], ['Sales Invoice', 'SALES_INVOICE', 'Sales Manager']];
    for (const [name, type, roleName] of definitions) {
      const workflow = await tx.approval_workflow.upsert({ where: { workflow_name: `Development ${name} Approval` }, update: { transaction_type: type, is_active: true }, create: { workflow_name: `Development ${name} Approval`, transaction_type: type } });
      await tx.approval_step.upsert({ where: { approval_workflow_id_step_number: { approval_workflow_id: workflow.approval_workflow_id, step_number: 1 } }, update: { role_id: access.roles[roleName].role_id, step_name: `${name} manager review`, is_mandatory: true }, create: { approval_workflow_id: workflow.approval_workflow_id, step_number: 1, role_id: access.roles[roleName].role_id, step_name: `${name} manager review` } });
    }
  });

  await prisma.$transaction(async (tx) => {
    const requisition = await tx.purchase_requisition.upsert({ where: { requisition_number: 'DEV-PR-001' }, update: { department_id: foundation.departments.Procurement.department_id, requested_by: access.users['Procurement Manager'].user_id, status: 'SUBMITTED', remarks: 'Development purchase requisition' }, create: { requisition_number: 'DEV-PR-001', department_id: foundation.departments.Procurement.department_id, requested_by: access.users['Procurement Manager'].user_id, requisition_date: seedDate, required_date: new Date('2026-09-15'), status: 'SUBMITTED', remarks: 'Development purchase requisition' } });
    await tx.purchase_requisition_item.deleteMany({ where: { purchase_requisition_id: requisition.purchase_requisition_id } });
    await tx.purchase_requisition_item.create({ data: { purchase_requisition_id: requisition.purchase_requisition_id, inventory_item_id: master.items['DEV-RM-STEEL'].inventory_item_id, description: 'EN8 round steel bar', uom: 'KG', requested_quantity: 500, required_date: new Date('2026-09-15') } });
    const po = await tx.purchase_order.upsert({ where: { po_number: 'DEV-PO-001-PURCHASE' }, update: { vendor_id: master.vendors.vendor1.vendor_id, purchase_requisition_id: requisition.purchase_requisition_id, status: 'CONFIRMED', taxable_amount: 40000, tax_amount: 7200, total_amount: 47200, expected_date: new Date('2026-09-10') }, create: { po_number: 'DEV-PO-001-PURCHASE', vendor_id: master.vendors.vendor1.vendor_id, purchase_requisition_id: requisition.purchase_requisition_id, order_date: seedDate, expected_date: new Date('2026-09-10'), taxable_amount: 40000, tax_amount: 7200, total_amount: 47200, status: 'CONFIRMED', notes: 'Development purchase order' } });
    await tx.purchase_order_item.deleteMany({ where: { purchase_order_id: po.purchase_order_id } });
    const poItem = await tx.purchase_order_item.create({ data: { purchase_order_id: po.purchase_order_id, inventory_item_id: master.items['DEV-RM-STEEL'].inventory_item_id, description: 'EN8 round steel bar', uom: 'KG', ordered_quantity: 500, unit_rate: 80, gst_rate: 18, line_amount: 40000 } });
    const grn = await tx.grn.upsert({ where: { grn_number: 'DEV-GRN-001' }, update: { purchase_order_id: po.purchase_order_id, vendor_id: master.vendors.vendor1.vendor_id, warehouse_id: foundation.warehouses['DEV-RMS'].warehouse_id, inspection_status: 'ACCEPTED', remarks: 'Development goods receipt' }, create: { grn_number: 'DEV-GRN-001', purchase_order_id: po.purchase_order_id, vendor_id: master.vendors.vendor1.vendor_id, warehouse_id: foundation.warehouses['DEV-RMS'].warehouse_id, grn_date: seedDate, inspection_status: 'ACCEPTED', inspected_by: access.users['Stores Manager'].user_id, remarks: 'Development goods receipt' } });
    await tx.grn_item.deleteMany({ where: { grn_id: grn.grn_id } });
    await tx.grn_item.create({ data: { grn_id: grn.grn_id, purchase_order_item_id: poItem.purchase_order_item_id, inventory_item_id: master.items['DEV-RM-STEEL'].inventory_item_id, lot_id: inventory.lot.lot_id, heat_number: 'DEV-HEAT-2026-001', uom: 'KG', challan_quantity: 500, received_quantity: 500, accepted_quantity: 500, rate: 80 } });
  });

  await prisma.$transaction(async (tx) => {
    const order = await tx.customer_order.upsert({ where: { order_number: 'DEV-SO-001' }, update: { customer_id: master.customers.customer1.customer_id, status: 'OPEN', remarks: 'Development customer order' }, create: { order_number: 'DEV-SO-001', customer_id: master.customers.customer1.customer_id, order_date: seedDate, buyer_order_number: 'DEV-CUST-PO-001', status: 'OPEN', remarks: 'Development customer order' } });
    await tx.customer_order_item.deleteMany({ where: { customer_order_id: order.customer_order_id } });
    const orderItem = await tx.customer_order_item.create({ data: { customer_order_id: order.customer_order_id, inventory_item_id: master.items['DEV-FG-SHAFT'].inventory_item_id, description: 'Forged Drive Shaft 48mm', uom: 'PCS', ordered_quantity: 10, unit_rate: 1250, gst_rate: 18, line_amount: 12500 } });
    const invoice = await tx.sales_invoice.upsert({ where: { invoice_number: 'DEV-INV-001' }, update: { customer_id: master.customers.customer1.customer_id, customer_order_id: order.customer_order_id, status: 'DRAFT', taxable_amount: 12500, cgst_amount: 1125, sgst_amount: 1125, total_amount: 14750 }, create: { invoice_number: 'DEV-INV-001', customer_id: master.customers.customer1.customer_id, customer_order_id: order.customer_order_id, invoice_date: seedDate, due_date: new Date('2026-10-01'), payment_terms: '30 days', bill_to_name: 'Acme Auto Components', ship_to_name: 'Acme Auto Components', taxable_amount: 12500, cgst_amount: 1125, sgst_amount: 1125, total_amount: 14750, status: 'DRAFT', notes: 'Development sales invoice' } });
    await tx.sales_invoice_item.deleteMany({ where: { sales_invoice_id: invoice.sales_invoice_id } });
    await tx.sales_invoice_item.create({ data: { sales_invoice_id: invoice.sales_invoice_id, customer_order_item_id: orderItem.customer_order_item_id, inventory_item_id: master.items['DEV-FG-SHAFT'].inventory_item_id, description: 'Forged Drive Shaft 48mm', uom: 'PCS', quantity: 10, unit_price: 1250, taxable_amount: 12500, gst_rate: 18, cgst_amount: 1125, sgst_amount: 1125, line_total: 14750 } });
  });

  await prisma.$transaction(async (tx) => {
    const document = await tx.document.findFirst({ where: { file_name: 'DEV-invoice-001.pdf' } });
    const savedDocument = document ? await tx.document.update({ where: { document_id: document.document_id }, data: { document_type: 'PURCHASE_INVOICE', file_url: 'https://example.invalid/development/DEV-invoice-001.pdf', mime_type: 'application/pdf', uploaded_by: access.users['Finance Manager'].user_id, metadata: { environment: 'development' } } }) : await tx.document.create({ data: { document_type: 'PURCHASE_INVOICE', file_name: 'DEV-invoice-001.pdf', file_url: 'https://example.invalid/development/DEV-invoice-001.pdf', mime_type: 'application/pdf', uploaded_by: access.users['Finance Manager'].user_id, metadata: { environment: 'development' } } });
    await tx.invoice_extraction_review.upsert({ where: { document_id: savedDocument.document_id }, update: { extraction_status: 'PENDING', extraction_engine: 'development-placeholder', extraction_version: 'dev-1', review_notes: 'Pending development review' }, create: { document_id: savedDocument.document_id, extraction_status: 'PENDING', extraction_engine: 'development-placeholder', extraction_version: 'dev-1', review_notes: 'Pending development review' } });
  });

  console.log('Development seed complete. No production credentials or password are configured.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
