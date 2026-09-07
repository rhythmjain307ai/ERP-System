const express = require('express');
const asyncHandler = require('../lib/asyncHandler');
const makeCrud = require('../controllers/crudController');
const workflow = require('../controllers/erpController');

const configs = {
  companies: ['company', 'company_id', ['company_name'], ['company_name', 'legal_name']],
  factories: ['factory', 'factory_id', ['company_id', 'factory_code', 'factory_name'], ['factory_code', 'factory_name']],
  departments: ['department', 'department_id', ['company_id', 'department_code', 'department_name'], ['department_code', 'department_name']],
  employees: ['employee', 'employee_id', ['company_id', 'employee_code', 'first_name'], ['employee_code', 'first_name', 'last_name']],
  users: ['users', 'user_id', ['username', 'password_hash'], ['username']],
  roles: ['role', 'role_id', ['role_name'], ['role_name']],
  permissions: ['permission', 'permission_id', ['permission_code', 'permission_name'], ['permission_code', 'permission_name']],
  customers: ['customer', 'customer_id', ['company_id', 'customer_code', 'customer_name'], ['customer_code', 'customer_name', 'email'], null, 'is_active'],
  vendors: ['vendor', 'vendor_id', ['company_id', 'vendor_code', 'vendor_name'], ['vendor_code', 'vendor_name', 'email'], null, 'is_active'],
  'item-categories': ['item_category', 'item_category_id', ['category_name'], ['category_name', 'description']],
  'inventory-items': ['inventory_item', 'inventory_item_id', ['item_code', 'item_name', 'base_uom'], ['item_code', 'item_name', 'description'], null, 'is_active'],
  warehouses: ['warehouse', 'warehouse_id', ['factory_id', 'warehouse_code', 'warehouse_name'], ['warehouse_code', 'warehouse_name', 'location'], null, 'is_active'],
  'inventory-lots': ['inventory_lot', 'lot_id', ['inventory_item_id', 'warehouse_id', 'lot_number'], ['lot_number', 'heat_number'], null, 'status'],
  'stock-movements': ['stock_movement', 'stock_movement_id', ['inventory_item_id', 'warehouse_id', 'movement_type', 'quantity'], ['movement_type', 'reference_type'], null, null]
};

function crudRouter(config) {
  const [model, idField, required, search, , statusField] = config;
  const controller = makeCrud({ model, idField, requiredFields: required, fields: [...new Set([...required, ...search, 'description', 'status', statusField, 'is_active', 'email', 'phone', 'metadata', 'file_url', 'mime_type', 'password_hash', 'role_id', 'factory_id', 'department_id', 'item_category_id', 'base_uom', 'item_type', 'gst_rate', 'payment_terms_days', 'credit_limit', 'location', 'parent_category_id', 'remarks', 'movement_type', 'quantity', 'reference_type', 'reference_id', 'lot_id'])].filter(Boolean), searchFields: search, statusField });
  const router = express.Router();
  router.get('/', asyncHandler(controller.list)); router.get('/:id', asyncHandler(controller.get)); router.post('/', asyncHandler(controller.create)); router.patch('/:id', asyncHandler(controller.update)); router.delete('/:id', asyncHandler(controller.remove));
  return router;
}

function mountCrud(router, prefix) { Object.entries(configs).forEach(([path, config]) => router.use(`${prefix}/${path}`, crudRouter(config))); }

function createRoutes() {
  const master = express.Router(); mountCrud(master, '');
  const inventory = express.Router(); inventory.use('/items', crudRouter(configs['inventory-items'])); inventory.use('/warehouses', crudRouter(configs.warehouses)); inventory.use('/lots', crudRouter(configs['inventory-lots'])); inventory.use('/movements', crudRouter(configs['stock-movements']));
  const procurement = express.Router(); procurement.post('/requisitions', asyncHandler(workflow.createRequisition)); procurement.post('/purchase-orders', asyncHandler(workflow.createPurchaseOrder)); procurement.post('/grns', asyncHandler(workflow.createGrn));
  const sales = express.Router(); sales.post('/orders', asyncHandler(workflow.createCustomerOrder)); sales.post('/deliveries', asyncHandler(workflow.createDelivery)); sales.post('/invoices', asyncHandler(workflow.createSalesInvoice));
  const documents = express.Router(); documents.post('/', asyncHandler(workflow.createDocument)); documents.get('/reviews/:id', asyncHandler(workflow.getReview)); documents.patch('/reviews/:id', asyncHandler(workflow.updateReview)); documents.get('/:id', asyncHandler(workflow.getDocument)); documents.patch('/:id', asyncHandler(workflow.updateDocument));
  const approvals = express.Router(); approvals.post('/requests', asyncHandler(workflow.createApprovalRequest)); approvals.post('/actions', asyncHandler(workflow.submitApprovalAction));
  return { master, inventory, procurement, sales, documents, approvals, customers: crudRouter(configs.customers), vendors: crudRouter(configs.vendors) };
}

module.exports = { createRoutes, crudRouter };