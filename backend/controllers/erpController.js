const prisma = require('../lib/prisma');
const { NotFoundError, ValidationError } = require('../lib/errors');

const id = (value, field = 'id') => {
  try { return BigInt(value); } catch { throw new ValidationError(`${field} must be an integer`); }
};
const date = (value) => value ? new Date(value) : undefined;
const number = (value, field) => {
  const result = Number(value);
  if (!Number.isFinite(result)) throw new ValidationError(`${field} must be a number`);
  return result;
};
const required = (body, fields) => {
  const missing = fields.filter((field) => body[field] === undefined || body[field] === null || body[field] === '');
  if (missing.length) throw new ValidationError('Required fields are missing', { fields: missing });
};
const itemsRequired = (body) => {
  if (!Array.isArray(body.items) || body.items.length === 0) throw new ValidationError('items must contain at least one line item');
  body.items.forEach((item, index) => {
    if (!item || item.inventory_item_id === undefined) throw new ValidationError(`items[${index}].inventory_item_id is required`);
    if (!item.uom) throw new ValidationError(`items[${index}].uom is required`);
    const quantity = item.requested_quantity ?? item.ordered_quantity ?? item.received_quantity ?? item.delivered_quantity ?? item.quantity;
    if (quantity === undefined || number(quantity, `items[${index}].quantity`) <= 0) throw new ValidationError(`items[${index}] quantity must be greater than zero`);
  });
};
const withItems = (itemRelation) => ({ [itemRelation]: true });

async function createWithItems(req, res, model, itemModel, data, makeItem, includeRelation) {
  itemsRequired(req.body);
  const result = await prisma.$transaction(async (tx) => {
    const parent = await tx[model].create({ data });
    for (const item of req.body.items) await tx[itemModel].create({ data: makeItem(parent, item) });
    return tx[model].findUnique({ where: { [Object.keys(data).find((key) => key.endsWith('_number'))]: data[Object.keys(data).find((key) => key.endsWith('_number'))] }, include: includeRelation });
  });
  res.status(201).json({ success: true, data: result });
}

async function createRequisition(req, res) {
  required(req.body, ['requisition_number']);
  return createWithItems(req, res, 'purchase_requisition', 'purchase_requisition_item', {
    requisition_number: req.body.requisition_number, department_id: req.body.department_id === undefined ? undefined : id(req.body.department_id, 'department_id'), requested_by: req.body.requested_by === undefined ? undefined : id(req.body.requested_by, 'requested_by'),
    requisition_date: date(req.body.requisition_date), required_date: date(req.body.required_date), status: req.body.status, remarks: req.body.remarks
  }, (parent, item) => ({ purchase_requisition_id: parent.purchase_requisition_id, inventory_item_id: id(item.inventory_item_id, 'inventory_item_id'), description: item.description, uom: item.uom, requested_quantity: number(item.requested_quantity ?? item.quantity, 'requested_quantity'), required_date: date(item.required_date), remarks: item.remarks }), withItems('purchase_requisition_item'));
}

async function createPurchaseOrder(req, res) {
  required(req.body, ['po_number', 'vendor_id']);
  return createWithItems(req, res, 'purchase_order', 'purchase_order_item', {
    po_number: req.body.po_number, vendor_id: id(req.body.vendor_id, 'vendor_id'), purchase_requisition_id: req.body.purchase_requisition_id === undefined ? undefined : id(req.body.purchase_requisition_id, 'purchase_requisition_id'), order_date: date(req.body.order_date), expected_date: date(req.body.expected_date), payment_terms: req.body.payment_terms, currency: req.body.currency, status: req.body.status, notes: req.body.notes
  }, (parent, item) => ({ purchase_order_id: parent.purchase_order_id, inventory_item_id: id(item.inventory_item_id, 'inventory_item_id'), description: item.description, hsn_sac_code: item.hsn_sac_code, uom: item.uom, ordered_quantity: number(item.ordered_quantity ?? item.quantity, 'ordered_quantity'), unit_rate: item.unit_rate === undefined ? undefined : number(item.unit_rate, 'unit_rate'), discount_amount: item.discount_amount === undefined ? undefined : number(item.discount_amount, 'discount_amount'), gst_rate: item.gst_rate === undefined ? undefined : number(item.gst_rate, 'gst_rate'), line_amount: item.line_amount === undefined ? undefined : number(item.line_amount, 'line_amount') }), withItems('purchase_order_item'));
}

async function createGrn(req, res) {
  required(req.body, ['grn_number', 'vendor_id', 'warehouse_id']);
  return createWithItems(req, res, 'grn', 'grn_item', {
    grn_number: req.body.grn_number, purchase_order_id: req.body.purchase_order_id === undefined ? undefined : id(req.body.purchase_order_id, 'purchase_order_id'), vendor_id: id(req.body.vendor_id, 'vendor_id'), warehouse_id: id(req.body.warehouse_id, 'warehouse_id'), vendor_invoice_id: req.body.vendor_invoice_id === undefined ? undefined : id(req.body.vendor_invoice_id, 'vendor_invoice_id'), grn_date: date(req.body.grn_date), gate_entry_number: req.body.gate_entry_number, supplier_invoice_number: req.body.supplier_invoice_number, challan_number: req.body.challan_number, remarks: req.body.remarks
  }, (parent, item) => ({ grn_id: parent.grn_id, purchase_order_item_id: item.purchase_order_item_id === undefined ? undefined : id(item.purchase_order_item_id, 'purchase_order_item_id'), inventory_item_id: id(item.inventory_item_id, 'inventory_item_id'), lot_id: item.lot_id === undefined ? undefined : id(item.lot_id, 'lot_id'), uom: item.uom, challan_quantity: item.challan_quantity === undefined ? undefined : number(item.challan_quantity, 'challan_quantity'), received_quantity: number(item.received_quantity ?? item.quantity, 'received_quantity'), accepted_quantity: item.accepted_quantity === undefined ? undefined : number(item.accepted_quantity, 'accepted_quantity'), rejected_quantity: item.rejected_quantity === undefined ? undefined : number(item.rejected_quantity, 'rejected_quantity'), rejection_reason: item.rejection_reason, rate: item.rate === undefined ? undefined : number(item.rate, 'rate') }), withItems('grn_item'));
}

async function createCustomerOrder(req, res) {
  required(req.body, ['order_number', 'customer_id']);
  return createWithItems(req, res, 'customer_order', 'customer_order_item', {
    order_number: req.body.order_number, customer_id: id(req.body.customer_id, 'customer_id'), order_date: date(req.body.order_date), buyer_order_number: req.body.buyer_order_number, buyer_order_date: date(req.body.buyer_order_date), order_type: req.body.order_type, payment_terms: req.body.payment_terms, bill_to_address: req.body.bill_to_address, ship_to_address: req.body.ship_to_address, status: req.body.status, remarks: req.body.remarks
  }, (parent, item) => ({ customer_order_id: parent.customer_order_id, inventory_item_id: id(item.inventory_item_id, 'inventory_item_id'), description: item.description, hsn_sac_code: item.hsn_sac_code, uom: item.uom, ordered_quantity: number(item.ordered_quantity ?? item.quantity, 'ordered_quantity'), unit_rate: item.unit_rate === undefined ? undefined : number(item.unit_rate, 'unit_rate'), gst_rate: item.gst_rate === undefined ? undefined : number(item.gst_rate, 'gst_rate'), line_amount: item.line_amount === undefined ? undefined : number(item.line_amount, 'line_amount') }), withItems('customer_order_item'));
}

async function createDelivery(req, res) {
  required(req.body, ['delivery_number', 'customer_id']);
  return createWithItems(req, res, 'delivery', 'delivery_item', {
    delivery_number: req.body.delivery_number, customer_id: id(req.body.customer_id, 'customer_id'), customer_order_id: req.body.customer_order_id === undefined ? undefined : id(req.body.customer_order_id, 'customer_order_id'), sales_invoice_id: req.body.sales_invoice_id === undefined ? undefined : id(req.body.sales_invoice_id, 'sales_invoice_id'), warehouse_id: req.body.warehouse_id === undefined ? undefined : id(req.body.warehouse_id, 'warehouse_id'), delivery_date: date(req.body.delivery_date), status: req.body.status, remarks: req.body.remarks
  }, (parent, item) => ({ delivery_id: parent.delivery_id, customer_order_item_id: item.customer_order_item_id === undefined ? undefined : id(item.customer_order_item_id, 'customer_order_item_id'), sales_invoice_item_id: item.sales_invoice_item_id === undefined ? undefined : id(item.sales_invoice_item_id, 'sales_invoice_item_id'), inventory_item_id: id(item.inventory_item_id, 'inventory_item_id'), lot_id: item.lot_id === undefined ? undefined : id(item.lot_id, 'lot_id'), description: item.description, uom: item.uom, ordered_quantity: item.ordered_quantity === undefined ? undefined : number(item.ordered_quantity, 'ordered_quantity'), delivered_quantity: number(item.delivered_quantity ?? item.quantity, 'delivered_quantity'), weight_kg: item.weight_kg === undefined ? undefined : number(item.weight_kg, 'weight_kg'), remarks: item.remarks }), withItems('delivery_item'));
}

async function createSalesInvoice(req, res) {
  required(req.body, ['invoice_number', 'customer_id']);
  return createWithItems(req, res, 'sales_invoice', 'sales_invoice_item', {
    invoice_number: req.body.invoice_number, invoice_type: req.body.invoice_type, customer_id: id(req.body.customer_id, 'customer_id'), customer_order_id: req.body.customer_order_id === undefined ? undefined : id(req.body.customer_order_id, 'customer_order_id'), invoice_date: date(req.body.invoice_date), due_date: date(req.body.due_date), payment_terms: req.body.payment_terms, taxable_amount: req.body.taxable_amount === undefined ? undefined : number(req.body.taxable_amount, 'taxable_amount'), cgst_amount: req.body.cgst_amount === undefined ? undefined : number(req.body.cgst_amount, 'cgst_amount'), sgst_amount: req.body.sgst_amount === undefined ? undefined : number(req.body.sgst_amount, 'sgst_amount'), igst_amount: req.body.igst_amount === undefined ? undefined : number(req.body.igst_amount, 'igst_amount'), total_amount: req.body.total_amount === undefined ? undefined : number(req.body.total_amount, 'total_amount'), status: req.body.status, notes: req.body.notes
  }, (parent, item) => ({ sales_invoice_id: parent.sales_invoice_id, customer_order_item_id: item.customer_order_item_id === undefined ? undefined : id(item.customer_order_item_id, 'customer_order_item_id'), inventory_item_id: item.inventory_item_id === undefined ? undefined : id(item.inventory_item_id, 'inventory_item_id'), description: item.description || '', hsn_sac_code: item.hsn_sac_code, uom: item.uom, quantity: item.quantity === undefined ? undefined : number(item.quantity, 'quantity'), unit_price: item.unit_price === undefined ? undefined : number(item.unit_price, 'unit_price'), discount_amount: item.discount_amount === undefined ? undefined : number(item.discount_amount, 'discount_amount'), taxable_amount: item.taxable_amount === undefined ? undefined : number(item.taxable_amount, 'taxable_amount'), gst_rate: item.gst_rate === undefined ? undefined : number(item.gst_rate, 'gst_rate'), line_total: item.line_total === undefined ? undefined : number(item.line_total, 'line_total') }), withItems('sales_invoice_item'));
}

async function createDocument(req, res) {
  required(req.body, ['document_type', 'file_name']);
  const result = await prisma.$transaction(async (tx) => {
    const document = await tx.document.create({ data: { document_type: req.body.document_type, reference_type: req.body.reference_type, reference_id: req.body.reference_id === undefined ? undefined : id(req.body.reference_id, 'reference_id'), file_name: req.body.file_name, file_url: req.body.file_url, mime_type: req.body.mime_type, uploaded_by: req.body.uploaded_by === undefined ? undefined : id(req.body.uploaded_by, 'uploaded_by'), metadata: req.body.metadata || {} } });
    if (!req.body.review) return document;
    await tx.invoice_extraction_review.create({ data: { document_id: document.document_id, extraction_status: req.body.review.extraction_status, extraction_engine: req.body.review.extraction_engine, extraction_version: req.body.review.extraction_version, raw_ocr_output: req.body.review.raw_ocr_output, extracted_fields: req.body.review.extracted_fields, confidence_score: req.body.review.confidence_score === undefined ? undefined : number(req.body.review.confidence_score, 'confidence_score') } });
    return tx.document.findUnique({ where: { document_id: document.document_id }, include: { invoice_extraction_review: true } });
  });
  res.status(201).json({ success: true, data: result });
}

async function getDocument(req, res) {
  const document = await prisma.document.findUnique({ where: { document_id: id(req.params.id) }, include: { invoice_extraction_review: true } });
  if (!document) throw new NotFoundError('document');
  res.json({ success: true, data: document });
}

async function updateDocument(req, res) {
  const document = await prisma.document.update({ where: { document_id: id(req.params.id) }, data: { document_type: req.body.document_type, reference_type: req.body.reference_type, reference_id: req.body.reference_id === undefined ? undefined : id(req.body.reference_id, 'reference_id'), file_name: req.body.file_name, file_url: req.body.file_url, mime_type: req.body.mime_type, metadata: req.body.metadata } });
  res.json({ success: true, data: document });
}

async function getReview(req, res) {
  const review = await prisma.invoice_extraction_review.findUnique({ where: { invoice_extraction_review_id: id(req.params.id) } });
  if (!review) throw new NotFoundError('invoice extraction review');
  res.json({ success: true, data: review });
}

async function updateReview(req, res) {
  const review = await prisma.invoice_extraction_review.update({ where: { invoice_extraction_review_id: id(req.params.id) }, data: { extraction_status: req.body.extraction_status, extracted_fields: req.body.extracted_fields, validation_errors: req.body.validation_errors, reviewer_id: req.body.reviewer_id === undefined ? undefined : id(req.body.reviewer_id, 'reviewer_id'), reviewer_decision: req.body.reviewer_decision, reviewed_at: date(req.body.reviewed_at), review_notes: req.body.review_notes, updated_at: new Date() } });
  res.json({ success: true, data: review });
}

async function createApprovalRequest(req, res) {
  required(req.body, ['approval_workflow_id', 'transaction_type', 'transaction_id']);
  const result = await prisma.$transaction(async (tx) => {
    const previous = await tx.approval_request.aggregate({ where: { transaction_type: req.body.transaction_type, transaction_id: id(req.body.transaction_id, 'transaction_id') }, _max: { request_version: true } });
    return tx.approval_request.create({ data: { approval_workflow_id: id(req.body.approval_workflow_id, 'approval_workflow_id'), transaction_type: req.body.transaction_type, transaction_id: id(req.body.transaction_id, 'transaction_id'), requester_id: req.body.requester_id === undefined ? undefined : id(req.body.requester_id, 'requester_id'), remarks: req.body.remarks, request_version: (previous._max.request_version || 0) + 1 } });
  });
  res.status(201).json({ success: true, data: result });
}

async function submitApprovalAction(req, res) {
  required(req.body, ['approval_workflow_id', 'transaction_type', 'transaction_id', 'action']);
  const action = await prisma.approval_action.create({ data: { approval_request_id: req.body.approval_request_id === undefined ? undefined : id(req.body.approval_request_id, 'approval_request_id'), approval_workflow_id: id(req.body.approval_workflow_id, 'approval_workflow_id'), approval_step_id: req.body.approval_step_id === undefined ? undefined : id(req.body.approval_step_id, 'approval_step_id'), transaction_type: req.body.transaction_type, transaction_id: id(req.body.transaction_id, 'transaction_id'), action_by: req.body.action_by === undefined ? undefined : id(req.body.action_by, 'action_by'), action: req.body.action, comments: req.body.comments } });
  res.status(201).json({ success: true, data: action });
}

module.exports = { createRequisition, createPurchaseOrder, createGrn, createCustomerOrder, createDelivery, createSalesInvoice, createDocument, getDocument, updateDocument, getReview, updateReview, createApprovalRequest, submitApprovalAction };