const prisma = require('../lib/prisma');
const { ApiError, NotFoundError, ValidationError } = require('../lib/errors');

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
async function createWithItems(req, res, model, itemModel, primaryKey, itemRelation, data, makeItem) {
  itemsRequired(req.body);
  const result = await prisma.$transaction(async (tx) => {
    const parent = await tx[model].create({ data });
    for (const item of req.body.items) await tx[itemModel].create({ data: makeItem(parent, item) });
    return tx[model].findUnique({ where: { [primaryKey]: parent[primaryKey] }, include: { [itemRelation]: true } });
  });
  res.status(201).json({ success: true, data: result });
}

async function createRequisition(req, res) {
  required(req.body, ['requisition_number']);
  return createWithItems(req, res, 'purchase_requisition', 'purchase_requisition_item', 'purchase_requisition_id', 'purchase_requisition_item', {
    requisition_number: req.body.requisition_number, department_id: req.body.department_id === undefined ? undefined : id(req.body.department_id, 'department_id'), requested_by: req.body.requested_by === undefined ? undefined : id(req.body.requested_by, 'requested_by'),
    requisition_date: date(req.body.requisition_date), required_date: date(req.body.required_date), status: req.body.status, remarks: req.body.remarks
  }, (parent, item) => ({ purchase_requisition_id: parent.purchase_requisition_id, inventory_item_id: id(item.inventory_item_id, 'inventory_item_id'), description: item.description, uom: item.uom, requested_quantity: number(item.requested_quantity ?? item.quantity, 'requested_quantity'), required_date: date(item.required_date), remarks: item.remarks }));
}

async function createPurchaseOrder(req, res) {
  required(req.body, ['po_number', 'vendor_id']);
  return createWithItems(req, res, 'purchase_order', 'purchase_order_item', 'purchase_order_id', 'purchase_order_item', {
    po_number: req.body.po_number, vendor_id: id(req.body.vendor_id, 'vendor_id'), purchase_requisition_id: req.body.purchase_requisition_id === undefined ? undefined : id(req.body.purchase_requisition_id, 'purchase_requisition_id'), order_date: date(req.body.order_date), expected_date: date(req.body.expected_date), payment_terms: req.body.payment_terms, currency: req.body.currency, status: req.body.status, notes: req.body.notes
  }, (parent, item) => ({ purchase_order_id: parent.purchase_order_id, inventory_item_id: id(item.inventory_item_id, 'inventory_item_id'), description: item.description, hsn_sac_code: item.hsn_sac_code, uom: item.uom, ordered_quantity: number(item.ordered_quantity ?? item.quantity, 'ordered_quantity'), unit_rate: item.unit_rate === undefined ? undefined : number(item.unit_rate, 'unit_rate'), discount_amount: item.discount_amount === undefined ? undefined : number(item.discount_amount, 'discount_amount'), gst_rate: item.gst_rate === undefined ? undefined : number(item.gst_rate, 'gst_rate'), line_amount: item.line_amount === undefined ? undefined : number(item.line_amount, 'line_amount') }));
}

async function createGrn(req, res) {
  required(req.body, ['grn_number', 'vendor_id', 'warehouse_id']);
  return createWithItems(req, res, 'grn', 'grn_item', 'grn_id', 'grn_item', {
    grn_number: req.body.grn_number, purchase_order_id: req.body.purchase_order_id === undefined ? undefined : id(req.body.purchase_order_id, 'purchase_order_id'), vendor_id: id(req.body.vendor_id, 'vendor_id'), warehouse_id: id(req.body.warehouse_id, 'warehouse_id'), vendor_invoice_id: req.body.vendor_invoice_id === undefined ? undefined : id(req.body.vendor_invoice_id, 'vendor_invoice_id'), grn_date: date(req.body.grn_date), inspection_status: 'PENDING', gate_entry_number: req.body.gate_entry_number, supplier_invoice_number: req.body.supplier_invoice_number, challan_number: req.body.challan_number, remarks: req.body.remarks
  }, (parent, item) => ({ grn_id: parent.grn_id, purchase_order_item_id: item.purchase_order_item_id === undefined ? undefined : id(item.purchase_order_item_id, 'purchase_order_item_id'), inventory_item_id: id(item.inventory_item_id, 'inventory_item_id'), lot_id: item.lot_id === undefined ? undefined : id(item.lot_id, 'lot_id'), uom: item.uom, challan_quantity: item.challan_quantity === undefined ? undefined : number(item.challan_quantity, 'challan_quantity'), received_quantity: number(item.received_quantity ?? item.quantity, 'received_quantity'), accepted_quantity: item.accepted_quantity === undefined ? undefined : number(item.accepted_quantity, 'accepted_quantity'), rejected_quantity: item.rejected_quantity === undefined ? undefined : number(item.rejected_quantity, 'rejected_quantity'), rejection_reason: item.rejection_reason, rate: item.rate === undefined ? undefined : number(item.rate, 'rate') }));
}

async function postGrn(req, res) {
  const grnId = id(req.params.id, 'id');
  const inspectionStatus = req.body.inspection_status || req.body.inspection_result;
  const acceptedByLine = new Map((Array.isArray(req.body.items) ? req.body.items : []).map((item) => [String(item.grn_item_id), item.accepted_quantity]));
  if (!['PASSED', 'PARTIAL', 'FAILED'].includes(inspectionStatus)) throw new ValidationError('inspection_status must be PASSED, PARTIAL, or FAILED');

  const result = await prisma.$transaction(async (tx) => {
    const grn = await tx.grn.findUnique({
      where: { grn_id: grnId },
      include: {
        warehouse: true,
        grn_item: { include: { inventory_item: true, purchase_order_item: true } },
        purchase_order: { include: { purchase_order_item: true, grn: { include: { grn_item: true } } } }
      }
    });
    if (!grn) throw new NotFoundError('grn');
    if (grn.inspection_status !== 'PENDING') throw new ApiError(409, 'GRN has already been inspected');

    const acceptedQuantities = new Map();
    for (const line of grn.grn_item) {
      const suppliedQuantity = acceptedByLine.has(String(line.grn_item_id))
        ? acceptedByLine.get(String(line.grn_item_id))
        : line.accepted_quantity;
      const acceptedQuantity = number(suppliedQuantity, `items[${line.grn_item_id}].accepted_quantity`);
      if (acceptedQuantity < 0) throw new ValidationError('accepted_quantity must be greater than or equal to zero');
      if (acceptedQuantity > Number(line.received_quantity)) throw new ValidationError('accepted_quantity cannot exceed received_quantity');
      if (inspectionStatus === 'FAILED' && acceptedQuantity !== 0) throw new ValidationError('FAILED GRNs must have zero accepted quantity');

      if (line.purchase_order_item_id && grn.purchase_order) {
        const otherAccepted = grn.purchase_order.grn.reduce((total, otherGrn) => {
          if (otherGrn.grn_id === grn.grn_id || !['PASSED', 'PARTIAL', 'FAILED'].includes(otherGrn.inspection_status)) return total;
          return total + otherGrn.grn_item
            .filter((otherLine) => otherLine.purchase_order_item_id === line.purchase_order_item_id)
            .reduce((sum, otherLine) => sum + Number(otherLine.accepted_quantity), 0);
        }, 0);
        const purchaseOrderItem = grn.purchase_order.purchase_order_item.find((item) => item.purchase_order_item_id === line.purchase_order_item_id);
        if (!purchaseOrderItem) throw new ValidationError('GRN line is not linked to a purchase order line');
        const remainingQuantity = Number(purchaseOrderItem.ordered_quantity) - otherAccepted;
        if (acceptedQuantity > remainingQuantity) throw new ValidationError('accepted_quantity cannot exceed the remaining purchase order quantity');
      }
      acceptedQuantities.set(line.grn_item_id.toString(), acceptedQuantity);
    }
    for (const item of Array.isArray(req.body.items) ? req.body.items : []) {
      if (!grn.grn_item.some((line) => line.grn_item_id.toString() === String(item.grn_item_id))) throw new ValidationError('Each item must belong to this GRN');
    }

    for (const line of grn.grn_item) {
      const acceptedQuantity = acceptedQuantities.get(line.grn_item_id.toString());
      await tx.grn_item.update({ where: { grn_item_id: line.grn_item_id }, data: { accepted_quantity: acceptedQuantity } });
      if (acceptedQuantity <= 0) continue;

      let lotId = line.lot_id;
      if (line.inventory_item.is_lot_tracked) {
        if (lotId) {
          const lot = await tx.inventory_lot.findUnique({ where: { lot_id: lotId } });
          if (!lot || lot.inventory_item_id !== line.inventory_item_id || lot.warehouse_id !== grn.warehouse_id) throw new ValidationError('GRN lot does not match the item and warehouse');
          await tx.inventory_lot.update({ where: { lot_id: lotId }, data: { quantity_received: { increment: acceptedQuantity }, accepted_quantity: { increment: acceptedQuantity } } });
        } else {
          const lotNumber = line.heat_number || `GRN-${grn.grn_id}-${line.grn_item_id}`;
          const lot = await tx.inventory_lot.upsert({
            where: { warehouse_id_lot_number: { warehouse_id: grn.warehouse_id, lot_number: lotNumber } },
            update: { quantity_received: { increment: acceptedQuantity }, accepted_quantity: { increment: acceptedQuantity } },
            create: { inventory_item_id: line.inventory_item_id, warehouse_id: grn.warehouse_id, lot_number: lotNumber, heat_number: line.heat_number, supplier_id: grn.vendor_id, received_date: grn.grn_date, quantity_received: acceptedQuantity, accepted_quantity: acceptedQuantity }
          });
          lotId = lot.lot_id;
          await tx.grn_item.update({ where: { grn_item_id: line.grn_item_id }, data: { lot_id: lotId } });
        }
      }

      const stock = await tx.inventory_stock.findFirst({ where: { inventory_item_id: line.inventory_item_id, warehouse_id: grn.warehouse_id, lot_id: lotId } });
      if (stock) await tx.inventory_stock.update({ where: { inventory_stock_id: stock.inventory_stock_id }, data: { quantity: { increment: acceptedQuantity }, last_updated_at: new Date() } });
      else await tx.inventory_stock.create({ data: { inventory_item_id: line.inventory_item_id, warehouse_id: grn.warehouse_id, lot_id: lotId, quantity: acceptedQuantity } });
      await tx.stock_movement.create({ data: { inventory_item_id: line.inventory_item_id, warehouse_id: grn.warehouse_id, lot_id: lotId, movement_type: 'PURCHASE_RECEIPT', reference_type: 'GRN', reference_id: grn.grn_id, quantity: acceptedQuantity, movement_date: new Date(), remarks: `GRN ${grn.grn_number}` } });
    }

    const inspectedGrn = await tx.grn.update({ where: { grn_id: grn.grn_id }, data: { inspection_status: inspectionStatus, inspected_by: req.user.user_id, inspection_date: new Date() } });
    if (grn.purchase_order) {
      const receivedLines = await tx.grn_item.findMany({ where: { grn: { purchase_order_id: grn.purchase_order.purchase_order_id, inspection_status: { in: ['PASSED', 'PARTIAL', 'FAILED'] } } }, select: { purchase_order_item_id: true, accepted_quantity: true } });
      const allReceived = grn.purchase_order.purchase_order_item.every((purchaseOrderItem) => receivedLines.filter((line) => line.purchase_order_item_id === purchaseOrderItem.purchase_order_item_id).reduce((sum, line) => sum + Number(line.accepted_quantity), 0) >= Number(purchaseOrderItem.ordered_quantity));
      await tx.purchase_order.update({ where: { purchase_order_id: grn.purchase_order.purchase_order_id }, data: { status: allReceived ? 'RECEIVED' : 'PARTIALLY_RECEIVED' } });
    }
    return tx.grn.findUnique({ where: { grn_id: inspectedGrn.grn_id }, include: { grn_item: true, purchase_order: true } });
  });
  res.json({ success: true, data: result });
}

async function createCustomerOrder(req, res) {
  required(req.body, ['order_number', 'customer_id']);
  return createWithItems(req, res, 'customer_order', 'customer_order_item', 'customer_order_id', 'customer_order_item', {
    order_number: req.body.order_number, customer_id: id(req.body.customer_id, 'customer_id'), order_date: date(req.body.order_date), buyer_order_number: req.body.buyer_order_number, buyer_order_date: date(req.body.buyer_order_date), order_type: req.body.order_type, payment_terms: req.body.payment_terms, bill_to_address: req.body.bill_to_address, ship_to_address: req.body.ship_to_address, status: req.body.status, remarks: req.body.remarks
  }, (parent, item) => ({ customer_order_id: parent.customer_order_id, inventory_item_id: id(item.inventory_item_id, 'inventory_item_id'), description: item.description, hsn_sac_code: item.hsn_sac_code, uom: item.uom, ordered_quantity: number(item.ordered_quantity ?? item.quantity, 'ordered_quantity'), unit_rate: item.unit_rate === undefined ? undefined : number(item.unit_rate, 'unit_rate'), gst_rate: item.gst_rate === undefined ? undefined : number(item.gst_rate, 'gst_rate'), line_amount: item.line_amount === undefined ? undefined : number(item.line_amount, 'line_amount') }));
}

async function createDelivery(req, res) {
  required(req.body, ['delivery_number', 'customer_id']);
  return createWithItems(req, res, 'delivery', 'delivery_item', 'delivery_id', 'delivery_item', {
    delivery_number: req.body.delivery_number, customer_id: id(req.body.customer_id, 'customer_id'), customer_order_id: req.body.customer_order_id === undefined ? undefined : id(req.body.customer_order_id, 'customer_order_id'), sales_invoice_id: req.body.sales_invoice_id === undefined ? undefined : id(req.body.sales_invoice_id, 'sales_invoice_id'), warehouse_id: req.body.warehouse_id === undefined ? undefined : id(req.body.warehouse_id, 'warehouse_id'), delivery_date: date(req.body.delivery_date), status: req.body.status, remarks: req.body.remarks
  }, (parent, item) => ({ delivery_id: parent.delivery_id, customer_order_item_id: item.customer_order_item_id === undefined ? undefined : id(item.customer_order_item_id, 'customer_order_item_id'), sales_invoice_item_id: item.sales_invoice_item_id === undefined ? undefined : id(item.sales_invoice_item_id, 'sales_invoice_item_id'), inventory_item_id: id(item.inventory_item_id, 'inventory_item_id'), lot_id: item.lot_id === undefined ? undefined : id(item.lot_id, 'lot_id'), description: item.description, uom: item.uom, ordered_quantity: item.ordered_quantity === undefined ? undefined : number(item.ordered_quantity, 'ordered_quantity'), delivered_quantity: number(item.delivered_quantity ?? item.quantity, 'delivered_quantity'), weight_kg: item.weight_kg === undefined ? undefined : number(item.weight_kg, 'weight_kg'), remarks: item.remarks }));
}

async function createSalesInvoice(req, res) {
  required(req.body, ['invoice_number', 'customer_id']);
  return createWithItems(req, res, 'sales_invoice', 'sales_invoice_item', 'sales_invoice_id', 'sales_invoice_item', {
    invoice_number: req.body.invoice_number, invoice_type: req.body.invoice_type, customer_id: id(req.body.customer_id, 'customer_id'), customer_order_id: req.body.customer_order_id === undefined ? undefined : id(req.body.customer_order_id, 'customer_order_id'), invoice_date: date(req.body.invoice_date), due_date: date(req.body.due_date), payment_terms: req.body.payment_terms, taxable_amount: req.body.taxable_amount === undefined ? undefined : number(req.body.taxable_amount, 'taxable_amount'), cgst_amount: req.body.cgst_amount === undefined ? undefined : number(req.body.cgst_amount, 'cgst_amount'), sgst_amount: req.body.sgst_amount === undefined ? undefined : number(req.body.sgst_amount, 'sgst_amount'), igst_amount: req.body.igst_amount === undefined ? undefined : number(req.body.igst_amount, 'igst_amount'), total_amount: req.body.total_amount === undefined ? undefined : number(req.body.total_amount, 'total_amount'), status: req.body.status, notes: req.body.notes
  }, (parent, item) => ({ sales_invoice_id: parent.sales_invoice_id, customer_order_item_id: item.customer_order_item_id === undefined ? undefined : id(item.customer_order_item_id, 'customer_order_item_id'), inventory_item_id: item.inventory_item_id === undefined ? undefined : id(item.inventory_item_id, 'inventory_item_id'), description: item.description || '', hsn_sac_code: item.hsn_sac_code, uom: item.uom, quantity: item.quantity === undefined ? undefined : number(item.quantity, 'quantity'), unit_price: item.unit_price === undefined ? undefined : number(item.unit_price, 'unit_price'), discount_amount: item.discount_amount === undefined ? undefined : number(item.discount_amount, 'discount_amount'), taxable_amount: item.taxable_amount === undefined ? undefined : number(item.taxable_amount, 'taxable_amount'), gst_rate: item.gst_rate === undefined ? undefined : number(item.gst_rate, 'gst_rate'), line_total: item.line_total === undefined ? undefined : number(item.line_total, 'line_total') }));
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

module.exports = { createRequisition, createPurchaseOrder, createGrn, postGrn, createCustomerOrder, createDelivery, createSalesInvoice, createDocument, getDocument, updateDocument, getReview, updateReview, createApprovalRequest, submitApprovalAction };