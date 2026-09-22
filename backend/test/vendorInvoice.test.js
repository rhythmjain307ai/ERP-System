const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const setupIntegration = require('./setup');
const app = require('../app');
const prisma = require('../lib/prisma');

const integration = Boolean(process.env.TEST_DATABASE_URL);
let context;

function invoiceBody(overrides = {}) {
  return {
    vendor_id: context.vendorId,
    invoice_number: `VINV-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
    invoice_date: '2026-01-15',
    due_date: '2026-02-15',
    items: [{ inventory_item_id: context.inventoryItemId, description: 'Test material', uom: 'EA', quantity: 2, rate: 12.5 }],
    ...overrides
  };
}

async function createPurchaseOrder({ vendorId = context.vendorId, status = 'SENT', quantity = 2, rate = 12.5, inventoryItemId = context.inventoryItemId, uom = 'EA' } = {}) {
  const response = await request(app).post('/api/procurement/purchase-orders').set('Authorization', context.auth).send({
    po_number: `PO-VINV-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
    vendor_id: vendorId,
    status,
    items: [{ inventory_item_id: inventoryItemId, uom, ordered_quantity: quantity, unit_rate: rate }]
  });
  assert.equal(response.status, 201);
  const purchaseOrderId = BigInt(response.body.data.purchase_order_id);
  const purchaseOrderItemId = BigInt(response.body.data.purchase_order_item[0].purchase_order_item_id);
  context.created.purchaseOrderIds.push(purchaseOrderId);
  return { purchaseOrderId: purchaseOrderId.toString(), purchaseOrderItemId: purchaseOrderItemId.toString() };
}

async function postInvoice(body) {
  return request(app).post('/api/procurement/vendor-invoices').set('Authorization', context.auth).send(body);
}

async function createAcceptedGrn({ vendorId = context.vendorId, purchaseOrderId, purchaseOrderItemId, inventoryItemId = context.inventoryItemId, uom = 'EA', quantity = 5 } = {}) {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const response = await request(app).post('/api/procurement/grns').set('Authorization', context.auth).send({
    grn_number: `GRN-MATCH-${suffix}`,
    purchase_order_id: purchaseOrderId,
    vendor_id: vendorId,
    warehouse_id: context.warehouseId,
    items: [{ purchase_order_item_id: purchaseOrderItemId, inventory_item_id: inventoryItemId, uom, received_quantity: quantity }]
  });
  assert.equal(response.status, 201);
  const grnId = BigInt(response.body.data.grn_id);
  const grnItemId = BigInt(response.body.data.grn_item[0].grn_item_id);
  context.created.grnIds.push(grnId);
  const posted = await request(app).post(`/api/procurement/grns/${grnId}/post`).set('Authorization', context.auth).send({ inspection_status: 'PASSED', items: [{ grn_item_id: grnItemId.toString(), accepted_quantity: quantity }] });
  assert.equal(posted.status, 200);
  return { grnId: grnId.toString(), grnItemId: grnItemId.toString() };
}

test.before(async () => {
  context = await setupIntegration();
});

test.after(async () => {
  if (context) await context.cleanup();
  await prisma.$disconnect();
});

test('creates a vendor invoice with items', { skip: !integration }, async () => {
  const response = await postInvoice(invoiceBody());
  assert.equal(response.status, 201);
  assert.equal(response.body.data.vendor_invoice_item.length, 1);
  const invoiceId = BigInt(response.body.data.vendor_invoice_id);
  const item = await prisma.vendor_invoice_item.findFirst({ where: { vendor_invoice_id: invoiceId } });
  assert.equal(Number(item.quantity), 2);
  context.created.vendorInvoiceIds.push(invoiceId);
});

test('requires a vendor', { skip: !integration }, async () => {
  const body = invoiceBody();
  delete body.vendor_id;
  assert.equal((await postInvoice(body)).status, 400);
});

test('rejects an inactive vendor', { skip: !integration }, async () => {
  await prisma.vendor.update({ where: { vendor_id: BigInt(context.vendorId) }, data: { is_active: false } });
  const response = await postInvoice(invoiceBody());
  await prisma.vendor.update({ where: { vendor_id: BigInt(context.vendorId) }, data: { is_active: true } });
  assert.equal(response.status, 400);
  assert.match(response.body.error.message, /inactive/);
});

test('requires an invoice number', { skip: !integration }, async () => {
  const body = invoiceBody();
  delete body.invoice_number;
  assert.equal((await postInvoice(body)).status, 400);
});

test('requires an invoice date', { skip: !integration }, async () => {
  const body = invoiceBody();
  delete body.invoice_date;
  assert.equal((await postInvoice(body)).status, 400);
});

test('requires a due date', { skip: !integration }, async () => {
  const body = invoiceBody();
  delete body.due_date;
  assert.equal((await postInvoice(body)).status, 400);
});

test('requires at least one item', { skip: !integration }, async () => {
  assert.equal((await postInvoice(invoiceBody({ items: [] }))).status, 400);
});

test('rejects an invalid quantity', { skip: !integration }, async () => {
  assert.equal((await postInvoice(invoiceBody({ items: [{ inventory_item_id: context.inventoryItemId, uom: 'EA', quantity: 0, rate: 1 }] }))).status, 400);
});

test('rejects an invalid rate', { skip: !integration }, async () => {
  assert.equal((await postInvoice(invoiceBody({ items: [{ inventory_item_id: context.inventoryItemId, uom: 'EA', quantity: 1, rate: -1 }] }))).status, 400);
});

test('rejects an invalid vendor', { skip: !integration }, async () => {
  assert.equal((await postInvoice(invoiceBody({ vendor_id: '999999999' }))).status, 400);
});

test('rejects an invalid purchase order', { skip: !integration }, async () => {
  assert.equal((await postInvoice(invoiceBody({ purchase_order_id: '999999999' }))).status, 400);
});

test('rejects a purchase order for another vendor', { skip: !integration }, async () => {
  const { purchaseOrderId } = await createPurchaseOrder({ vendorId: context.otherVendorId });
  const response = await postInvoice(invoiceBody({ purchase_order_id: purchaseOrderId }));
  assert.equal(response.status, 400);
  assert.match(response.body.error.message, /vendor must match/);
});

test('rolls back the invoice when an item insert fails', { skip: !integration }, async () => {
  const body = invoiceBody({ items: [
    { inventory_item_id: context.inventoryItemId, uom: 'EA', quantity: 1, rate: 1 },
    { inventory_item_id: '999999999', uom: 'EA', quantity: 1, rate: 1 }
  ] });
  const response = await postInvoice(body);
  assert.equal(response.status, 400);
  assert.equal(await prisma.vendor_invoice.count({ where: { invoice_number: body.invoice_number } }), 0);
  assert.equal(await prisma.vendor_invoice_item.count({ where: { vendor_invoice: { invoice_number: body.invoice_number } } }), 0);
});

test('defaults status to DRAFT', { skip: !integration }, async () => {
  const response = await postInvoice(invoiceBody());
  assert.equal(response.status, 201);
  assert.equal(response.body.data.status, 'DRAFT');
  context.created.vendorInvoiceIds.push(BigInt(response.body.data.vendor_invoice_id));
});

test('does not create an accounts payable record', { skip: !integration }, async () => {
  const response = await postInvoice(invoiceBody());
  assert.equal(response.status, 201);
  const invoiceId = BigInt(response.body.data.vendor_invoice_id);
  context.created.vendorInvoiceIds.push(invoiceId);
  assert.equal(await prisma.accounts_payable.count({ where: { vendor_invoice_id: invoiceId } }), 0);
});

test('creates a valid invoice linked to a PO item', { skip: !integration }, async () => {
  const { purchaseOrderId, purchaseOrderItemId } = await createPurchaseOrder();
  const response = await postInvoice(invoiceBody({ purchase_order_id: purchaseOrderId, items: [{ inventory_item_id: context.inventoryItemId, purchase_order_item_id: purchaseOrderItemId, description: 'PO material', uom: 'EA', quantity: 2, rate: 12.5 }] }));
  assert.equal(response.status, 201);
  context.created.vendorInvoiceIds.push(BigInt(response.body.data.vendor_invoice_id));
});

test('creates a valid invoice without a PO', { skip: !integration }, async () => {
  const response = await postInvoice(invoiceBody());
  assert.equal(response.status, 201);
  context.created.vendorInvoiceIds.push(BigInt(response.body.data.vendor_invoice_id));
});

test('rejects a due date before the invoice date', { skip: !integration }, async () => {
  const response = await postInvoice(invoiceBody({ invoice_date: '2026-02-15', due_date: '2026-02-14' }));
  assert.equal(response.status, 400);
  assert.equal(response.body.error.message, 'Due date cannot be earlier than invoice date');
});

test('rejects an invalid GSTIN', { skip: !integration }, async () => {
  const response = await postInvoice(invoiceBody({ supplier_gstin: 'INVALID-GSTIN' }));
  assert.equal(response.status, 400);
  assert.match(response.body.error.message, /valid GSTIN/);
});

test('rejects a PO in DRAFT status', { skip: !integration }, async () => {
  const { purchaseOrderId } = await createPurchaseOrder({ status: 'DRAFT' });
  const response = await postInvoice(invoiceBody({ purchase_order_id: purchaseOrderId }));
  assert.equal(response.status, 400);
  assert.match(response.body.error.message, /Purchase order status/);
});

test('rejects a CLOSED PO', { skip: !integration }, async () => {
  const { purchaseOrderId } = await createPurchaseOrder({ status: 'CLOSED' });
  const response = await postInvoice(invoiceBody({ purchase_order_id: purchaseOrderId }));
  assert.equal(response.status, 400);
});

test('rejects a CANCELLED PO', { skip: !integration }, async () => {
  const { purchaseOrderId } = await createPurchaseOrder({ status: 'CANCELLED' });
  const response = await postInvoice(invoiceBody({ purchase_order_id: purchaseOrderId }));
  assert.equal(response.status, 400);
});

test('rejects a nonexistent PO item', { skip: !integration }, async () => {
  const purchaseOrder = await createPurchaseOrder();
  const response = await postInvoice(invoiceBody({ purchase_order_id: purchaseOrder.purchaseOrderId, items: [{ inventory_item_id: context.inventoryItemId, purchase_order_item_id: '999999999', uom: 'EA', quantity: 1, rate: 12.5 }] }));
  assert.equal(response.status, 400);
  assert.match(response.body.error.message, /purchase order item does not exist/);
});

test('rejects a PO item belonging to another PO', { skip: !integration }, async () => {
  const first = await createPurchaseOrder();
  const second = await createPurchaseOrder();
  const response = await postInvoice(invoiceBody({ purchase_order_id: first.purchaseOrderId, items: [{ inventory_item_id: context.inventoryItemId, purchase_order_item_id: second.purchaseOrderItemId, uom: 'EA', quantity: 1, rate: 12.5 }] }));
  assert.equal(response.status, 400);
  assert.match(response.body.error.message, /does not belong/);
});

test('rejects an inventory item mismatch', { skip: !integration }, async () => {
  const purchaseOrder = await createPurchaseOrder({ inventoryItemId: context.lotInventoryItemId });
  const response = await postInvoice(invoiceBody({ purchase_order_id: purchaseOrder.purchaseOrderId, items: [{ inventory_item_id: context.inventoryItemId, purchase_order_item_id: purchaseOrder.purchaseOrderItemId, uom: 'EA', quantity: 1, rate: 12.5 }] }));
  assert.equal(response.status, 400);
  assert.match(response.body.error.message, /inventory item/);
});

test('rejects a UOM mismatch', { skip: !integration }, async () => {
  const purchaseOrder = await createPurchaseOrder();
  const response = await postInvoice(invoiceBody({ purchase_order_id: purchaseOrder.purchaseOrderId, items: [{ inventory_item_id: context.inventoryItemId, purchase_order_item_id: purchaseOrder.purchaseOrderItemId, uom: 'KG', quantity: 1, rate: 12.5 }] }));
  assert.equal(response.status, 400);
  assert.match(response.body.error.message, /UOM/);
});

test('rejects an invoice quantity above the PO quantity', { skip: !integration }, async () => {
  const purchaseOrder = await createPurchaseOrder({ quantity: 2 });
  const response = await postInvoice(invoiceBody({ purchase_order_id: purchaseOrder.purchaseOrderId, items: [{ inventory_item_id: context.inventoryItemId, purchase_order_item_id: purchaseOrder.purchaseOrderItemId, uom: 'EA', quantity: 3, rate: 12.5 }] }));
  assert.equal(response.status, 400);
  assert.equal(response.body.error.message, 'Invoice quantity exceeds purchase order quantity');
});

test('rejects multiple invoices that exceed the PO quantity', { skip: !integration }, async () => {
  const purchaseOrder = await createPurchaseOrder({ quantity: 3 });
  const item = { inventory_item_id: context.inventoryItemId, purchase_order_item_id: purchaseOrder.purchaseOrderItemId, uom: 'EA', quantity: 2, rate: 12.5 };
  const first = await postInvoice(invoiceBody({ purchase_order_id: purchaseOrder.purchaseOrderId, items: [item] }));
  assert.equal(first.status, 201);
  context.created.vendorInvoiceIds.push(BigInt(first.body.data.vendor_invoice_id));
  const second = await postInvoice(invoiceBody({ purchase_order_id: purchaseOrder.purchaseOrderId, items: [item] }));
  assert.equal(second.status, 400);
  assert.equal(second.body.error.message, 'Invoice quantity exceeds purchase order quantity');
});

test('rejects an invoice rate different from the PO rate', { skip: !integration }, async () => {
  const purchaseOrder = await createPurchaseOrder({ rate: 12.5 });
  const response = await postInvoice(invoiceBody({ purchase_order_id: purchaseOrder.purchaseOrderId, items: [{ inventory_item_id: context.inventoryItemId, purchase_order_item_id: purchaseOrder.purchaseOrderItemId, uom: 'EA', quantity: 1, rate: 13 }] }));
  assert.equal(response.status, 400);
  assert.equal(response.body.error.message, 'Invoice rate does not match purchase order rate');
});

test('recalculates invoice totals on the server', { skip: !integration }, async () => {
  const response = await postInvoice(invoiceBody({ items: [{ inventory_item_id: context.inventoryItemId, uom: 'EA', quantity: 2, rate: 12.5, discount_amount: 1, gst_rate: 18 }] }));
  assert.equal(response.status, 201);
  const invoiceId = BigInt(response.body.data.vendor_invoice_id);
  const invoice = await prisma.vendor_invoice.findUnique({ where: { vendor_invoice_id: invoiceId }, include: { vendor_invoice_item: true } });
  assert.equal(Number(invoice.taxable_amount), 24);
  assert.equal(Number(invoice.cgst_amount), 2.16);
  assert.equal(Number(invoice.sgst_amount), 2.16);
  assert.equal(Number(invoice.total_amount), 28.32);
  assert.equal(Number(invoice.vendor_invoice_item[0].taxable_amount), 24);
  assert.equal(Number(invoice.vendor_invoice_item[0].line_total), 28.32);
  context.created.vendorInvoiceIds.push(invoiceId);
});

test('ignores incorrect client-supplied totals', { skip: !integration }, async () => {
  const response = await postInvoice(invoiceBody({ taxable_amount: 999, total_amount: 9999, items: [{ inventory_item_id: context.inventoryItemId, uom: 'EA', quantity: 2, rate: 12.5, taxable_amount: 888, line_total: 777, cgst_amount: 666, sgst_amount: 555, gst_rate: 0 }] }));
  assert.equal(response.status, 201);
  const invoiceId = BigInt(response.body.data.vendor_invoice_id);
  const invoice = await prisma.vendor_invoice.findUnique({ where: { vendor_invoice_id: invoiceId }, include: { vendor_invoice_item: true } });
  assert.equal(Number(invoice.taxable_amount), 25);
  assert.equal(Number(invoice.total_amount), 25);
  assert.equal(Number(invoice.vendor_invoice_item[0].taxable_amount), 25);
  assert.equal(Number(invoice.vendor_invoice_item[0].line_total), 25);
  context.created.vendorInvoiceIds.push(invoiceId);
});

test('keeps status DRAFT after validation enhancements', { skip: !integration }, async () => {
  const response = await postInvoice(invoiceBody());
  assert.equal(response.status, 201);
  assert.equal(response.body.data.status, 'DRAFT');
  context.created.vendorInvoiceIds.push(BigInt(response.body.data.vendor_invoice_id));
});

test('still rolls back after PO validation and calculated item preparation', { skip: !integration }, async () => {
  const purchaseOrder = await createPurchaseOrder();
  const body = invoiceBody({ purchase_order_id: purchaseOrder.purchaseOrderId, items: [
    { inventory_item_id: context.inventoryItemId, purchase_order_item_id: purchaseOrder.purchaseOrderItemId, uom: 'EA', quantity: 1, rate: 12.5 },
    { inventory_item_id: '999999999', uom: 'EA', quantity: 1, rate: 12.5 }
  ] });
  const response = await postInvoice(body);
  assert.equal(response.status, 400);
  assert.equal(await prisma.vendor_invoice.count({ where: { invoice_number: body.invoice_number } }), 0);
});

test('creates a single GRN match', { skip: !integration }, async () => {
  const grn = await createAcceptedGrn({ quantity: 5 });
  const response = await postInvoice(invoiceBody({ items: [{ inventory_item_id: context.inventoryItemId, uom: 'EA', quantity: 2, rate: 12.5, matches: [{ grn_item_id: grn.grnItemId, matched_quantity: 2 }] }] }));
  assert.equal(response.status, 201);
  assert.equal(response.body.data.vendor_invoice_item[0].vendor_invoice_grn_match.length, 1);
  assert.equal(response.body.data.vendor_invoice_item[0].match_status, 'FULLY_MATCHED');
  context.created.vendorInvoiceIds.push(BigInt(response.body.data.vendor_invoice_id));
});

test('supports multiple GRN matches for one invoice item', { skip: !integration }, async () => {
  const first = await createAcceptedGrn({ quantity: 2 });
  const second = await createAcceptedGrn({ quantity: 2 });
  const response = await postInvoice(invoiceBody({ items: [{ inventory_item_id: context.inventoryItemId, uom: 'EA', quantity: 3, rate: 12.5, matches: [{ grn_item_id: first.grnItemId, matched_quantity: 1 }, { grn_item_id: second.grnItemId, matched_quantity: 2 }] }] }));
  assert.equal(response.status, 201);
  assert.equal(response.body.data.vendor_invoice_item[0].vendor_invoice_grn_match.length, 2);
  assert.equal(response.body.data.vendor_invoice_item[0].match_status, 'FULLY_MATCHED');
  context.created.vendorInvoiceIds.push(BigInt(response.body.data.vendor_invoice_id));
});

test('reports a partial GRN match', { skip: !integration }, async () => {
  const grn = await createAcceptedGrn({ quantity: 5 });
  const response = await postInvoice(invoiceBody({ items: [{ inventory_item_id: context.inventoryItemId, uom: 'EA', quantity: 3, rate: 12.5, matches: [{ grn_item_id: grn.grnItemId, matched_quantity: 2 }] }] }));
  assert.equal(response.status, 201);
  assert.equal(response.body.data.vendor_invoice_item[0].match_status, 'PARTIALLY_MATCHED');
  context.created.vendorInvoiceIds.push(BigInt(response.body.data.vendor_invoice_id));
});

test('reports an unmatched invoice item', { skip: !integration }, async () => {
  const response = await postInvoice(invoiceBody());
  assert.equal(response.status, 201);
  assert.equal(response.body.data.vendor_invoice_item[0].match_status, 'UNMATCHED');
  context.created.vendorInvoiceIds.push(BigInt(response.body.data.vendor_invoice_id));
});

test('rejects a missing GRN item', { skip: !integration }, async () => {
  const response = await postInvoice(invoiceBody({ items: [{ inventory_item_id: context.inventoryItemId, uom: 'EA', quantity: 1, rate: 12.5, matches: [{ grn_item_id: '999999999', matched_quantity: 1 }] }] }));
  assert.equal(response.status, 400);
  assert.match(response.body.error.message, /GRN item does not exist/);
});

test('rejects zero and negative match quantities', { skip: !integration }, async () => {
  const grn = await createAcceptedGrn({ quantity: 5 });
  for (const matchedQuantity of [0, -1]) {
    const response = await postInvoice(invoiceBody({ items: [{ inventory_item_id: context.inventoryItemId, uom: 'EA', quantity: 1, rate: 12.5, matches: [{ grn_item_id: grn.grnItemId, matched_quantity: matchedQuantity }] }] }));
    assert.equal(response.status, 400);
    assert.match(response.body.error.message, /matched_quantity must be greater than zero/);
  }
});

test('rejects an inventory mismatch between invoice and GRN', { skip: !integration }, async () => {
  const grn = await createAcceptedGrn({ inventoryItemId: context.lotInventoryItemId, quantity: 1 });
  const response = await postInvoice(invoiceBody({ items: [{ inventory_item_id: context.inventoryItemId, uom: 'EA', quantity: 1, rate: 12.5, matches: [{ grn_item_id: grn.grnItemId, matched_quantity: 1 }] }] }));
  assert.equal(response.status, 400);
  assert.match(response.body.error.message, /inventory item must match/);
});

test('rejects a UOM mismatch between invoice and GRN', { skip: !integration }, async () => {
  const grn = await createAcceptedGrn({ uom: 'KG', quantity: 1 });
  const response = await postInvoice(invoiceBody({ items: [{ inventory_item_id: context.inventoryItemId, uom: 'EA', quantity: 1, rate: 12.5, matches: [{ grn_item_id: grn.grnItemId, matched_quantity: 1 }] }] }));
  assert.equal(response.status, 400);
  assert.match(response.body.error.message, /UOM must match/);
});

test('rejects a GRN vendor mismatch', { skip: !integration }, async () => {
  const grn = await createAcceptedGrn({ vendorId: context.otherVendorId, quantity: 1 });
  const response = await postInvoice(invoiceBody({ items: [{ inventory_item_id: context.inventoryItemId, uom: 'EA', quantity: 1, rate: 12.5, matches: [{ grn_item_id: grn.grnItemId, matched_quantity: 1 }] }] }));
  assert.equal(response.status, 400);
  assert.match(response.body.error.message, /vendor must match/);
});

test('rejects a GRN PO mismatch', { skip: !integration }, async () => {
  const first = await createPurchaseOrder({ quantity: 2 });
  const second = await createPurchaseOrder({ quantity: 2 });
  const grn = await createAcceptedGrn({ purchaseOrderId: second.purchaseOrderId, purchaseOrderItemId: second.purchaseOrderItemId, quantity: 1 });
  const response = await postInvoice(invoiceBody({ purchase_order_id: first.purchaseOrderId, items: [{ inventory_item_id: context.inventoryItemId, purchase_order_item_id: first.purchaseOrderItemId, uom: 'EA', quantity: 1, rate: 12.5, matches: [{ grn_item_id: grn.grnItemId, matched_quantity: 1 }] }] }));
  assert.equal(response.status, 400);
  assert.match(response.body.error.message, /purchase order must match/);
});

test('rejects match quantity above invoice quantity', { skip: !integration }, async () => {
  const grn = await createAcceptedGrn({ quantity: 5 });
  const response = await postInvoice(invoiceBody({ items: [{ inventory_item_id: context.inventoryItemId, uom: 'EA', quantity: 1, rate: 12.5, matches: [{ grn_item_id: grn.grnItemId, matched_quantity: 2 }] }] }));
  assert.equal(response.status, 400);
  assert.equal(response.body.error.message, 'Matched quantity exceeds invoice item quantity');
});

test('rejects match quantity above accepted GRN quantity', { skip: !integration }, async () => {
  const grn = await createAcceptedGrn({ quantity: 2 });
  const response = await postInvoice(invoiceBody({ items: [{ inventory_item_id: context.inventoryItemId, uom: 'EA', quantity: 3, rate: 12.5, matches: [{ grn_item_id: grn.grnItemId, matched_quantity: 3 }] }] }));
  assert.equal(response.status, 400);
  assert.equal(response.body.error.message, 'Matched quantity exceeds GRN accepted quantity');
});

test('prevents multiple invoices from overmatching one GRN item', { skip: !integration }, async () => {
  const grn = await createAcceptedGrn({ quantity: 2 });
  const item = { inventory_item_id: context.inventoryItemId, uom: 'EA', quantity: 2, rate: 12.5, matches: [{ grn_item_id: grn.grnItemId, matched_quantity: 2 }] };
  const first = await postInvoice(invoiceBody({ items: [item] }));
  assert.equal(first.status, 201);
  context.created.vendorInvoiceIds.push(BigInt(first.body.data.vendor_invoice_id));
  const second = await postInvoice(invoiceBody({ items: [item] }));
  assert.equal(second.status, 400);
  assert.equal(second.body.error.message, 'Matched quantity exceeds GRN accepted quantity');
});

test('rolls back invoice and matches when a duplicate match insert fails', { skip: !integration }, async () => {
  const grn = await createAcceptedGrn({ quantity: 2 });
  const body = invoiceBody({ items: [{ inventory_item_id: context.inventoryItemId, uom: 'EA', quantity: 2, rate: 12.5, matches: [{ grn_item_id: grn.grnItemId, matched_quantity: 1 }, { grn_item_id: grn.grnItemId, matched_quantity: 1 }] }] });
  const response = await postInvoice(body);
  assert.equal(response.status, 409);
  assert.equal(await prisma.vendor_invoice.count({ where: { invoice_number: body.invoice_number } }), 0);
  assert.equal(await prisma.vendor_invoice_grn_match.count({ where: { grn_item_id: BigInt(grn.grnItemId) } }), 0);
});

test('matching keeps DRAFT status and creates no AP or accounting records', { skip: !integration }, async () => {
  const grn = await createAcceptedGrn({ quantity: 1 });
  const response = await postInvoice(invoiceBody({ items: [{ inventory_item_id: context.inventoryItemId, uom: 'EA', quantity: 1, rate: 12.5, matches: [{ grn_item_id: grn.grnItemId, matched_quantity: 1 }] }] }));
  assert.equal(response.status, 201);
  const invoiceId = BigInt(response.body.data.vendor_invoice_id);
  assert.equal(response.body.data.status, 'DRAFT');
  assert.equal(await prisma.accounts_payable.count({ where: { vendor_invoice_id: invoiceId } }), 0);
  assert.equal(await prisma.accounting_entry.count({ where: { source_type: 'VENDOR_INVOICE', source_id: invoiceId } }), 0);
  context.created.vendorInvoiceIds.push(invoiceId);
});

test('calculates intra-state CGST and SGST', { skip: !integration }, async () => {
  const response = await postInvoice(invoiceBody({ supplier_gstin: '27ABCDE1234F1Z5', recipient_gstin: '27PQRSX5678G1Z2', items: [{ inventory_item_id: context.inventoryItemId, uom: 'EA', quantity: 2, rate: 100, gst_rate: 18 }] }));
  assert.equal(response.status, 201);
  const invoiceId = BigInt(response.body.data.vendor_invoice_id);
  const invoice = await prisma.vendor_invoice.findUnique({ where: { vendor_invoice_id: invoiceId }, include: { vendor_invoice_item: true } });
  assert.equal(Number(invoice.taxable_amount), 200);
  assert.equal(Number(invoice.cgst_amount), 18);
  assert.equal(Number(invoice.sgst_amount), 18);
  assert.equal(Number(invoice.igst_amount), 0);
  assert.equal(Number(invoice.total_amount), 236);
  context.created.vendorInvoiceIds.push(invoiceId);
});

test('calculates inter-state IGST', { skip: !integration }, async () => {
  const response = await postInvoice(invoiceBody({ supplier_gstin: '27ABCDE1234F1Z5', recipient_gstin: '29PQRSX5678G1Z8', items: [{ inventory_item_id: context.inventoryItemId, uom: 'EA', quantity: 2, rate: 100, gst_rate: 18 }] }));
  assert.equal(response.status, 201);
  const invoiceId = BigInt(response.body.data.vendor_invoice_id);
  const invoice = await prisma.vendor_invoice.findUnique({ where: { vendor_invoice_id: invoiceId } });
  assert.equal(Number(invoice.cgst_amount), 0);
  assert.equal(Number(invoice.sgst_amount), 0);
  assert.equal(Number(invoice.igst_amount), 36);
  assert.equal(Number(invoice.total_amount), 236);
  context.created.vendorInvoiceIds.push(invoiceId);
});

test('calculates discounts, cess, other charges, and round off', { skip: !integration }, async () => {
  const response = await postInvoice(invoiceBody({ other_charges: 5, round_off: -0.25, items: [{ inventory_item_id: context.inventoryItemId, uom: 'EA', quantity: 2, rate: 100, discount_amount: 10, gst_rate: 18, cess_rate: 1 }] }));
  assert.equal(response.status, 201);
  const invoiceId = BigInt(response.body.data.vendor_invoice_id);
  const invoice = await prisma.vendor_invoice.findUnique({ where: { vendor_invoice_id: invoiceId }, include: { vendor_invoice_item: true } });
  assert.equal(Number(invoice.taxable_amount), 190);
  assert.equal(Number(invoice.cgst_amount), 17.1);
  assert.equal(Number(invoice.sgst_amount), 17.1);
  assert.equal(Number(invoice.cess_amount), 1.9);
  assert.equal(Number(invoice.other_charges), 5);
  assert.equal(Number(invoice.round_off), -0.25);
  assert.equal(Number(invoice.total_amount), 230.85);
  assert.equal(Number(invoice.vendor_invoice_item[0].line_total), 226.1);
  context.created.vendorInvoiceIds.push(invoiceId);
});

test('aggregates multiple item totals', { skip: !integration }, async () => {
  const response = await postInvoice(invoiceBody({ items: [
    { inventory_item_id: context.inventoryItemId, uom: 'EA', quantity: 1, rate: 10, gst_rate: 10 },
    { inventory_item_id: context.inventoryItemId, uom: 'EA', quantity: 2, rate: 20, gst_rate: 5 }
  ] }));
  assert.equal(response.status, 201);
  const invoiceId = BigInt(response.body.data.vendor_invoice_id);
  const invoice = await prisma.vendor_invoice.findUnique({ where: { vendor_invoice_id: invoiceId } });
  assert.equal(Number(invoice.taxable_amount), 50);
  assert.equal(Number(invoice.cgst_amount), 1.5);
  assert.equal(Number(invoice.sgst_amount), 1.5);
  assert.equal(Number(invoice.total_amount), 53);
  context.created.vendorInvoiceIds.push(invoiceId);
});

test('rejects invalid GST rate and negative taxable amount', { skip: !integration }, async () => {
  for (const gstRate of [-1, 101]) {
    const invalidGst = await postInvoice(invoiceBody({ items: [{ inventory_item_id: context.inventoryItemId, uom: 'EA', quantity: 1, rate: 10, gst_rate: gstRate }] }));
    assert.equal(invalidGst.status, 400);
  }
  const negativeTaxable = await postInvoice(invoiceBody({ items: [{ inventory_item_id: context.inventoryItemId, uom: 'EA', quantity: 1, rate: 10, discount_amount: 11 }] }));
  assert.equal(negativeTaxable.status, 400);
  assert.match(negativeTaxable.body.error.message, /taxable amount cannot be negative/);
});

test('rejects invalid discount, charges, and round off', { skip: !integration }, async () => {
  const invalidDiscount = await postInvoice(invoiceBody({ items: [{ inventory_item_id: context.inventoryItemId, uom: 'EA', quantity: 1, rate: 10, discount_amount: -1 }] }));
  assert.equal(invalidDiscount.status, 400);
  const invalidCharges = await postInvoice(invoiceBody({ other_charges: -1 }));
  assert.equal(invalidCharges.status, 400);
  const invalidRoundOff = await postInvoice(invoiceBody({ round_off: 1.01 }));
  assert.equal(invalidRoundOff.status, 400);
  const invalidCess = await postInvoice(invoiceBody({ cess_amount: -1 }));
  assert.equal(invalidCess.status, 400);
});

test('rejects conflicting CGST/SGST and IGST tax structures', { skip: !integration }, async () => {
  const response = await postInvoice(invoiceBody({ cgst_amount: 1, igst_amount: 1 }));
  assert.equal(response.status, 400);
  assert.equal(response.body.error.message, 'CGST/SGST and IGST cannot both apply');
});

test('ignores client tax and total values', { skip: !integration }, async () => {
  const response = await postInvoice(invoiceBody({ taxable_amount: 999, cgst_amount: 999, sgst_amount: 999, igst_amount: 0, cess_amount: 999, total_amount: 9999, items: [{ inventory_item_id: context.inventoryItemId, uom: 'EA', quantity: 2, rate: 12.345, gst_rate: 18, taxable_amount: 1, line_total: 2 }] }));
  assert.equal(response.status, 201);
  const invoiceId = BigInt(response.body.data.vendor_invoice_id);
  const invoice = await prisma.vendor_invoice.findUnique({ where: { vendor_invoice_id: invoiceId } });
  assert.equal(Number(invoice.taxable_amount), 24.69);
  assert.equal(Number(invoice.cgst_amount), 2.22);
  assert.equal(Number(invoice.sgst_amount), 2.22);
  assert.equal(Number(invoice.total_amount), 29.13);
  context.created.vendorInvoiceIds.push(invoiceId);
});

test('preserves DRAFT and creates no AP, payment, or accounting records', { skip: !integration }, async () => {
  const response = await postInvoice(invoiceBody({ other_charges: 2, round_off: 0.5 }));
  assert.equal(response.status, 201);
  const invoiceId = BigInt(response.body.data.vendor_invoice_id);
  assert.equal(response.body.data.status, 'DRAFT');
  assert.equal(await prisma.accounts_payable.count({ where: { vendor_invoice_id: invoiceId } }), 0);
  assert.equal(await prisma.payment.count({ where: { vendor_id: BigInt(context.vendorId), payment_date: new Date('2026-01-15') } }), 0);
  assert.equal(await prisma.accounting_entry.count({ where: { source_type: 'VENDOR_INVOICE', source_id: invoiceId } }), 0);
  context.created.vendorInvoiceIds.push(invoiceId);
});

async function createLifecycleInvoice() {
  const response = await postInvoice(invoiceBody());
  assert.equal(response.status, 201);
  const invoiceId = BigInt(response.body.data.vendor_invoice_id);
  context.created.vendorInvoiceIds.push(invoiceId);
  return invoiceId;
}

async function lifecycleRequest(invoiceId, action) {
  return request(app).post(`/api/procurement/vendor-invoices/${invoiceId}/${action}`).set('Authorization', context.auth).send({});
}

test('books a draft invoice', { skip: !integration }, async () => {
  const invoiceId = await createLifecycleInvoice();
  const response = await lifecycleRequest(invoiceId, 'book');
  assert.equal(response.status, 200);
  assert.equal(response.body.status, 'BOOKED');
});

test('cancels a draft invoice', { skip: !integration }, async () => {
  const invoiceId = await createLifecycleInvoice();
  const response = await lifecycleRequest(invoiceId, 'cancel');
  assert.equal(response.status, 200);
  assert.equal(response.body.status, 'CANCELLED');
});

test('rejects booking and cancellation after terminal transitions', { skip: !integration }, async () => {
  const bookedId = await createLifecycleInvoice();
  assert.equal((await lifecycleRequest(bookedId, 'book')).status, 200);
  assert.equal((await lifecycleRequest(bookedId, 'book')).status, 409);
  assert.equal((await lifecycleRequest(bookedId, 'cancel')).status, 409);

  const cancelledId = await createLifecycleInvoice();
  assert.equal((await lifecycleRequest(cancelledId, 'cancel')).status, 200);
  assert.equal((await lifecycleRequest(cancelledId, 'book')).status, 409);
  assert.equal((await lifecycleRequest(cancelledId, 'cancel')).status, 409);
});

test('booking creates no AP, payment, or accounting records', { skip: !integration }, async () => {
  const invoiceId = await createLifecycleInvoice();
  assert.equal((await lifecycleRequest(invoiceId, 'book')).status, 200);
  assert.equal(await prisma.accounts_payable.count({ where: { vendor_invoice_id: invoiceId } }), 0);
  assert.equal(await prisma.payment.count({ where: { vendor_id: BigInt(context.vendorId) } }), 0);
  assert.equal(await prisma.accounting_entry.count({ where: { source_type: 'VENDOR_INVOICE', source_id: invoiceId } }), 0);
});

test('lists invoices and filters by status', { skip: !integration }, async () => {
  const draftId = await createLifecycleInvoice();
  const bookedId = await createLifecycleInvoice();
  assert.equal((await lifecycleRequest(bookedId, 'book')).status, 200);
  const all = await request(app).get('/api/procurement/vendor-invoices').set('Authorization', context.auth);
  assert.equal(all.status, 200);
  assert.ok(all.body.data.some((invoice) => invoice.vendor_invoice_id === draftId.toString()));
  const filtered = await request(app).get('/api/procurement/vendor-invoices?status=BOOKED').set('Authorization', context.auth);
  assert.equal(filtered.status, 200);
  assert.ok(filtered.body.data.some((invoice) => invoice.vendor_invoice_id === bookedId.toString()));
  assert.ok(filtered.body.data.every((invoice) => invoice.status === 'BOOKED'));
});

test('retrieves an invoice with items and GRN matches', { skip: !integration }, async () => {
  const grn = await createAcceptedGrn({ quantity: 2 });
  const response = await postInvoice(invoiceBody({ items: [{ inventory_item_id: context.inventoryItemId, uom: 'EA', quantity: 2, rate: 12.5, matches: [{ grn_item_id: grn.grnItemId, matched_quantity: 2 }] }] }));
  assert.equal(response.status, 201);
  const invoiceId = BigInt(response.body.data.vendor_invoice_id);
  context.created.vendorInvoiceIds.push(invoiceId);
  const detail = await request(app).get(`/api/procurement/vendor-invoices/${invoiceId}`).set('Authorization', context.auth);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.data.vendor_invoice_item.length, 1);
  assert.equal(detail.body.data.vendor_invoice_item[0].vendor_invoice_grn_match.length, 1);
  assert.equal(detail.body.data.vendor_invoice_item[0].match_status, 'FULLY_MATCHED');
});

test('has no invoice update or delete routes', { skip: !integration }, async () => {
  const invoiceId = await createLifecycleInvoice();
  assert.equal((await request(app).patch(`/api/procurement/vendor-invoices/${invoiceId}`).set('Authorization', context.auth).send({ status: 'BOOKED' })).status, 404);
  assert.equal((await request(app).delete(`/api/procurement/vendor-invoices/${invoiceId}`).set('Authorization', context.auth)).status, 404);
});
