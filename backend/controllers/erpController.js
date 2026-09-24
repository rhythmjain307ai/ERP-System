const prisma = require('../lib/prisma');
const fs = require('fs/promises');
const path = require('path');
const { processDocument } = require('../lib/ocr/documentProcessor');
const { databaseStatus, publicReview, publicDocument } = require('../lib/ocr/documentContract');
const { validateInvoice } = require('../lib/ocr/invoiceValidator');
const { uploadDirectory, verifyUploadedFile } = require('../middleware/upload');
const { ApiError, NotFoundError, ValidationError } = require('../lib/errors');

async function lockStockBalance(tx, inventoryItemId, warehouseId, lotId) {
  const key = `${inventoryItemId}:${warehouseId}:${lotId || 'null'}`;
  await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${key}, 0::bigint))`;
  const rows = await tx.$queryRaw`SELECT "inventory_stock_id", "quantity", "reserved_quantity" FROM "public"."inventory_stock" WHERE "inventory_item_id" = ${inventoryItemId} AND "warehouse_id" = ${warehouseId} AND "lot_id" IS NOT DISTINCT FROM ${lotId} FOR UPDATE`;
  return rows[0] || null;
}

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
  if (req.body.purchase_order_id !== undefined && (!Array.isArray(req.body.items) || req.body.items.some((item) => item.purchase_order_item_id === undefined || item.purchase_order_item_id === null))) throw new ValidationError('PO-linked GRN items must reference a purchase order item');
  return createWithItems(req, res, 'grn', 'grn_item', 'grn_id', 'grn_item', {
    grn_number: req.body.grn_number, purchase_order_id: req.body.purchase_order_id === undefined ? undefined : id(req.body.purchase_order_id, 'purchase_order_id'), vendor_id: id(req.body.vendor_id, 'vendor_id'), warehouse_id: id(req.body.warehouse_id, 'warehouse_id'), vendor_invoice_id: req.body.vendor_invoice_id === undefined ? undefined : id(req.body.vendor_invoice_id, 'vendor_invoice_id'), grn_date: date(req.body.grn_date), inspection_status: 'PENDING', gate_entry_number: req.body.gate_entry_number, supplier_invoice_number: req.body.supplier_invoice_number, challan_number: req.body.challan_number, remarks: req.body.remarks
  }, (parent, item) => {
    const receivedQuantity = number(item.received_quantity ?? item.quantity, 'received_quantity');
    const acceptedQuantity = item.accepted_quantity === undefined ? undefined : number(item.accepted_quantity, 'accepted_quantity');
    const rejectedQuantity = item.rejected_quantity === undefined ? undefined : number(item.rejected_quantity, 'rejected_quantity');
    for (const [name, value] of [['received_quantity', receivedQuantity], ['accepted_quantity', acceptedQuantity], ['rejected_quantity', rejectedQuantity]]) {
      if (value !== undefined && value < 0) throw new ValidationError(`${name} must be greater than or equal to zero`);
      if (value !== undefined && value > receivedQuantity) throw new ValidationError(`${name} cannot exceed received_quantity`);
    }
    if (acceptedQuantity !== undefined && rejectedQuantity !== undefined && acceptedQuantity + rejectedQuantity !== receivedQuantity) throw new ValidationError('accepted_quantity plus rejected_quantity must equal received_quantity');
    return { grn_id: parent.grn_id, purchase_order_item_id: item.purchase_order_item_id === undefined ? undefined : id(item.purchase_order_item_id, 'purchase_order_item_id'), inventory_item_id: id(item.inventory_item_id, 'inventory_item_id'), lot_id: item.lot_id === undefined ? undefined : id(item.lot_id, 'lot_id'), uom: item.uom, challan_quantity: item.challan_quantity === undefined ? undefined : number(item.challan_quantity, 'challan_quantity'), received_quantity: receivedQuantity, accepted_quantity: acceptedQuantity, rejected_quantity: rejectedQuantity, rejection_reason: item.rejection_reason, rate: item.rate === undefined ? undefined : number(item.rate, 'rate') };
  });
}

async function postGrn(req, res) {
  const grnId = id(req.params.id, 'id');
  const inspectionStatus = req.body.inspection_status || req.body.inspection_result;
  const acceptedByLine = new Map((Array.isArray(req.body.items) ? req.body.items : []).map((item) => [String(item.grn_item_id), item.accepted_quantity]));
  const rejectedByLine = new Map((Array.isArray(req.body.items) ? req.body.items : []).map((item) => [String(item.grn_item_id), item.rejected_quantity]));
  const rejectionReasonByLine = new Map((Array.isArray(req.body.items) ? req.body.items : []).map((item) => [String(item.grn_item_id), item.rejection_reason]));
  if (!['PASSED', 'PARTIAL', 'FAILED'].includes(inspectionStatus)) throw new ValidationError('inspection_status must be PASSED, PARTIAL, or FAILED');

  const result = await prisma.$transaction(async (tx) => {
    const lockedGrn = await tx.$queryRaw`SELECT "grn_id" FROM "public"."grn" WHERE "grn_id" = ${grnId} FOR UPDATE`;
    if (lockedGrn.length === 0) throw new NotFoundError('grn');
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

    if (grn.purchase_order) {
      if (grn.vendor_id !== grn.purchase_order.vendor_id) throw new ValidationError('GRN vendor must match the purchase order vendor');
      for (const line of grn.grn_item) {
        if (!line.purchase_order_item_id) throw new ValidationError('PO-linked GRN items must reference a purchase order item');
        const purchaseOrderItem = grn.purchase_order.purchase_order_item.find((item) => item.purchase_order_item_id === line.purchase_order_item_id);
        if (!purchaseOrderItem) throw new ValidationError('GRN line is not linked to a purchase order line');
        if (line.inventory_item_id !== purchaseOrderItem.inventory_item_id) throw new ValidationError('GRN item must match its purchase order item');
        if (line.uom !== purchaseOrderItem.uom) throw new ValidationError('GRN item UOM must match its purchase order item UOM');
      }
    }

    const acceptedQuantities = new Map();
    const rejectedQuantities = new Map();
    const rejectionReasons = new Map();
    for (const line of grn.grn_item) {
      const suppliedQuantity = acceptedByLine.has(String(line.grn_item_id))
        ? acceptedByLine.get(String(line.grn_item_id))
        : line.accepted_quantity;
      const acceptedQuantity = number(suppliedQuantity, `items[${line.grn_item_id}].accepted_quantity`);
      const receivedQuantity = number(line.received_quantity, `items[${line.grn_item_id}].received_quantity`);
      const suppliedRejectedQuantity = rejectedByLine.has(String(line.grn_item_id)) ? rejectedByLine.get(String(line.grn_item_id)) : undefined;
      const rejectedQuantity = suppliedRejectedQuantity === undefined ? receivedQuantity - acceptedQuantity : number(suppliedRejectedQuantity, `items[${line.grn_item_id}].rejected_quantity`);
      if (receivedQuantity < 0) throw new ValidationError('received_quantity must be greater than or equal to zero');
      if (acceptedQuantity < 0) throw new ValidationError('accepted_quantity must be greater than or equal to zero');
      if (rejectedQuantity < 0) throw new ValidationError('rejected_quantity must be greater than or equal to zero');
      if (acceptedQuantity > receivedQuantity) throw new ValidationError('accepted_quantity cannot exceed received_quantity');
      if (rejectedQuantity > receivedQuantity) throw new ValidationError('rejected_quantity cannot exceed received_quantity');
      if (acceptedQuantity + rejectedQuantity !== receivedQuantity) throw new ValidationError('accepted_quantity plus rejected_quantity must equal received_quantity');
      if (inspectionStatus === 'FAILED' && acceptedQuantity !== 0) throw new ValidationError('FAILED GRNs must have zero accepted quantity');

      if (line.purchase_order_item_id && grn.purchase_order) {
        const otherAccepted = grn.purchase_order.grn.reduce((total, otherGrn) => {
          if (otherGrn.grn_id === grn.grn_id || !['PASSED', 'PARTIAL', 'FAILED'].includes(otherGrn.inspection_status)) return total;
          return total + otherGrn.grn_item
            .filter((otherLine) => otherLine.purchase_order_item_id === line.purchase_order_item_id)
            .reduce((sum, otherLine) => sum + Number(otherLine.accepted_quantity), 0);
        }, 0);
        const purchaseOrderItem = grn.purchase_order.purchase_order_item.find((item) => item.purchase_order_item_id === line.purchase_order_item_id);
        const remainingQuantity = Number(purchaseOrderItem.ordered_quantity) - otherAccepted;
        if (acceptedQuantity > remainingQuantity) throw new ValidationError('accepted_quantity cannot exceed the remaining purchase order quantity');
      }
      acceptedQuantities.set(line.grn_item_id.toString(), acceptedQuantity);
      rejectedQuantities.set(line.grn_item_id.toString(), rejectedQuantity);
      if (rejectionReasonByLine.has(String(line.grn_item_id))) rejectionReasons.set(line.grn_item_id.toString(), rejectionReasonByLine.get(String(line.grn_item_id)));
    }
    for (const item of Array.isArray(req.body.items) ? req.body.items : []) {
      if (!grn.grn_item.some((line) => line.grn_item_id.toString() === String(item.grn_item_id))) throw new ValidationError('Each item must belong to this GRN');
    }

    for (const line of grn.grn_item) {
      const acceptedQuantity = acceptedQuantities.get(line.grn_item_id.toString());
      const rejectedQuantity = rejectedQuantities.get(line.grn_item_id.toString());
      const rejectionReason = rejectionReasons.get(line.grn_item_id.toString());
      await tx.grn_item.update({ where: { grn_item_id: line.grn_item_id }, data: { accepted_quantity: acceptedQuantity, rejected_quantity: rejectedQuantity, rejection_reason: rejectionReason === undefined ? undefined : rejectionReason } });
      if (acceptedQuantity <= 0) continue;

      let lotId = line.lot_id;
      if (line.inventory_item.is_lot_tracked) {
        if (lotId) {
          const lot = await tx.inventory_lot.findUnique({ where: { lot_id: lotId } });
          if (!lot || lot.inventory_item_id !== line.inventory_item_id || lot.warehouse_id !== grn.warehouse_id) throw new ValidationError('GRN lot does not match the item and warehouse');
          await tx.inventory_lot.update({ where: { lot_id: lotId }, data: { quantity_received: { increment: acceptedQuantity }, accepted_quantity: { increment: acceptedQuantity } } });
        } else {
          const lotNumber = line.heat_number || `GRN-${grn.grn_id}-${line.grn_item_id}`;
          const existingLot = await tx.inventory_lot.findUnique({ where: { warehouse_id_lot_number: { warehouse_id: grn.warehouse_id, lot_number: lotNumber } } });
          if (existingLot && (existingLot.inventory_item_id !== line.inventory_item_id || existingLot.warehouse_id !== grn.warehouse_id)) throw new ValidationError('GRN lot does not match the item and warehouse');
          const lot = existingLot
            ? await tx.inventory_lot.update({ where: { lot_id: existingLot.lot_id }, data: { quantity_received: { increment: acceptedQuantity }, accepted_quantity: { increment: acceptedQuantity } } })
            : await tx.inventory_lot.create({ data: { inventory_item_id: line.inventory_item_id, warehouse_id: grn.warehouse_id, lot_number: lotNumber, heat_number: line.heat_number, supplier_id: grn.vendor_id, received_date: grn.grn_date, quantity_received: acceptedQuantity, accepted_quantity: acceptedQuantity } });
          lotId = lot.lot_id;
          await tx.grn_item.update({ where: { grn_item_id: line.grn_item_id }, data: { lot_id: lotId } });
        }
      }

      const stock = await lockStockBalance(tx, line.inventory_item_id, grn.warehouse_id, lotId);
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
    delivery_number: req.body.delivery_number, customer_id: id(req.body.customer_id, 'customer_id'), customer_order_id: req.body.customer_order_id === undefined ? undefined : id(req.body.customer_order_id, 'customer_order_id'), sales_invoice_id: req.body.sales_invoice_id === undefined ? undefined : id(req.body.sales_invoice_id, 'sales_invoice_id'), warehouse_id: req.body.warehouse_id === undefined ? undefined : id(req.body.warehouse_id, 'warehouse_id'), delivery_date: date(req.body.delivery_date), status: 'DRAFT', remarks: req.body.remarks
  }, (parent, item) => ({ delivery_id: parent.delivery_id, customer_order_item_id: item.customer_order_item_id === undefined ? undefined : id(item.customer_order_item_id, 'customer_order_item_id'), sales_invoice_item_id: item.sales_invoice_item_id === undefined ? undefined : id(item.sales_invoice_item_id, 'sales_invoice_item_id'), inventory_item_id: id(item.inventory_item_id, 'inventory_item_id'), lot_id: item.lot_id === undefined ? undefined : id(item.lot_id, 'lot_id'), description: item.description, uom: item.uom, ordered_quantity: item.ordered_quantity === undefined ? undefined : number(item.ordered_quantity, 'ordered_quantity'), delivered_quantity: number(item.delivered_quantity ?? item.quantity, 'delivered_quantity'), weight_kg: item.weight_kg === undefined ? undefined : number(item.weight_kg, 'weight_kg'), remarks: item.remarks }));
}

async function dispatchDelivery(req, res) {
  const deliveryId = id(req.params.id, 'id');
  const result = await prisma.$transaction(async (tx) => {
    const lockedDelivery = await tx.$queryRaw`SELECT "delivery_id" FROM "public"."delivery" WHERE "delivery_id" = ${deliveryId} FOR UPDATE`;
    if (lockedDelivery.length === 0) throw new NotFoundError('delivery');

    const delivery = await tx.delivery.findUnique({
      where: { delivery_id: deliveryId },
      include: {
        delivery_item: { include: { inventory_item: true } },
        customer_order: { include: { customer_order_item: true } },
        sales_invoice: { include: { sales_invoice_item: true } }
      }
    });
    if (!delivery) throw new NotFoundError('delivery');
    if (!['DRAFT', 'READY'].includes(delivery.status)) throw new ApiError(409, `Delivery is already ${delivery.status}`);
    if (!delivery.warehouse_id) throw new ValidationError('Delivery warehouse_id is required before dispatch');
    if (delivery.customer_order_id && !delivery.customer_order) throw new ValidationError('Delivery customer order could not be found');
    if (delivery.sales_invoice_id && !delivery.sales_invoice) throw new ValidationError('Delivery sales invoice could not be found');
    if (delivery.customer_order && delivery.customer_id !== delivery.customer_order.customer_id) throw new ValidationError('Delivery customer must match the customer-order customer');
    if (delivery.sales_invoice && delivery.customer_id !== delivery.sales_invoice.customer_id) throw new ValidationError('Delivery customer must match the sales-invoice customer');
    if (delivery.customer_order && delivery.sales_invoice && delivery.customer_order.customer_id !== delivery.sales_invoice.customer_id) throw new ValidationError('Customer order and sales invoice must belong to the same customer');

    const customerOrderItems = new Map((delivery.customer_order?.customer_order_item || []).map((item) => [item.customer_order_item_id.toString(), item]));
    const salesInvoiceItems = new Map((delivery.sales_invoice?.sales_invoice_item || []).map((item) => [item.sales_invoice_item_id.toString(), item]));
    const stockLines = [];
    const linkedLines = new Map();
    for (const line of delivery.delivery_item) {
      const deliveredQuantity = Number(line.delivered_quantity);
      if (!Number.isFinite(deliveredQuantity) || deliveredQuantity <= 0) throw new ValidationError(`Delivery item ${line.delivery_item_id} delivered_quantity must be greater than zero`);

      if (line.customer_order_item_id) {
        const orderItem = customerOrderItems.get(line.customer_order_item_id.toString());
        if (!orderItem || orderItem.inventory_item_id !== line.inventory_item_id || orderItem.uom !== line.uom) throw new ValidationError(`Delivery item ${line.delivery_item_id} does not match its customer-order item`);
      }
      if (line.sales_invoice_item_id) {
        const invoiceItem = salesInvoiceItems.get(line.sales_invoice_item_id.toString());
        if (!invoiceItem || invoiceItem.inventory_item_id !== line.inventory_item_id || invoiceItem.uom !== line.uom) throw new ValidationError(`Delivery item ${line.delivery_item_id} does not match its sales-invoice item`);
      }
      if (line.customer_order_item_id) linkedLines.set(`order:${line.customer_order_item_id}`, { type: 'customer order', id: line.customer_order_item_id, limit: customerOrderItems.get(line.customer_order_item_id.toString()).ordered_quantity, quantityField: 'ordered_quantity', requested: (linkedLines.get(`order:${line.customer_order_item_id}`)?.requested || 0) + deliveredQuantity });
      if (line.sales_invoice_item_id) linkedLines.set(`invoice:${line.sales_invoice_item_id}`, { type: 'sales invoice', id: line.sales_invoice_item_id, limit: salesInvoiceItems.get(line.sales_invoice_item_id.toString()).quantity, quantityField: 'quantity', requested: (linkedLines.get(`invoice:${line.sales_invoice_item_id}`)?.requested || 0) + deliveredQuantity });
      if (line.lot_id) {
        const lot = await tx.inventory_lot.findUnique({ where: { lot_id: line.lot_id } });
        if (!lot || lot.inventory_item_id !== line.inventory_item_id || lot.warehouse_id !== delivery.warehouse_id) throw new ValidationError(`Delivery item ${line.delivery_item_id} lot does not match the item and warehouse`);
      }
      stockLines.push({ line, deliveredQuantity, key: `${line.inventory_item_id}:${delivery.warehouse_id}:${line.lot_id || 'null'}` });
    }

    for (const linkedLine of [...linkedLines.values()].sort((left, right) => `${left.type}:${left.id}`.localeCompare(`${right.type}:${right.id}`))) {
      const lockKey = `delivery-limit:${linkedLine.type}:${linkedLine.id}`;
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${lockKey}, 0::bigint))`;
      const previous = await tx.delivery_item.aggregate({
        where: {
          [linkedLine.type === 'customer order' ? 'customer_order_item_id' : 'sales_invoice_item_id']: linkedLine.id,
          delivery_id: { not: delivery.delivery_id },
          delivery: { status: { in: ['DISPATCHED', 'DELIVERED'] } }
        },
        _sum: { delivered_quantity: true }
      });
      const previousQuantity = Number(previous._sum.delivered_quantity || 0);
      const totalQuantity = previousQuantity + linkedLine.requested;
      const limit = Number(linkedLine.limit);
      if (totalQuantity > limit) {
        const excess = totalQuantity - limit;
        throw new ValidationError(`Delivery ${linkedLine.type} line ${linkedLine.id} exceeds ${linkedLine.quantityField} ${limit}: previously dispatched ${previousQuantity}, current requested ${linkedLine.requested}, excess ${excess}`);
      }
    }

    const stockBalances = new Map();
    const requestedByStock = new Map();
    for (const stockLine of stockLines.sort((left, right) => left.key.localeCompare(right.key))) {
      const { line, deliveredQuantity, key } = stockLine;
      if (!stockBalances.has(key)) {
        stockBalances.set(key, await lockStockBalance(tx, line.inventory_item_id, delivery.warehouse_id, line.lot_id));
      }
      const stock = stockBalances.get(key);
      const available = stock ? Number(stock.quantity) - Number(stock.reserved_quantity) : 0;
      const alreadyRequested = requestedByStock.get(key) || 0;
      const requested = alreadyRequested + deliveredQuantity;
      if (!stock) throw new ValidationError(`Insufficient stock for item ${line.inventory_item_id} in warehouse ${delivery.warehouse_id}: requested ${requested}, available ${available}, shortage ${requested - available}`);
      if (requested > available) throw new ValidationError(`Insufficient stock for item ${line.inventory_item_id} in warehouse ${delivery.warehouse_id}: requested ${requested}, available ${available}, shortage ${requested - available}`);
      requestedByStock.set(key, requested);
    }

    for (const stockLine of stockLines) {
      const stock = stockBalances.get(stockLine.key);
      await tx.inventory_stock.update({ where: { inventory_stock_id: stock.inventory_stock_id }, data: { quantity: { decrement: stockLine.deliveredQuantity }, last_updated_at: new Date() } });
      await tx.stock_movement.create({ data: { inventory_item_id: stockLine.line.inventory_item_id, warehouse_id: delivery.warehouse_id, lot_id: stockLine.line.lot_id, movement_type: 'SALE_ISSUE', reference_type: 'DELIVERY', reference_id: delivery.delivery_id, quantity: stockLine.deliveredQuantity, movement_date: new Date(), remarks: `Delivery ${delivery.delivery_number}` } });
    }

    return tx.delivery.update({ where: { delivery_id: delivery.delivery_id }, data: { status: 'DISPATCHED' }, include: { delivery_item: true } });
  });
  res.json({ success: true, data: result });
}

async function consumeProductionMaterials(req, res) {
  const workOrderId = id(req.params.id, 'id');
  const productionQuantity = number(req.body.production_quantity ?? req.body.quantity, 'production_quantity');
  if (productionQuantity <= 0) throw new ValidationError('production_quantity must be greater than zero');
  const lines = req.body.items || req.body.consumption_lines;
  if (!Array.isArray(lines) || lines.length === 0) throw new ValidationError('items must contain at least one consumption line');

  const result = await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw`SELECT "work_order_id" FROM "public"."work_order" WHERE "work_order_id" = ${workOrderId} FOR UPDATE`;
    if (locked.length === 0) throw new NotFoundError('work order');
    const workOrder = await tx.work_order.findUnique({
      where: { work_order_id: workOrderId },
      include: { production_order: { include: { bill_of_material: { include: { bom_item: { include: { inventory_item: true } } } }, factory: true } } }
    });
    if (!workOrder) throw new NotFoundError('work order');
    if (!['PENDING', 'RUNNING'].includes(workOrder.status)) throw new ApiError(409, `Work order is already ${workOrder.status}`);
    if (!workOrder.production_order) throw new ValidationError('Work order is not linked to a production order');
    const productionOrder = workOrder.production_order;
    if (!productionOrder.bill_of_material) throw new ValidationError('Production order has no BOM');
    if (productionOrder.status === 'CANCELLED' || productionOrder.status === 'COMPLETED') throw new ApiError(409, `Production order is already ${productionOrder.status}`);

    const bomItems = new Map(productionOrder.bill_of_material.bom_item.map((item) => [item.component_item_id.toString(), item]));
    const requestedByComponent = new Map();
    const preparedLines = lines.map((line, index) => {
      if (!line || (line.inventory_item_id === undefined && line.component_item_id === undefined && line.bom_item_id === undefined)) throw new ValidationError(`items[${index}].inventory_item_id is required`);
      if (!line.uom) throw new ValidationError(`items[${index}].uom is required`);
      const suppliedBomItem = line.bom_item_id === undefined ? null : productionOrder.bill_of_material.bom_item.find((item) => item.bom_item_id === id(line.bom_item_id, `items[${index}].bom_item_id`));
      const inventoryItemId = id(line.inventory_item_id ?? line.component_item_id ?? suppliedBomItem?.component_item_id, `items[${index}].inventory_item_id`);
      const bomItem = bomItems.get(inventoryItemId.toString());
      if (!bomItem) throw new ValidationError(`items[${index}] is not a BOM component`);
      if (suppliedBomItem && suppliedBomItem.bom_item_id !== bomItem.bom_item_id) throw new ValidationError(`items[${index}].bom_item_id does not match the component`);
      if (line.uom !== bomItem.uom) throw new ValidationError(`items[${index}].uom must match the BOM component UOM`);
      const quantity = number(line.quantity ?? line.consumed_quantity, `items[${index}].quantity`);
      if (quantity <= 0) throw new ValidationError(`items[${index}].quantity must be greater than zero`);
      const warehouseId = id(line.warehouse_id, `items[${index}].warehouse_id`);
      const lotId = line.lot_id === undefined || line.lot_id === null ? (line.inventory_lot_id === undefined || line.inventory_lot_id === null ? null : id(line.inventory_lot_id, `items[${index}].inventory_lot_id`)) : id(line.lot_id, `items[${index}].lot_id`);
      const key = `${inventoryItemId}:${warehouseId}:${lotId || 'null'}`;
      requestedByComponent.set(inventoryItemId.toString(), (requestedByComponent.get(inventoryItemId.toString()) || 0) + quantity);
      return { line, index, inventoryItemId, warehouseId, lotId, quantity, key };
    });

    const consumed = await tx.production_consumption.groupBy({ by: ['inventory_item_id'], where: { work_order_id: workOrderId }, _sum: { quantity: true } });
    const consumedByComponent = new Map(consumed.map((row) => [row.inventory_item_id.toString(), Number(row._sum.quantity || 0)]));
    for (const [componentId, requested] of requestedByComponent) {
      const bomQuantity = Number(bomItems.get(componentId).quantity_per_unit);
      const requestRequiredQuantity = productionQuantity * bomQuantity;
      const orderRequiredQuantity = Number(workOrder.planned_quantity || productionQuantity) * bomQuantity;
      const cumulativeQuantity = (consumedByComponent.get(componentId) || 0) + requested;
      if (requested > requestRequiredQuantity) throw new ValidationError(`Consumption for BOM component ${componentId} exceeds required quantity ${requestRequiredQuantity}`);
      if (cumulativeQuantity > orderRequiredQuantity) throw new ValidationError(`Cumulative consumption for BOM component ${componentId} exceeds work order requirement ${orderRequiredQuantity}`);
    }

    const stockBalances = new Map();
    const requestedByStock = new Map();
    for (const line of preparedLines.sort((left, right) => left.key.localeCompare(right.key))) {
      if (!stockBalances.has(line.key)) stockBalances.set(line.key, await lockStockBalance(tx, line.inventoryItemId, line.warehouseId, line.lotId));
      const warehouse = await tx.warehouse.findUnique({ where: { warehouse_id: line.warehouseId }, select: { factory_id: true } });
      if (!warehouse || warehouse.factory_id !== productionOrder.factory_id) throw new ValidationError(`items[${line.index}].warehouse_id does not belong to the production order factory`);
      const item = await tx.inventory_item.findUnique({ where: { inventory_item_id: line.inventoryItemId }, select: { is_lot_tracked: true } });
      if (line.lotId) {
        const lot = await tx.inventory_lot.findUnique({ where: { lot_id: line.lotId } });
        if (!lot || lot.inventory_item_id !== line.inventoryItemId || lot.warehouse_id !== line.warehouseId) throw new ValidationError(`items[${line.index}].lot_id does not match the item and warehouse`);
      } else if (item?.is_lot_tracked) {
        throw new ValidationError(`items[${line.index}].lot_id is required for a lot-tracked item`);
      }
      const stock = stockBalances.get(line.key);
      const available = stock ? Number(stock.quantity) - Number(stock.reserved_quantity) : 0;
      const requested = (requestedByStock.get(line.key) || 0) + line.quantity;
      if (!stock || requested > available) throw new ValidationError(`Insufficient stock for item ${line.inventoryItemId} in warehouse ${line.warehouseId}: requested ${requested}, available ${available}, shortage ${requested - available}`);
      requestedByStock.set(line.key, requested);
    }

    for (const line of preparedLines) {
      const stock = stockBalances.get(line.key);
      await tx.inventory_stock.update({ where: { inventory_stock_id: stock.inventory_stock_id }, data: { quantity: { decrement: line.quantity }, last_updated_at: new Date() } });
      await tx.production_consumption.create({ data: { production_order_id: productionOrder.production_order_id, work_order_id: workOrderId, inventory_item_id: line.inventoryItemId, lot_id: line.lotId, warehouse_id: line.warehouseId, quantity: line.quantity, remarks: line.line.remarks } });
      await tx.stock_movement.create({ data: { inventory_item_id: line.inventoryItemId, warehouse_id: line.warehouseId, lot_id: line.lotId, movement_type: 'PRODUCTION_CONSUMPTION', reference_type: 'WORK_ORDER', reference_id: workOrderId, quantity: line.quantity, movement_date: new Date(), remarks: line.line.remarks || `Work order ${workOrder.work_order_number}` } });
    }
    await tx.production_order.update({ where: { production_order_id: productionOrder.production_order_id }, data: { status: 'IN_PROGRESS' } });
    return tx.work_order.update({ where: { work_order_id: workOrderId }, data: { status: 'RUNNING' }, include: { production_order: true, production_consumption: true } });
  });
  res.json({ success: true, data: result });
}

async function outputProductionGoods(req, res) {
  const workOrderId = id(req.params.id, 'id');
  const quantity = number(req.body.quantity, 'quantity');
  if (quantity <= 0) throw new ValidationError('quantity must be greater than zero');
  const warehouseId = id(req.body.destination_warehouse_id ?? req.body.warehouse_id, 'warehouse_id');
  const inventoryItemId = id(req.body.finished_item_id ?? req.body.inventory_item_id, 'inventory_item_id');

  const result = await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw`SELECT "work_order_id" FROM "public"."work_order" WHERE "work_order_id" = ${workOrderId} FOR UPDATE`;
    if (locked.length === 0) throw new NotFoundError('work order');
    const workOrder = await tx.work_order.findUnique({ where: { work_order_id: workOrderId }, include: { production_order: { include: { inventory_item: true, factory: true, work_order: true, bill_of_material: { include: { bom_item: true } } } } } });
    if (!workOrder) throw new NotFoundError('work order');
    if (workOrder.status !== 'RUNNING') throw new ApiError(409, 'Output is allowed only after material consumption');
    const productionOrder = workOrder.production_order;
    if (!productionOrder) throw new ValidationError('Work order is not linked to a production order');
    if (!productionOrder.bill_of_material || productionOrder.bill_of_material.bom_item.length === 0) throw new ValidationError('Production order has no BOM');
    const consumed = await tx.production_consumption.groupBy({ by: ['inventory_item_id'], where: { work_order_id: workOrderId }, _sum: { quantity: true } });
    const consumedByComponent = new Map(consumed.map((row) => [row.inventory_item_id.toString(), Number(row._sum.quantity || 0)]));
    if (inventoryItemId !== productionOrder.inventory_item_id) throw new ValidationError('Output item must match the production order finished item');
    if (!workOrder.planned_quantity || quantity > Number(workOrder.planned_quantity)) throw new ValidationError('Output quantity cannot exceed the work order planned quantity');
    for (const bomItem of productionOrder.bill_of_material.bom_item) {
      const requiredQuantity = quantity * Number(bomItem.quantity_per_unit);
      const consumedQuantity = consumedByComponent.get(bomItem.component_item_id.toString()) || 0;
      if (consumedQuantity < requiredQuantity) throw new ValidationError(`Insufficient consumption for BOM component ${bomItem.component_item_id}: required ${requiredQuantity}, consumed ${consumedQuantity}`);
    }
    const previousOutput = await tx.production_output.findFirst({ where: { work_order_id: workOrderId } });
    if (previousOutput) throw new ApiError(409, 'Work order output has already been posted');
    const item = productionOrder.inventory_item;
    const warehouse = await tx.warehouse.findUnique({ where: { warehouse_id: warehouseId }, select: { factory_id: true } });
    if (!warehouse || warehouse.factory_id !== productionOrder.factory_id) throw new ValidationError('Output warehouse does not belong to the production order factory');
    let lotId = req.body.lot_id === undefined || req.body.lot_id === null ? null : id(req.body.lot_id, 'lot_id');
    if (item.is_lot_tracked) {
      if (lotId) {
        const lot = await tx.inventory_lot.findUnique({ where: { lot_id: lotId } });
        if (!lot || lot.inventory_item_id !== inventoryItemId || lot.warehouse_id !== warehouseId) throw new ValidationError('Output lot does not match the item and warehouse');
      } else {
        if (!req.body.lot_number) throw new ValidationError('lot_number is required for a lot-tracked item');
        const existing = await tx.inventory_lot.findUnique({ where: { warehouse_id_lot_number: { warehouse_id: warehouseId, lot_number: req.body.lot_number } } });
        if (existing && existing.inventory_item_id !== inventoryItemId) throw new ValidationError('Output lot does not match the item and warehouse');
        const lot = existing || await tx.inventory_lot.create({ data: { inventory_item_id: inventoryItemId, warehouse_id: warehouseId, lot_number: req.body.lot_number, heat_number: req.body.heat_number, quantity_received: 0, accepted_quantity: 0 } });
        lotId = lot.lot_id;
      }
      await tx.inventory_lot.update({ where: { lot_id: lotId }, data: { quantity_received: { increment: quantity }, accepted_quantity: { increment: quantity } } });
    } else if (lotId) {
      throw new ValidationError('lot_id is not valid for a non-lot-tracked item');
    }
    const stock = await lockStockBalance(tx, inventoryItemId, warehouseId, lotId);
    const updatedStock = stock
      ? await tx.inventory_stock.update({ where: { inventory_stock_id: stock.inventory_stock_id }, data: { quantity: { increment: quantity }, last_updated_at: new Date() } })
      : await tx.inventory_stock.create({ data: { inventory_item_id: inventoryItemId, warehouse_id: warehouseId, lot_id: lotId, quantity, reserved_quantity: 0 } });
    await tx.stock_movement.create({ data: { inventory_item_id: inventoryItemId, warehouse_id: warehouseId, lot_id: lotId, movement_type: 'PRODUCTION_OUTPUT', reference_type: 'WORK_ORDER', reference_id: workOrderId, quantity, movement_date: new Date(), remarks: req.body.remarks || `Work order ${workOrder.work_order_number}` } });
    await tx.production_output.create({ data: { production_order_id: productionOrder.production_order_id, work_order_id: workOrderId, inventory_item_id: inventoryItemId, lot_id: lotId, warehouse_id: warehouseId, quantity, remarks: req.body.remarks } });
    const completedWorkOrder = await tx.work_order.update({ where: { work_order_id: workOrderId }, data: { status: 'COMPLETED', actual_quantity: { increment: quantity }, end_time: new Date() } });
    await tx.$queryRaw`SELECT 1 FROM "public"."production_order" WHERE "production_order_id" = ${productionOrder.production_order_id} FOR UPDATE`;
    const workOrders = await tx.work_order.findMany({ where: { production_order_id: productionOrder.production_order_id }, select: { status: true } });
    const allComplete = workOrders.length > 0 && workOrders.every((order) => order.status === 'COMPLETED');
    await tx.production_order.update({ where: { production_order_id: productionOrder.production_order_id }, data: { status: allComplete ? 'COMPLETED' : 'IN_PROGRESS' } });
    return { work_order: completedWorkOrder, stock: updatedStock };
  });
  res.json({ success: true, data: result });
}

async function createSalesInvoice(req, res) {
  required(req.body, ['invoice_number', 'customer_id']);
  return createWithItems(req, res, 'sales_invoice', 'sales_invoice_item', 'sales_invoice_id', 'sales_invoice_item', {
    invoice_number: req.body.invoice_number, invoice_type: req.body.invoice_type, customer_id: id(req.body.customer_id, 'customer_id'), customer_order_id: req.body.customer_order_id === undefined ? undefined : id(req.body.customer_order_id, 'customer_order_id'), invoice_date: date(req.body.invoice_date), due_date: date(req.body.due_date), payment_terms: req.body.payment_terms, taxable_amount: req.body.taxable_amount === undefined ? undefined : number(req.body.taxable_amount, 'taxable_amount'), cgst_amount: req.body.cgst_amount === undefined ? undefined : number(req.body.cgst_amount, 'cgst_amount'), sgst_amount: req.body.sgst_amount === undefined ? undefined : number(req.body.sgst_amount, 'sgst_amount'), igst_amount: req.body.igst_amount === undefined ? undefined : number(req.body.igst_amount, 'igst_amount'), total_amount: req.body.total_amount === undefined ? undefined : number(req.body.total_amount, 'total_amount'), status: req.body.status, notes: req.body.notes
  }, (parent, item) => ({ sales_invoice_id: parent.sales_invoice_id, customer_order_item_id: item.customer_order_item_id === undefined ? undefined : id(item.customer_order_item_id, 'customer_order_item_id'), inventory_item_id: item.inventory_item_id === undefined ? undefined : id(item.inventory_item_id, 'inventory_item_id'), description: item.description || '', hsn_sac_code: item.hsn_sac_code, uom: item.uom, quantity: item.quantity === undefined ? undefined : number(item.quantity, 'quantity'), unit_price: item.unit_price === undefined ? undefined : number(item.unit_price, 'unit_price'), discount_amount: item.discount_amount === undefined ? undefined : number(item.discount_amount, 'discount_amount'), taxable_amount: item.taxable_amount === undefined ? undefined : number(item.taxable_amount, 'taxable_amount'), gst_rate: item.gst_rate === undefined ? undefined : number(item.gst_rate, 'gst_rate'), line_total: item.line_total === undefined ? undefined : number(item.line_total, 'line_total') }));
}

async function createVendorInvoice(req, res) {
  required(req.body, ['vendor_id', 'invoice_number', 'invoice_date', 'due_date']);
  itemsRequired(req.body);
  if (req.body.invoice_number.length < 1 || req.body.invoice_number.length > 100) throw new ValidationError('invoice_number must be between 1 and 100 characters');
  const gstinPattern = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
  for (const field of ['supplier_gstin', 'recipient_gstin']) {
    if (req.body[field] !== undefined && req.body[field] !== null && !gstinPattern.test(req.body[field])) throw new ValidationError(`${field} must be a valid GSTIN`);
  }
  const vendorId = id(req.body.vendor_id, 'vendor_id');
  const purchaseOrderId = req.body.purchase_order_id === undefined || req.body.purchase_order_id === null ? undefined : id(req.body.purchase_order_id, 'purchase_order_id');
  const invoiceDate = date(req.body.invoice_date);
  const dueDate = date(req.body.due_date);
  const otherCharges = req.body.other_charges === undefined ? 0 : number(req.body.other_charges, 'other_charges');
  const roundOff = req.body.round_off === undefined ? 0 : number(req.body.round_off, 'round_off');
  const suppliedCessAmount = req.body.cess_amount === undefined ? 0 : number(req.body.cess_amount, 'cess_amount');
  if (Number.isNaN(invoiceDate.getTime())) throw new ValidationError('invoice_date must be a valid date');
  if (Number.isNaN(dueDate.getTime())) throw new ValidationError('due_date must be a valid date');
  if (dueDate < invoiceDate) throw new ValidationError('Due date cannot be earlier than invoice date');
  if (otherCharges < 0) throw new ValidationError('other_charges must be greater than or equal to zero');
  if (roundOff < -1 || roundOff > 1) throw new ValidationError('round_off must be between -1 and 1');
  if (suppliedCessAmount < 0) throw new ValidationError('cess_amount must be greater than or equal to zero');
  const suppliedCgstAmount = req.body.cgst_amount === undefined ? 0 : number(req.body.cgst_amount, 'cgst_amount');
  const suppliedSgstAmount = req.body.sgst_amount === undefined ? 0 : number(req.body.sgst_amount, 'sgst_amount');
  const suppliedIgstAmount = req.body.igst_amount === undefined ? 0 : number(req.body.igst_amount, 'igst_amount');
  if ((suppliedCgstAmount > 0 || suppliedSgstAmount > 0) && suppliedIgstAmount > 0) throw new ValidationError('CGST/SGST and IGST cannot both apply');
  const supplierStateCode = req.body.supplier_gstin?.slice(0, 2);
  const recipientStateCode = req.body.recipient_gstin?.slice(0, 2);
  const isInterState = supplierStateCode && recipientStateCode && supplierStateCode !== recipientStateCode;

  const result = await prisma.$transaction(async (tx) => {
    const vendor = await tx.vendor.findUnique({ where: { vendor_id: vendorId }, select: { is_active: true } });
    if (!vendor) throw new ValidationError('vendor does not exist');
    if (!vendor.is_active) throw new ValidationError('vendor is inactive');

    let purchaseOrder;
    if (purchaseOrderId !== undefined) {
      purchaseOrder = await tx.purchase_order.findUnique({ where: { purchase_order_id: purchaseOrderId }, select: { vendor_id: true, status: true } });
      if (!purchaseOrder) throw new ValidationError('purchase order does not exist');
      if (purchaseOrder.vendor_id !== vendorId) throw new ValidationError('purchase order vendor must match invoice vendor');
      if (!['SENT', 'PARTIALLY_RECEIVED', 'RECEIVED'].includes(purchaseOrder.status)) throw new ValidationError('Purchase order status must be SENT, PARTIALLY_RECEIVED, or RECEIVED');
    }

    const preparedItems = [];
    const requestedByPoItem = new Map();
    const requestedByGrnItem = new Map();
    const roundMoney = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
    let taxableAmount = 0;
    let discountAmount = 0;
    let cgstAmount = 0;
    let sgstAmount = 0;
    let igstAmount = 0;
    let cessAmount = 0;
    let totalAmount = 0;

    for (const [index, item] of req.body.items.entries()) {
      const inventoryItemId = id(item.inventory_item_id, `items[${index}].inventory_item_id`);
      const inventoryItem = await tx.inventory_item.findUnique({ where: { inventory_item_id: inventoryItemId }, select: { inventory_item_id: true } });
      if (!inventoryItem) throw new ValidationError(`items[${index}] inventory item does not exist`);
      const quantity = number(item.quantity, `items[${index}].quantity`);
      if (quantity <= 0) throw new ValidationError(`items[${index}].quantity must be greater than zero`);
      let purchaseOrderItem;
      if (item.purchase_order_item_id !== undefined && item.purchase_order_item_id !== null) {
        if (purchaseOrderId === undefined) throw new ValidationError('purchase_order_id is required when purchase_order_item_id is supplied');
        const purchaseOrderItemId = id(item.purchase_order_item_id, `items[${index}].purchase_order_item_id`);
        purchaseOrderItem = await tx.purchase_order_item.findUnique({ where: { purchase_order_item_id: purchaseOrderItemId } });
        if (!purchaseOrderItem) throw new ValidationError('purchase order item does not exist');
        if (purchaseOrderItem.purchase_order_id !== purchaseOrderId) throw new ValidationError('purchase order item does not belong to the supplied purchase order');
        if (purchaseOrderItem.inventory_item_id !== inventoryItemId) throw new ValidationError('Invoice inventory item does not match purchase order item');
        if (purchaseOrderItem.uom !== item.uom) throw new ValidationError('Invoice UOM does not match purchase order item');
        requestedByPoItem.set(purchaseOrderItemId.toString(), (requestedByPoItem.get(purchaseOrderItemId.toString()) || 0) + quantity);
      }
      const rate = item.rate ?? item.unit_price ?? 0;
      const unitPrice = number(rate, `items[${index}].rate`);
      if (unitPrice < 0) throw new ValidationError(`items[${index}].rate must be greater than or equal to zero`);
      if (purchaseOrderItem && unitPrice !== Number(purchaseOrderItem.unit_rate)) throw new ValidationError('Invoice rate does not match purchase order rate');
      const discount = item.discount_amount === undefined ? 0 : number(item.discount_amount, `items[${index}].discount_amount`);
      const gstRate = item.gst_rate === undefined ? 0 : number(item.gst_rate, `items[${index}].gst_rate`);
      const cessRate = item.cess_rate === undefined ? 0 : number(item.cess_rate, `items[${index}].cess_rate`);
      const suppliedItemCessAmount = item.cess_amount === undefined ? 0 : number(item.cess_amount, `items[${index}].cess_amount`);
      const suppliedItemCgstAmount = item.cgst_amount === undefined ? 0 : number(item.cgst_amount, `items[${index}].cgst_amount`);
      const suppliedItemSgstAmount = item.sgst_amount === undefined ? 0 : number(item.sgst_amount, `items[${index}].sgst_amount`);
      const suppliedItemIgstAmount = item.igst_amount === undefined ? 0 : number(item.igst_amount, `items[${index}].igst_amount`);
      if (discount < 0) throw new ValidationError(`items[${index}].discount_amount must be greater than or equal to zero`);
      if (gstRate < 0 || gstRate > 100) throw new ValidationError(`items[${index}].gst_rate must be between 0 and 100`);
      if (cessRate < 0) throw new ValidationError(`items[${index}].cess_rate must be greater than or equal to zero`);
      if (suppliedItemCessAmount < 0) throw new ValidationError(`items[${index}].cess_amount must be greater than or equal to zero`);
      if ((suppliedItemCgstAmount > 0 || suppliedItemSgstAmount > 0) && suppliedItemIgstAmount > 0) throw new ValidationError('CGST/SGST and IGST cannot both apply');
      const taxableBeforeFloor = quantity * unitPrice - discount;
      if (taxableBeforeFloor < 0) throw new ValidationError('taxable amount cannot be negative');
      const lineTaxableAmount = roundMoney(taxableBeforeFloor);
      const lineTaxAmount = roundMoney(lineTaxableAmount * gstRate / 100);
      const lineCgstAmount = isInterState ? 0 : roundMoney(lineTaxAmount / 2);
      const lineSgstAmount = isInterState ? 0 : roundMoney(lineTaxAmount - lineCgstAmount);
      const lineIgstAmount = isInterState ? lineTaxAmount : 0;
      const lineCessAmount = roundMoney(lineTaxableAmount * cessRate / 100);
      const lineTotal = roundMoney(lineTaxableAmount + lineTaxAmount + lineCessAmount);
      const matches = [];
      for (const [matchIndex, match] of (Array.isArray(item.matches) ? item.matches : []).entries()) {
        const grnItemId = id(match.grn_item_id, `items[${index}].matches[${matchIndex}].grn_item_id`);
        const matchedQuantity = number(match.matched_quantity, `items[${index}].matches[${matchIndex}].matched_quantity`);
        if (matchedQuantity <= 0) throw new ValidationError('matched_quantity must be greater than zero');
        const grnItem = await tx.grn_item.findUnique({ where: { grn_item_id: grnItemId }, include: { grn: { select: { vendor_id: true, purchase_order_id: true } } } });
        if (!grnItem) throw new ValidationError('GRN item does not exist');
        if (grnItem.grn.vendor_id !== vendorId) throw new ValidationError('GRN item vendor must match invoice vendor');
        if (purchaseOrderId !== undefined && grnItem.grn.purchase_order_id !== purchaseOrderId) throw new ValidationError('GRN item purchase order must match invoice purchase order');
        if (grnItem.inventory_item_id !== inventoryItemId) throw new ValidationError('GRN item inventory item must match invoice item');
        if (grnItem.uom !== item.uom) throw new ValidationError('GRN item UOM must match invoice item');
        const matchKey = grnItemId.toString();
        requestedByGrnItem.set(matchKey, (requestedByGrnItem.get(matchKey) || 0) + matchedQuantity);
        matches.push({ grnItemId, matchedQuantity });
      }
      const totalMatchedQuantity = matches.reduce((total, match) => total + match.matchedQuantity, 0);
      if (totalMatchedQuantity > quantity) throw new ValidationError('Matched quantity exceeds invoice item quantity');
      preparedItems.push({
        index,
        inventoryItemId,
        purchaseOrderItem,
        purchaseOrderItemId: purchaseOrderItem?.purchase_order_item_id,
        quantity,
        unitPrice,
        description: item.description || '',
        hsnSacCode: item.hsn_sac_code,
        uom: item.uom,
        discount,
        gstRate,
        cessRate,
        lineTaxableAmount,
        lineCgstAmount,
        lineSgstAmount,
        lineIgstAmount,
        lineCessAmount,
        lineTotal,
        matches
      });
      taxableAmount += lineTaxableAmount;
      discountAmount += discount;
      cgstAmount += lineCgstAmount;
      sgstAmount += lineSgstAmount;
      igstAmount += lineIgstAmount;
      cessAmount += lineCessAmount;
      totalAmount += lineTotal;
    }

    for (const [purchaseOrderItemId, requestedQuantity] of requestedByPoItem) {
      const alreadyInvoiced = await tx.vendor_invoice_item.aggregate({ where: { purchase_order_item_id: BigInt(purchaseOrderItemId) }, _sum: { quantity: true } });
      const orderedQuantity = Number(preparedItems.find((item) => item.purchaseOrderItemId.toString() === purchaseOrderItemId).purchaseOrderItem.ordered_quantity);
      if (Number(alreadyInvoiced._sum.quantity || 0) + requestedQuantity > orderedQuantity) throw new ValidationError('Invoice quantity exceeds purchase order quantity');
    }

    for (const [grnItemId, requestedQuantity] of requestedByGrnItem) {
      const alreadyMatched = await tx.vendor_invoice_grn_match.aggregate({ where: { grn_item_id: BigInt(grnItemId) }, _sum: { matched_quantity: true } });
      const grnItem = await tx.grn_item.findUnique({ where: { grn_item_id: BigInt(grnItemId) }, select: { accepted_quantity: true } });
      if (Number(alreadyMatched._sum.matched_quantity || 0) + requestedQuantity > Number(grnItem.accepted_quantity)) throw new ValidationError('Matched quantity exceeds GRN accepted quantity');
    }

    const invoice = await tx.vendor_invoice.create({ data: {
      vendor_id: vendorId,
      purchase_order_id: purchaseOrderId,
      invoice_number: req.body.invoice_number,
      invoice_date: invoiceDate,
      due_date: dueDate,
      payment_terms: req.body.payment_terms,
      place_of_supply: req.body.place_of_supply,
      supplier_gstin: req.body.supplier_gstin,
      recipient_gstin: req.body.recipient_gstin,
      supplier_reference: req.body.supplier_reference,
      taxable_amount: roundMoney(taxableAmount),
      cgst_amount: roundMoney(cgstAmount),
      sgst_amount: roundMoney(sgstAmount),
      igst_amount: roundMoney(igstAmount),
      cess_amount: roundMoney(cessAmount),
      discount_amount: roundMoney(discountAmount),
      other_charges: roundMoney(otherCharges),
      round_off: roundMoney(roundOff),
      total_amount: roundMoney(totalAmount + otherCharges + roundOff),
      status: 'DRAFT'
    } });

    for (const item of preparedItems) {
      const invoiceItem = await tx.vendor_invoice_item.create({ data: {
        vendor_invoice_id: invoice.vendor_invoice_id,
        purchase_order_item_id: item.purchaseOrderItemId,
        inventory_item_id: item.inventoryItemId,
        description: item.description,
        hsn_sac_code: item.hsnSacCode,
        uom: item.uom,
        quantity: item.quantity,
        unit_price: item.unitPrice,
        discount_amount: item.discount,
        taxable_amount: item.lineTaxableAmount,
        gst_rate: item.gstRate,
        cgst_amount: item.lineCgstAmount,
        sgst_amount: item.lineSgstAmount,
        igst_amount: item.lineIgstAmount,
        line_total: item.lineTotal
      } });
      for (const match of item.matches) {
        await tx.vendor_invoice_grn_match.create({ data: { vendor_invoice_item_id: invoiceItem.vendor_invoice_item_id, grn_item_id: match.grnItemId, matched_quantity: match.matchedQuantity } });
      }
    }
    const createdInvoice = await tx.vendor_invoice.findUnique({ where: { vendor_invoice_id: invoice.vendor_invoice_id }, include: { vendor_invoice_item: { include: { vendor_invoice_grn_match: true } } } });
    return { ...createdInvoice, vendor_invoice_item: createdInvoice.vendor_invoice_item.map((item) => ({ ...item, match_status: Number(item.vendor_invoice_grn_match.reduce((total, match) => total + Number(match.matched_quantity), 0)) === 0 ? 'UNMATCHED' : Number(item.vendor_invoice_grn_match.reduce((total, match) => total + Number(match.matched_quantity), 0)) >= Number(item.quantity) ? 'FULLY_MATCHED' : 'PARTIALLY_MATCHED' })) };
  });
  res.status(201).json({ success: true, data: result });
}

async function transitionVendorInvoice(req, res, status) {
  const invoiceId = id(req.params.id, 'id');
  const result = await prisma.$transaction(async (tx) => {
    const invoice = await tx.vendor_invoice.findUnique({ where: { vendor_invoice_id: invoiceId }, select: { status: true } });
    if (!invoice) throw new NotFoundError('vendor invoice');
    if (invoice.status !== 'DRAFT') throw new ApiError(409, `Vendor invoice cannot transition from ${invoice.status} to ${status}`);
    return tx.vendor_invoice.update({ where: { vendor_invoice_id: invoiceId }, data: { status } });
  });
  res.json({ success: true, status: result.status });
}

async function bookVendorInvoice(req, res) {
  return transitionVendorInvoice(req, res, 'BOOKED');
}

async function cancelVendorInvoice(req, res) {
  return transitionVendorInvoice(req, res, 'CANCELLED');
}

function addInvoiceMatchStatus(invoice) {
  return { ...invoice, vendor_invoice_item: invoice.vendor_invoice_item.map((item) => {
    const matchedQuantity = item.vendor_invoice_grn_match.reduce((total, match) => total + Number(match.matched_quantity), 0);
    return { ...item, match_status: matchedQuantity === 0 ? 'UNMATCHED' : matchedQuantity >= Number(item.quantity) ? 'FULLY_MATCHED' : 'PARTIALLY_MATCHED' };
  }) };
}

async function listVendorInvoices(req, res) {
  const allowedStatuses = ['DRAFT', 'BOOKED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED'];
  const where = {};
  if (req.query.status !== undefined) {
    if (!allowedStatuses.includes(req.query.status)) throw new ValidationError('status must be DRAFT, BOOKED, PARTIALLY_PAID, PAID, or CANCELLED');
    where.status = req.query.status;
  }
  const data = await prisma.vendor_invoice.findMany({ where, orderBy: { vendor_invoice_id: 'desc' }, select: { vendor_invoice_id: true, vendor_id: true, purchase_order_id: true, invoice_number: true, invoice_date: true, due_date: true, total_amount: true, status: true } });
  res.json({ success: true, data });
}

async function getVendorInvoice(req, res) {
  const invoice = await prisma.vendor_invoice.findUnique({ where: { vendor_invoice_id: id(req.params.id, 'id') }, include: { vendor_invoice_item: { include: { vendor_invoice_grn_match: true } } } });
  if (!invoice) throw new NotFoundError('vendor invoice');
  res.json({ success: true, data: addInvoiceMatchStatus(invoice) });
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

async function listDocuments(req, res) {
  const page = Math.max(1, Math.floor(Number(req.query.page) || 1));
  const pageSize = Math.min(100, Math.max(1, Math.floor(Number(req.query.pageSize) || 25)));
  const documents = await prisma.document.findMany({ include: { invoice_extraction_review: true }, orderBy: { uploaded_at: 'desc' } });
  const search = String(req.query.search || '').trim().toLowerCase();
  const filtered = documents.map(publicDocument).filter(document => {
    if (req.query.status && document.invoice_extraction_review?.extraction_status !== req.query.status) return false;
    if (req.query.documentType && document.document_type !== req.query.documentType) return false;
    const day = document.uploaded_at.toISOString().slice(0, 10);
    if (req.query.from && day < req.query.from || req.query.to && day > req.query.to) return false;
    return !search || JSON.stringify(require('../lib/serialize')(document)).toLowerCase().includes(search);
  });
  res.json({ success: true, data: filtered.slice((page - 1) * pageSize, page * pageSize), pagination: { page, pageSize, total: filtered.length } });
}

async function uploadDocument(req, res) {
  if (!req.file) throw new ValidationError('A document file is required.');
  await verifyUploadedFile(req.file);
  let document;
  try {
    document = await prisma.document.create({ data: {
      document_type: req.body.document_type || 'PURCHASE_INVOICE', file_name: req.file.filename,
      mime_type: req.file.mimetype, uploaded_by: req.user.user_id,
      metadata: { originalFileName: path.basename(req.file.originalname), size: req.file.size },
      invoice_extraction_review: { create: { extraction_status: 'PROCESSING' } }
    } });
  } catch (error) { await fs.unlink(req.file.path).catch(() => {}); throw error; }
  const result = await processDocument(prisma, document, req.file.path);
  res.status(201).json({ success: true, data: publicDocument(result) });
}

async function retryDocument(req, res) {
  const document = await prisma.document.findUnique({ where: { document_id: id(req.params.id) }, include: { invoice_extraction_review: true } });
  if (!document) throw new NotFoundError('document');
  if (!['UNDER_REVIEW', 'VALIDATION_FAILED'].includes(document.invoice_extraction_review?.extraction_status)) throw new ApiError(409, 'Only failed or needs-review documents can be retried.');
  if (document.invoice_extraction_review.reviewed_at) throw new ApiError(409, 'This document has human corrections. Upload a new copy to avoid overwriting them.');
  const claimed = await prisma.invoice_extraction_review.updateMany({ where: { document_id: document.document_id, extraction_status: { in: ['UNDER_REVIEW', 'VALIDATION_FAILED'] }, reviewed_at: null }, data: { extraction_status: 'PROCESSING' } });
  if (!claimed.count) throw new ApiError(409, 'Document is already being processed.');
  const result = await processDocument(prisma, document, path.join(uploadDirectory, path.basename(document.file_name)));
  res.json({ success: true, data: publicDocument(result) });
}

async function getDocument(req, res) {
  const document = await prisma.document.findUnique({ where: { document_id: id(req.params.id) }, include: { invoice_extraction_review: true } });
  if (!document) throw new NotFoundError('document');
  res.json({ success: true, data: publicDocument(document) });
}

async function getDocumentFile(req, res) {
  const document = await prisma.document.findUnique({ where: { document_id: id(req.params.id) } });
  if (!document) throw new NotFoundError('document');
  const safeName = path.basename(document.file_name);
  const filePath = path.resolve(uploadDirectory, safeName);
  if (!filePath.startsWith(`${uploadDirectory}${path.sep}`)) throw new NotFoundError('document file');
  try { await fs.access(filePath); } catch { throw new NotFoundError('document file'); }
  res.type(document.mime_type || 'application/octet-stream').sendFile(filePath);
}

async function updateDocument(req, res) {
  const document = await prisma.document.update({ where: { document_id: id(req.params.id) }, data: { document_type: req.body.document_type, reference_type: req.body.reference_type, reference_id: req.body.reference_id === undefined ? undefined : id(req.body.reference_id, 'reference_id'), file_name: req.body.file_name, file_url: req.body.file_url, mime_type: req.body.mime_type, metadata: req.body.metadata } });
  res.json({ success: true, data: document });
}

async function getReview(req, res) {
  const review = await prisma.invoice_extraction_review.findUnique({ where: { invoice_extraction_review_id: id(req.params.id) } });
  if (!review) throw new NotFoundError('invoice extraction review');
  res.json({ success: true, data: publicReview(review) });
}

async function updateReview(req, res) {
  const existing = await prisma.invoice_extraction_review.findUnique({ where: { invoice_extraction_review_id: id(req.params.id) } });
  if (!existing) throw new NotFoundError('invoice extraction review');
  const decision = req.body.reviewer_decision;
  const fields = req.body.extracted_fields === undefined ? existing.extracted_fields : req.body.extracted_fields;
  const validationInput = decision === 'APPROVED' && fields ? { ...fields, conflicts: [], fieldEvidence: {}, canonical: fields.canonical ? { ...fields.canonical, conflicts: [], field_evidence: {} } : undefined } : fields;
  const validation = validateInvoice(validationInput, Number(existing.raw_ocr_output?.confidence || 0));
  if (existing.extraction_status === 'PROCESSING') throw new ApiError(409, 'Wait for extraction to finish.');
  if (decision && !['APPROVED', 'REJECTED', 'NEEDS_CORRECTION'].includes(decision)) throw new ValidationError('Invalid review decision.');
  const status = databaseStatus(decision === 'APPROVED' ? 'APPROVED' : decision === 'REJECTED' ? 'REJECTED' : validation.status);
  if (decision === 'APPROVED' && validation.errors.length) throw new ValidationError('Resolve validation issues before approving this document.', { validationErrors: validation.errors });
  const review = await prisma.invoice_extraction_review.update({ where: { invoice_extraction_review_id: id(req.params.id) }, data: { extraction_status: status, extracted_fields: fields || undefined, validation_errors: validation.errors, confidence_score: validation.confidence, reviewer_id: req.user.user_id, reviewer_decision: decision || 'NEEDS_CORRECTION', reviewed_at: new Date(), review_notes: req.body.review_notes, updated_at: new Date() } });
  console.info('Document review updated', { reviewId: review.invoice_extraction_review_id.toString(), status });
  res.json({ success: true, data: publicReview(review) });
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

module.exports = { createRequisition, createPurchaseOrder, createGrn, postGrn, createCustomerOrder, createDelivery, dispatchDelivery, consumeProductionMaterials, outputProductionGoods, createSalesInvoice, createVendorInvoice, bookVendorInvoice, cancelVendorInvoice, listVendorInvoices, getVendorInvoice, createDocument, uploadDocument, retryDocument, listDocuments, getDocument, getDocumentFile, updateDocument, getReview, updateReview, createApprovalRequest, submitApprovalAction };
