const express = require('express');
const asyncHandler = require('../lib/asyncHandler');
const makeCrud = require('../controllers/crudController');
const workflow = require('../controllers/erpController');
const salesOrders = require('../controllers/salesOrderController');
const approvals = require('../controllers/approvalController');
const salesInvoices = require('../controllers/salesInvoiceController');
const accountsReceivable = require('../controllers/accountsReceivableController');
const customerPayments = require('../controllers/customerPaymentController');
const customerLedger = require('../controllers/customerLedgerController');
const accountsPayable = require('../controllers/accountsPayableController');
const payments = require('../controllers/paymentController');
const financeConfig = require('../controllers/financeConfigController');
const reversals = require('../controllers/reversalController');
const vendorLedger = require('../controllers/vendorLedgerController');
const financialReports = require('../controllers/financialReportsController');
const bankReconciliation = require('../controllers/bankReconciliationController');
const weighbridge = require('../controllers/weighbridgeController');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { documentUpload } = require('../middleware/upload');

const userResponseSelect = {
  user_id: true,
  employee_id: true,
  role_id: true,
  username: true,
  is_active: true,
  last_login_at: true,
  created_at: true,
  updated_at: true
};

const configs = {
  companies: ['company', 'company_id', ['company_name'], ['company_name', 'legal_name']],
  factories: ['factory', 'factory_id', ['company_id', 'factory_code', 'factory_name'], ['factory_code', 'factory_name']],
  departments: ['department', 'department_id', ['company_id', 'department_code', 'department_name'], ['department_code', 'department_name']],
  employees: ['employee', 'employee_id', ['company_id', 'employee_code', 'first_name'], ['employee_code', 'first_name', 'last_name']],
  users: ['users', 'user_id', ['username', 'password_hash'], ['username'], null, null, userResponseSelect],
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

function crudRouter(config, permission = 'master.write') {
  const [model, idField, required, search, , statusField, responseSelect] = config;
  const controller = makeCrud({ model, idField, requiredFields: required, fields: [...new Set([...required, ...search, 'description', 'status', statusField, 'is_active', 'email', 'phone', 'metadata', 'file_url', 'mime_type', 'password_hash', 'role_id', 'factory_id', 'department_id', 'item_category_id', 'base_uom', 'item_type', 'gst_rate', 'payment_terms_days', 'credit_limit', 'location', 'parent_category_id', 'remarks', 'movement_type', 'quantity', 'reference_type', 'reference_id', 'lot_id'])].filter(Boolean), searchFields: search, statusField, responseSelect });
  const router = express.Router();
  router.get('/', asyncHandler(controller.list)); router.get('/:id', asyncHandler(controller.get)); router.post('/', requireAuth, requirePermission(permission), asyncHandler(controller.create)); router.patch('/:id', requireAuth, requirePermission(permission), asyncHandler(controller.update)); router.delete('/:id', requireAuth, requirePermission(permission), asyncHandler(controller.remove));
  return router;
}

function mountCrud(router, prefix) { Object.entries(configs).forEach(([path, config]) => router.use(`${prefix}/${path}`, crudRouter(config, 'master.write'))); }

function createRoutes() {
  const master = express.Router(); mountCrud(master, '');
  const inventory = express.Router(); inventory.get('/stocks', requireAuth, asyncHandler(workflow.listInventoryStocks)); inventory.get('/movements', requireAuth, asyncHandler(workflow.listInventoryMovements)); inventory.use('/items', crudRouter(configs['inventory-items'], 'inventory.write')); inventory.use('/warehouses', crudRouter(configs.warehouses, 'inventory.write')); inventory.use('/lots', crudRouter(configs['inventory-lots'], 'inventory.write')); inventory.use('/movements', crudRouter(configs['stock-movements'], 'inventory.write'));
  const procurement = express.Router(); procurement.get('/purchase-orders', requireAuth, asyncHandler(workflow.listPurchaseOrders)); procurement.get('/purchase-orders/:id', requireAuth, asyncHandler(workflow.getPurchaseOrder)); procurement.get('/grns', requireAuth, asyncHandler(workflow.listGrns)); procurement.get('/grns/:id', requireAuth, asyncHandler(workflow.getGrn)); procurement.post('/requisitions', requireAuth, requirePermission('procurement.write'), asyncHandler(workflow.createRequisition)); procurement.post('/purchase-orders', requireAuth, requirePermission('procurement.write'), asyncHandler(workflow.createPurchaseOrder)); procurement.post('/grns', requireAuth, requirePermission('procurement.write'), asyncHandler(workflow.createGrn)); procurement.post('/grns/:id/post', requireAuth, requirePermission('inventory.write'), asyncHandler(workflow.postGrn)); procurement.post('/vendor-invoices', requireAuth, requirePermission('procurement.write'), asyncHandler(workflow.createVendorInvoice)); procurement.post('/vendor-invoices/:id/book', requireAuth, requirePermission('procurement.write'), asyncHandler(workflow.bookVendorInvoice)); procurement.post('/vendor-invoices/:id/cancel', requireAuth, requirePermission('procurement.write'), asyncHandler(workflow.cancelVendorInvoice)); procurement.get('/vendor-invoices', requireAuth, requirePermission('procurement.write'), asyncHandler(workflow.listVendorInvoices)); procurement.get('/vendor-invoices/:id', requireAuth, requirePermission('procurement.write'), asyncHandler(workflow.getVendorInvoice));
  const sales = express.Router();
  sales.get('/orders', requireAuth, asyncHandler(salesOrders.list));
  sales.get('/orders/:id', requireAuth, asyncHandler(salesOrders.get));
  sales.post('/orders', requireAuth, requirePermission('sales.write'), asyncHandler(salesOrders.create));
  sales.patch('/orders/:id', requireAuth, requirePermission('sales.write'), asyncHandler(salesOrders.update));
  sales.post('/orders/:id/confirm', requireAuth, requirePermission('sales.write'), asyncHandler(salesOrders.confirm));
  sales.post('/orders/:id/cancel', requireAuth, requirePermission('sales.write'), asyncHandler(salesOrders.cancel));
  sales.get('/invoices', requireAuth, asyncHandler(salesInvoices.list));
  sales.get('/invoices/:id', requireAuth, asyncHandler(salesInvoices.get));
  sales.post('/invoices', requireAuth, requirePermission('sales.write'), asyncHandler(salesInvoices.create));
  sales.post('/invoices/:id/issue', requireAuth, requirePermission('sales.write'), asyncHandler(salesInvoices.issue));
  sales.post('/invoices/:id/cancel', requireAuth, requirePermission('sales.write'), asyncHandler(salesInvoices.cancel));
  sales.post('/invoices/:id/reverse', requireAuth, requirePermission('sales.write'), asyncHandler(reversals.salesInvoice));
  sales.get('/accounts-receivable', requireAuth, requirePermission('sales.write'), asyncHandler(accountsReceivable.list));
  sales.get('/accounts-receivable/aging', requireAuth, requirePermission('sales.write'), asyncHandler(accountsReceivable.aging));
  sales.get('/accounts-receivable/:id', requireAuth, requirePermission('sales.write'), asyncHandler(accountsReceivable.get));
  sales.get('/customers/:customerId/accounts-receivable', requireAuth, requirePermission('sales.write'), asyncHandler(accountsReceivable.list));
  sales.post('/payments', requireAuth, requirePermission('sales.write'), asyncHandler(customerPayments.create));
  sales.post('/payments/:id/allocations', requireAuth, requirePermission('sales.write'), asyncHandler(customerPayments.allocate));
  sales.post('/payments/:id/reverse', requireAuth, requirePermission('sales.write'), asyncHandler(reversals.customerPayment));
  sales.get('/customers/:customerId/ledger', requireAuth, requirePermission('sales.write'), asyncHandler(customerLedger.get));
  sales.get('/customers/:customerId/statement', requireAuth, requirePermission('sales.write'), asyncHandler(customerLedger.get));
  sales.get('/deliveries', requireAuth, asyncHandler(workflow.listDeliveries));
  sales.get('/deliveries/:id', requireAuth, asyncHandler(workflow.getDelivery));
  sales.post('/deliveries', requireAuth, requirePermission('sales.write'), asyncHandler(workflow.createDelivery));
  sales.post('/deliveries/:id/dispatch', requireAuth, requirePermission('inventory.write'), asyncHandler(workflow.dispatchDelivery));
  procurement.get('/accounts-payable', requireAuth, requirePermission('procurement.write'), asyncHandler(accountsPayable.list));
  procurement.post('/payments', requireAuth, requirePermission('procurement.write'), asyncHandler(payments.create));
  procurement.put('/finance-config/:companyId', requireAuth, requirePermission('procurement.write'), asyncHandler(financeConfig.configure));
  procurement.patch('/bank-accounts/:id/gl-account', requireAuth, requirePermission('procurement.write'), asyncHandler(financeConfig.mapBank));
  procurement.post('/payments/:id/allocations', requireAuth, requirePermission('procurement.write'), asyncHandler(payments.allocate));
  procurement.post('/vendor-invoices/:id/reverse', requireAuth, requirePermission('procurement.write'), asyncHandler(reversals.invoice));
  procurement.post('/payments/:id/reverse', requireAuth, requirePermission('procurement.write'), asyncHandler(reversals.payment));
  procurement.post('/journals/:id/reverse', requireAuth, requirePermission('procurement.write'), asyncHandler(reversals.journal));
  procurement.get('/vendors/:vendorId/ledger', requireAuth, requirePermission('procurement.write'), asyncHandler(vendorLedger.get));
  procurement.get('/vendors/:vendorId/statement', requireAuth, requirePermission('procurement.write'), asyncHandler(vendorLedger.get));
  procurement.post('/bank-transactions', requireAuth, requirePermission('procurement.write'), asyncHandler(bankReconciliation.create));
  procurement.post('/bank-transactions/:id/match', requireAuth, requirePermission('procurement.write'), asyncHandler(bankReconciliation.match));
  procurement.post('/bank-transactions/:id/reconcile', requireAuth, requirePermission('procurement.write'), asyncHandler(bankReconciliation.reconcile));
  procurement.post('/bank-transactions/:id/unmatch', requireAuth, requirePermission('procurement.write'), asyncHandler(bankReconciliation.unmatch));
  procurement.get('/bank-reconciliation', requireAuth, requirePermission('procurement.write'), asyncHandler(bankReconciliation.report));
  procurement.get('/accounts-payable/aging', requireAuth, requirePermission('procurement.write'), asyncHandler(accountsPayable.aging));
  procurement.get('/accounts-payable/:id', requireAuth, requirePermission('procurement.write'), asyncHandler(accountsPayable.get));
  procurement.get('/vendors/:vendorId/accounts-payable', requireAuth, requirePermission('procurement.write'), asyncHandler(accountsPayable.list));
  for (const [path, handler] of Object.entries({
    'vendor-outstanding': financialReports.outstanding, 'purchase-register': financialReports.purchases,
    'gst-purchase-register': financialReports.gst, 'cash-flow-impact': financialReports.cashFlow,
    'trial-balance': financialReports.trialBalance, 'general-ledger': financialReports.generalLedger,
    'accounts-payable-aging': accountsPayable.aging
  })) procurement.get('/reports/' + path, requireAuth, requirePermission('procurement.write'), asyncHandler(handler));
  procurement.get('/reports/vendors/:vendorId/ledger', requireAuth, requirePermission('procurement.write'), asyncHandler(vendorLedger.get));
  const production = express.Router(); production.post('/work-orders/:id/consume', requireAuth, requirePermission('inventory.write'), asyncHandler(workflow.consumeProductionMaterials)); production.post('/work-orders/:id/output', requireAuth, requirePermission('inventory.write'), asyncHandler(workflow.outputProductionGoods));
  const documents = express.Router();
  documents.post('/upload', requireAuth, requirePermission('documents.write'), documentUpload, asyncHandler(workflow.uploadDocument));
  documents.post('/:id/retry', requireAuth, requirePermission('documents.write'), asyncHandler(workflow.retryDocument));
  documents.get('/', requireAuth, asyncHandler(workflow.listDocuments));
  documents.get('/reviews/:id', requireAuth, requirePermission('documents.review'), asyncHandler(workflow.getReview));
  documents.patch('/reviews/:id', requireAuth, requirePermission('documents.review'), asyncHandler(workflow.updateReview));
  documents.get('/:id/file', requireAuth, asyncHandler(workflow.getDocumentFile));
  documents.post('/', requireAuth, requirePermission('documents.write'), asyncHandler(workflow.createDocument));
  documents.get('/:id', requireAuth, asyncHandler(workflow.getDocument));
  documents.patch('/:id', requireAuth, requirePermission('documents.write'), asyncHandler(workflow.updateDocument));
  const approvalRoutes = express.Router(); approvalRoutes.post('/requests', requireAuth, requirePermission('approvals.create'), asyncHandler(approvals.createRequest)); approvalRoutes.post('/actions', requireAuth, requirePermission('approvals.action'), asyncHandler(approvals.act));
  const weighbridgeTickets = express.Router(); weighbridgeTickets.post('/', requireAuth, requirePermission('master.write'), asyncHandler(weighbridge.create)); weighbridgeTickets.patch('/:id', requireAuth, requirePermission('master.write'), asyncHandler(weighbridge.update));
  return { master, inventory, procurement, sales, production, documents, approvals: approvalRoutes, weighbridgeTickets, customers: crudRouter(configs.customers), vendors: crudRouter(configs.vendors) };
}

module.exports = { createRoutes, crudRouter };
