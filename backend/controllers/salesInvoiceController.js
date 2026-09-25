const prisma = require('../lib/prisma');
const { Money } = require('../lib/accountsPayable');
const { audit, assertCompanyAccess, financeDate, financeId, financeJson } = require('../lib/finance');
const { ApiError, NotFoundError, ValidationError } = require('../lib/errors');
const { postSalesInvoice } = require('../lib/accounting');
const TYPES = ['TAX_INVOICE', 'SERVICE_INVOICE', 'JOB_WORK_INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE'];
const STATUSES = ['DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED'];
const include = { customer: true, customer_order: true, accounts_receivable: true, sales_invoice_item: { include: { inventory_item: true, customer_order_item: true } }, delivery: { include: { warehouse: true, delivery_item: true } } };
function amount(value, field, { positive = false, scale = 2, maximum = '99999999999999.99', minimum = '0' } = {}) {
  if (!['string', 'number'].includes(typeof value) || !/^-?\d+(\.\d+)?$/.test(String(value))) throw new ValidationError(`${field} must be a decimal number`);
  const result = new Money(String(value));
  if (!result.isFinite() || result.decimalPlaces() > scale || (positive ? result.lte(0) : result.lt(minimum)) || result.gt(maximum)) throw new ValidationError(`${field} is outside the supported range or scale`);
  return result;
}
function optionalText(value, field, max = 1000) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || value.length > max) throw new ValidationError(`${field} must be a string of at most ${max} characters`);
  return value.trim();
}
function stateCode(gstin, fallback) { return typeof gstin === 'string' && /^\d{2}/.test(gstin) ? gstin.slice(0, 2) : fallback; }
async function invoiceContext(tx, req, body) {
  const customerId = financeId(body.customer_id, 'customer_id');
  const customer = await tx.customer.findUnique({ where: { customer_id: customerId }, include: { company: true } });
  if (!customer?.is_active) throw new ValidationError('Customer does not exist or is inactive');
  assertCompanyAccess(req, customer.company_id);
  let order;
  if (body.customer_order_id !== undefined && body.customer_order_id !== null) {
    const orderId = financeId(body.customer_order_id, 'customer_order_id');
    order = await tx.customer_order.findUnique({ where: { customer_order_id: orderId }, include: { customer_order_item: true } });
    if (!order || order.customer_id !== customerId || !['OPEN', 'PARTIALLY_FULFILLED', 'FULFILLED', 'CLOSED'].includes(order.status)) throw new ValidationError('Sales order must belong to the customer and be confirmed');
  }
  return { customer, order };
}
async function prepareItems(tx, body, order, customer) {
  if (!Array.isArray(body.items) || !body.items.length || body.items.length > 100) throw new ValidationError('items must contain 1 to 100 lines');
  const orderItems = new Map((order?.customer_order_item || []).map(row => [row.customer_order_item_id.toString(), row]));
  const interstate = Boolean(stateCode(customer.company.gstin, customer.company.state_code) && stateCode(customer.gstin, customer.state_code) && stateCode(customer.company.gstin, customer.company.state_code) !== stateCode(customer.gstin, customer.state_code));
  const lines = [];
  for (let index = 0; index < body.items.length; index++) {
    const row = body.items[index]; if (!row || typeof row !== 'object') throw new ValidationError(`items[${index}] must be an object`);
    const orderItemId = row.customer_order_item_id === undefined ? undefined : financeId(row.customer_order_item_id, `items[${index}].customer_order_item_id`);
    const orderItem = orderItemId ? orderItems.get(orderItemId.toString()) : undefined;
    if (order && !orderItem) throw new ValidationError(`items[${index}] must reference an item from the selected sales order`);
    const inventoryItemId = orderItem?.inventory_item_id || financeId(row.inventory_item_id, `items[${index}].inventory_item_id`);
    const item = await tx.inventory_item.findUnique({ where: { inventory_item_id: inventoryItemId } });
    if (!item?.is_active) throw new ValidationError(`items[${index}] inventory item does not exist or is inactive`);
    const uom = orderItem?.uom || optionalText(row.uom, `items[${index}].uom`, 20);
    if (!uom || uom !== item.base_uom) throw new ValidationError(`items[${index}].uom must match inventory item base UOM ${item.base_uom}`);
    const quantity = amount(row.quantity, `items[${index}].quantity`, { positive: true, scale: 3, maximum: '999999999999999.999' });
    const price = orderItem ? new Money(orderItem.unit_rate.toString()) : amount(row.unit_price ?? 0, `items[${index}].unit_price`, { scale: 4, maximum: '99999999999999.9999' });
    const gross = quantity.times(price).toDecimalPlaces(2), discount = amount(row.discount_amount ?? 0, `items[${index}].discount_amount`);
    if (discount.gt(gross)) throw new ValidationError(`items[${index}].discount_amount cannot exceed line gross amount`);
    const taxable = gross.minus(discount);
    const gstRate = orderItem ? new Money(orderItem.gst_rate.toString()) : amount(row.gst_rate ?? item.gst_rate?.toString() ?? 0, `items[${index}].gst_rate`, { scale: 3, maximum: '100' });
    const totalTax = taxable.times(gstRate).dividedBy(100).toDecimalPlaces(2), cgst = interstate ? new Money(0) : totalTax.dividedBy(2).toDecimalPlaces(2), sgst = interstate ? new Money(0) : totalTax.minus(cgst), igst = interstate ? totalTax : new Money(0);
    lines.push({ customer_order_item_id: orderItemId, inventory_item_id: inventoryItemId, description: optionalText(row.description, `items[${index}].description`) || orderItem?.description || item.item_name,
      hsn_sac_code: optionalText(row.hsn_sac_code, `items[${index}].hsn_sac_code`, 20) || orderItem?.hsn_sac_code, uom, quantity: quantity.toString(), unit_price: price.toString(), discount_amount: discount.toString(),
      taxable_amount: taxable.toString(), gst_rate: gstRate.toString(), cgst_amount: cgst.toString(), sgst_amount: sgst.toString(), igst_amount: igst.toString(), cess_amount: '0', line_total: taxable.plus(totalTax).toString() });
  }
  return lines;
}
async function attachDeliveries(tx, body, invoice, customer, order) {
  if (body.delivery_ids === undefined) return;
  if (!Array.isArray(body.delivery_ids) || !body.delivery_ids.length || body.delivery_ids.length > 100) throw new ValidationError('delivery_ids must contain 1 to 100 IDs');
  const ids = body.delivery_ids.map((value, index) => financeId(value, `delivery_ids[${index}]`)).sort((a, b) => a < b ? -1 : 1);
  if (new Set(ids.map(String)).size !== ids.length) throw new ValidationError('delivery_ids cannot contain duplicates');
  for (const id of ids) {
    await tx.$queryRaw`SELECT "delivery_id" FROM "public"."delivery" WHERE "delivery_id" = ${id} FOR UPDATE`;
    const delivery = await tx.delivery.findUnique({ where: { delivery_id: id } });
    if (!delivery || delivery.customer_id !== customer.customer_id || (order && delivery.customer_order_id !== order.customer_order_id) || !['DISPATCHED', 'DELIVERED'].includes(delivery.status)) throw new ValidationError('Each delivery must be dispatched and belong to the invoice customer and sales order');
    if (delivery.sales_invoice_id) throw new ApiError(409, 'Delivery is already linked to a sales invoice');
    await tx.delivery.update({ where: { delivery_id: id }, data: { sales_invoice_id: invoice.sales_invoice_id } });
  }
}
async function create(req, res) {
  if (typeof req.body.invoice_number !== 'string' || !req.body.invoice_number.trim() || req.body.invoice_number.length > 100) throw new ValidationError('invoice_number must be a non-empty string of at most 100 characters');
  if (req.body.status !== undefined && req.body.status !== 'DRAFT') throw new ValidationError('New sales invoices always start in DRAFT');
  const result = await prisma.$transaction(async tx => {
    const { customer, order } = await invoiceContext(tx, req, req.body), lines = await prepareItems(tx, req.body, order, customer);
    const invoiceDate = financeDate(req.body.invoice_date, 'invoice_date');
    const dueDate = req.body.due_date === undefined ? new Date(invoiceDate.getTime() + customer.payment_terms_days * 86400000) : financeDate(req.body.due_date, 'due_date');
    if (dueDate < invoiceDate) throw new ValidationError('due_date cannot precede invoice_date');
    const type = req.body.invoice_type ?? 'TAX_INVOICE'; if (!TYPES.includes(type)) throw new ValidationError(`invoice_type must be one of ${TYPES.join(', ')}`);
    const other = amount(req.body.other_charges ?? 0, 'other_charges'), round = amount(req.body.round_off ?? 0, 'round_off', { minimum: '-1', maximum: '1' });
    const total = field => lines.reduce((sum, row) => sum.plus(row[field]), new Money(0));
    const taxable = total('taxable_amount'), cgst = total('cgst_amount'), sgst = total('sgst_amount'), igst = total('igst_amount'), cess = total('cess_amount'), discount = total('discount_amount');
    const invoice = await tx.sales_invoice.create({ data: { invoice_number: req.body.invoice_number.trim(), invoice_type: type, customer_id: customer.customer_id, customer_order_id: order?.customer_order_id,
      invoice_date: invoiceDate, due_date: dueDate, payment_terms: optionalText(req.body.payment_terms, 'payment_terms'), place_of_supply: optionalText(req.body.place_of_supply, 'place_of_supply'), bill_to_name: optionalText(req.body.bill_to_name, 'bill_to_name') || customer.customer_name,
      bill_to_address: optionalText(req.body.bill_to_address, 'bill_to_address') || customer.billing_address, bill_to_gstin: optionalText(req.body.bill_to_gstin, 'bill_to_gstin', 15) || customer.gstin,
      ship_to_name: optionalText(req.body.ship_to_name, 'ship_to_name'), ship_to_address: optionalText(req.body.ship_to_address, 'ship_to_address'), taxable_amount: taxable.toString(), cgst_amount: cgst.toString(), sgst_amount: sgst.toString(), igst_amount: igst.toString(), cess_amount: cess.toString(),
      discount_amount: discount.toString(), other_charges: other.toString(), round_off: round.toString(), total_amount: taxable.plus(cgst).plus(sgst).plus(igst).plus(cess).plus(other).plus(round).toString(), status: 'DRAFT', notes: optionalText(req.body.notes, 'notes'), sales_invoice_item: { create: lines } }, include });
    await attachDeliveries(tx, req.body, invoice, customer, order);
    const complete = await tx.sales_invoice.findUnique({ where: { sales_invoice_id: invoice.sales_invoice_id }, include });
    await audit(tx, req.user.user_id, 'SALES_INVOICE_CREATED', 'sales_invoice', invoice.sales_invoice_id, undefined, complete); return complete;
  });
  res.status(201).json({ success: true, data: financeJson(result) });
}
async function issue(req, res) {
  const invoiceId = financeId(req.params.id, 'id');
  const result = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "sales_invoice_id" FROM "public"."sales_invoice" WHERE "sales_invoice_id" = ${invoiceId} FOR UPDATE`;
    const invoice = await tx.sales_invoice.findUnique({ where: { sales_invoice_id: invoiceId }, include });
    if (!invoice) throw new NotFoundError('sales invoice'); assertCompanyAccess(req, invoice.customer.company_id);
    if (invoice.status !== 'DRAFT') throw new ApiError(409, `Sales invoice cannot be issued from ${invoice.status}`);
    if (invoice.invoice_type !== 'SERVICE_INVOICE' && !invoice.delivery.length) throw new ApiError(409, 'A non-service sales invoice must reference at least one dispatched delivery');
    if (invoice.invoice_type !== 'SERVICE_INVOICE') {
      for (const line of invoice.sales_invoice_item) {
        const delivered = invoice.delivery.flatMap(row => row.delivery_item).filter(row => line.customer_order_item_id ? row.customer_order_item_id === line.customer_order_item_id : row.inventory_item_id === line.inventory_item_id && row.uom === line.uom).reduce((sum, row) => sum.plus(row.delivered_quantity.toString()), new Money(0));
        if (new Money(line.quantity.toString()).gt(delivered)) throw new ApiError(409, `Invoice line ${line.sales_invoice_item_id} exceeds delivered quantity ${delivered}`);
      }
    }
    const receivable = await tx.accounts_receivable.create({ data: { customer_id: invoice.customer_id, sales_invoice_id: invoiceId, due_date: invoice.due_date, invoice_amount: invoice.total_amount, received_amount: 0, outstanding_amount: invoice.total_amount, status: 'OPEN' } });
    await postSalesInvoice(tx, invoice, req.user.user_id);
    const updated = await tx.sales_invoice.update({ where: { sales_invoice_id: invoiceId }, data: { status: 'ISSUED' }, include });
    await audit(tx, req.user.user_id, 'ACCOUNTS_RECEIVABLE_CREATED', 'accounts_receivable', receivable.accounts_receivable_id, undefined, receivable);
    await audit(tx, req.user.user_id, 'SALES_INVOICE_ISSUED', 'sales_invoice', invoiceId, invoice, updated); return updated;
  });
  res.json({ success: true, data: financeJson(result) });
}
function queryWhere(req) {
  const filter = { customer: { company_id: req.companyId } };
  if (req.query.status !== undefined) { if (!STATUSES.includes(req.query.status)) throw new ValidationError(`status must be one of ${STATUSES.join(', ')}`); filter.status = req.query.status; }
  if (req.query.search) filter.OR = [{ invoice_number: { contains: String(req.query.search), mode: 'insensitive' } }, { customer: { customer_name: { contains: String(req.query.search), mode: 'insensitive' } } }]; return filter;
}
async function list(req, res) {
  const page = Math.max(1, Math.floor(Number(req.query.page) || 1)), pageSize = Math.min(100, Math.max(1, Math.floor(Number(req.query.pageSize) || 25))), where = queryWhere(req);
  const [data, total] = await prisma.$transaction([prisma.sales_invoice.findMany({ where, include, orderBy: { sales_invoice_id: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }), prisma.sales_invoice.count({ where })]);
  res.json({ success: true, data: financeJson(data), meta: { page, pageSize, total, pageCount: Math.ceil(total / pageSize) } });
}
async function get(req, res) {
  const row = await prisma.sales_invoice.findFirst({ where: { sales_invoice_id: financeId(req.params.id, 'id'), customer: { company_id: req.companyId } }, include });
  if (!row) throw new NotFoundError('sales invoice'); res.json({ success: true, data: financeJson(row) });
}
async function cancel(req, res) {
  const invoiceId = financeId(req.params.id, 'id');
  const result = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "sales_invoice_id" FROM "public"."sales_invoice" WHERE "sales_invoice_id" = ${invoiceId} FOR UPDATE`;
    const invoice = await tx.sales_invoice.findUnique({ where: { sales_invoice_id: invoiceId }, include });
    if (!invoice) throw new NotFoundError('sales invoice');
    assertCompanyAccess(req, invoice.customer.company_id);
    if (invoice.status !== 'DRAFT') throw new ApiError(409, 'Only DRAFT invoices can be cancelled directly; reverse issued invoices');
    const updated = await tx.sales_invoice.update({ where: { sales_invoice_id: invoiceId }, data: { status: 'CANCELLED' }, include });
    await audit(tx, req.user.user_id, 'SALES_INVOICE_CANCELLED', 'sales_invoice', invoiceId, invoice, updated);
    return updated;
  });
  res.json({ success: true, data: financeJson(result) });
}
module.exports = { create, issue, cancel, list, get };
