const prisma = require('../lib/prisma');
const { Money } = require('../lib/accountsPayable');
const { audit, assertCompanyAccess, financeDate, financeId, financeJson } = require('../lib/finance');
const { ApiError, NotFoundError, ValidationError } = require('../lib/errors');

const STATUSES = ['DRAFT', 'OPEN', 'PARTIALLY_FULFILLED', 'FULFILLED', 'CANCELLED', 'CLOSED'];
const ORDER_TYPES = ['SALES', 'JOB_WORK', 'SERVICE'];
const orderInclude = { customer: true, customer_order_item: { include: { inventory_item: true, delivery_item: { include: { delivery: { select: { delivery_id: true, delivery_number: true, status: true } } } } } } };

function textValue(value, field, { required = false, max = 1000 } = {}) {
  if ((value === undefined || value === null) && !required) return undefined;
  if (typeof value !== 'string' || (required && !value.trim()) || value.length > max) throw new ValidationError(`${field} must be ${required ? 'a non-empty ' : 'a '}string of at most ${max} characters`);
  return value.trim();
}

function decimal(value, field, { positive = false, scale, maximum }) {
  if (!['string', 'number'].includes(typeof value) || !/^-?\d+(\.\d+)?$/.test(String(value))) throw new ValidationError(`${field} must be a decimal number`);
  const amount = new Money(String(value));
  if (!amount.isFinite() || amount.decimalPlaces() > scale || (positive ? amount.lte(0) : amount.lt(0)) || amount.gt(maximum)) throw new ValidationError(`${field} must be ${positive ? 'greater than zero' : 'nonnegative'} with at most ${scale} decimal places`);
  return amount;
}

async function prepareItems(tx, items) {
  if (!Array.isArray(items) || !items.length || items.length > 100) throw new ValidationError('items must contain 1 to 100 lines');
  const prepared = [];
  for (let index = 0; index < items.length; index++) {
    const row = items[index];
    if (!row || typeof row !== 'object') throw new ValidationError(`items[${index}] must be an object`);
    const inventoryItemId = financeId(row.inventory_item_id, `items[${index}].inventory_item_id`);
    const item = await tx.inventory_item.findUnique({ where: { inventory_item_id: inventoryItemId } });
    if (!item || !item.is_active) throw new ValidationError(`items[${index}] inventory item does not exist or is inactive`);
    const uom = textValue(row.uom, `items[${index}].uom`, { required: true, max: 20 });
    if (uom !== item.base_uom) throw new ValidationError(`items[${index}].uom must match inventory item base UOM ${item.base_uom}`);
    const quantity = decimal(row.ordered_quantity ?? row.quantity, `items[${index}].ordered_quantity`, { positive: true, scale: 3, maximum: '999999999999999.999' });
    const rate = decimal(row.unit_rate ?? 0, `items[${index}].unit_rate`, { scale: 4, maximum: '99999999999999.9999' });
    const gstRate = decimal(row.gst_rate ?? item.gst_rate?.toString() ?? 0, `items[${index}].gst_rate`, { scale: 3, maximum: '100' });
    if (row.discount_amount !== undefined) throw new ValidationError(`items[${index}].discount_amount is not supported by the sales-order schema`);
    const lineAmount = quantity.times(rate).toDecimalPlaces(2);
    if (lineAmount.gt('99999999999999.99')) throw new ValidationError(`items[${index}] line amount exceeds the supported range`);
    prepared.push({ inventory_item_id: inventoryItemId, description: textValue(row.description, `items[${index}].description`), hsn_sac_code: textValue(row.hsn_sac_code, `items[${index}].hsn_sac_code`, { max: 20 }), uom,
      ordered_quantity: quantity.toString(), unit_rate: rate.toString(), gst_rate: gstRate.toString(), line_amount: lineAmount.toString() });
  }
  return prepared;
}

function withTotals(order) {
  let taxable = new Money(0), tax = new Money(0);
  for (const item of order.customer_order_item) {
    const line = new Money(item.line_amount.toString());
    taxable = taxable.plus(line);
    tax = tax.plus(line.times(item.gst_rate.toString()).dividedBy(100).toDecimalPlaces(2));
  }
  return { ...order, totals: { taxable_amount: taxable.toString(), tax_amount: tax.toString(), total_amount: taxable.plus(tax).toString() } };
}

function orderData(body, customerId) {
  const orderType = body.order_type ?? 'SALES';
  if (!ORDER_TYPES.includes(orderType)) throw new ValidationError(`order_type must be one of ${ORDER_TYPES.join(', ')}`);
  if (body.status !== undefined && body.status !== 'DRAFT') throw new ValidationError('New sales orders always start in DRAFT');
  return { order_number: textValue(body.order_number, 'order_number', { required: true, max: 100 }), customer_id: customerId, order_date: financeDate(body.order_date, 'order_date'),
    buyer_order_number: textValue(body.buyer_order_number, 'buyer_order_number'), buyer_order_date: body.buyer_order_date === undefined ? undefined : financeDate(body.buyer_order_date, 'buyer_order_date'), order_type: orderType,
    payment_terms: textValue(body.payment_terms, 'payment_terms'), bill_to_address: textValue(body.bill_to_address, 'bill_to_address'), ship_to_address: textValue(body.ship_to_address, 'ship_to_address'),
    consignee_name: textValue(body.consignee_name, 'consignee_name'), consignee_address: textValue(body.consignee_address, 'consignee_address'), place_of_supply: textValue(body.place_of_supply, 'place_of_supply'), remarks: textValue(body.remarks, 'remarks'), status: 'DRAFT' };
}

async function validateCustomer(tx, req, customerId) {
  const row = await tx.customer.findUnique({ where: { customer_id: customerId } });
  if (!row || !row.is_active) throw new ValidationError('Customer does not exist or is inactive');
  assertCompanyAccess(req, row.company_id);
}

async function create(req, res) {
  const customerId = financeId(req.body.customer_id, 'customer_id');
  const result = await prisma.$transaction(async tx => {
    await validateCustomer(tx, req, customerId);
    const items = await prepareItems(tx, req.body.items);
    const order = await tx.customer_order.create({ data: { ...orderData(req.body, customerId), customer_order_item: { create: items } }, include: orderInclude });
    await audit(tx, req.user.user_id, 'SALES_ORDER_CREATED', 'customer_order', order.customer_order_id, undefined, order);
    return withTotals(order);
  });
  res.status(201).json({ success: true, data: financeJson(result) });
}

async function update(req, res) {
  const orderId = financeId(req.params.id, 'id');
  const result = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "customer_order_id" FROM "public"."customer_order" WHERE "customer_order_id" = ${orderId} FOR UPDATE`;
    const old = await tx.customer_order.findUnique({ where: { customer_order_id: orderId }, include: orderInclude });
    if (!old) throw new NotFoundError('sales order');
    assertCompanyAccess(req, old.customer.company_id);
    if (old.status !== 'DRAFT') throw new ApiError(409, 'Only DRAFT sales orders can be changed');
    if (req.body.status !== undefined) throw new ValidationError('Use a sales-order transition endpoint to change status');
    const customerId = req.body.customer_id === undefined ? old.customer_id : financeId(req.body.customer_id, 'customer_id');
    await validateCustomer(tx, req, customerId);
    const data = orderData({ ...old, ...req.body, status: 'DRAFT', order_date: req.body.order_date ?? old.order_date.toISOString().slice(0, 10), buyer_order_date: req.body.buyer_order_date ?? old.buyer_order_date?.toISOString().slice(0, 10) }, customerId);
    if (req.body.items !== undefined) data.customer_order_item = { deleteMany: {}, create: await prepareItems(tx, req.body.items) };
    const order = await tx.customer_order.update({ where: { customer_order_id: orderId }, data, include: orderInclude });
    await audit(tx, req.user.user_id, 'SALES_ORDER_UPDATED', 'customer_order', orderId, old, order);
    return withTotals(order);
  });
  res.json({ success: true, data: financeJson(result) });
}

async function transition(req, res, status) {
  const orderId = financeId(req.params.id, 'id');
  const result = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "customer_order_id" FROM "public"."customer_order" WHERE "customer_order_id" = ${orderId} FOR UPDATE`;
    const old = await tx.customer_order.findUnique({ where: { customer_order_id: orderId }, include: { customer: true, _count: { select: { customer_order_item: true, delivery: true, sales_invoice: true } } } });
    if (!old) throw new NotFoundError('sales order');
    assertCompanyAccess(req, old.customer.company_id);
    if (status === 'OPEN' && old.status !== 'DRAFT') throw new ApiError(409, `Sales order cannot transition from ${old.status} to OPEN`);
    if (status === 'OPEN' && !old._count.customer_order_item) throw new ApiError(409, 'Sales order has no items');
    if (status === 'OPEN' && await tx.approval_workflow.findFirst({ where: { transaction_type: 'SALES_ORDER', is_active: true }, select: { approval_workflow_id: true } })) throw new ApiError(409, 'Sales order requires approval through the configured workflow');
    if (status === 'CANCELLED' && !['DRAFT', 'OPEN'].includes(old.status)) throw new ApiError(409, `Sales order cannot transition from ${old.status} to CANCELLED`);
    if (status === 'CANCELLED' && (old._count.delivery || old._count.sales_invoice)) throw new ApiError(409, 'Sales order with downstream delivery or invoice cannot be cancelled');
    const order = await tx.customer_order.update({ where: { customer_order_id: orderId }, data: { status }, include: orderInclude });
    await audit(tx, req.user.user_id, status === 'OPEN' ? 'SALES_ORDER_CONFIRMED' : 'SALES_ORDER_CANCELLED', 'customer_order', orderId, old, order);
    return withTotals(order);
  });
  res.json({ success: true, data: financeJson(result) });
}

function filters(req) {
  const where = { customer: { company_id: req.companyId } };
  if (req.query.status !== undefined) {
    if (!STATUSES.includes(req.query.status)) throw new ValidationError(`status must be one of ${STATUSES.join(', ')}`);
    where.status = req.query.status;
  }
  if (req.query.search) where.OR = [{ order_number: { contains: String(req.query.search), mode: 'insensitive' } }, { customer: { customer_name: { contains: String(req.query.search), mode: 'insensitive' } } }];
  return where;
}

async function list(req, res) {
  const page = Math.max(1, Math.floor(Number(req.query.page) || 1));
  const pageSize = Math.min(100, Math.max(1, Math.floor(Number(req.query.pageSize) || 25)));
  const where = filters(req);
  const [orders, total] = await prisma.$transaction([prisma.customer_order.findMany({ where, include: orderInclude, orderBy: { customer_order_id: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }), prisma.customer_order.count({ where })]);
  res.json({ success: true, data: financeJson(orders.map(withTotals)), meta: { page, pageSize, total, pageCount: Math.ceil(total / pageSize) } });
}

async function get(req, res) {
  const order = await prisma.customer_order.findFirst({ where: { customer_order_id: financeId(req.params.id, 'id'), customer: { company_id: req.companyId } }, include: { ...orderInclude, delivery: { include: { warehouse: true, delivery_item: { include: { inventory_item: true, inventory_lot: true } } } } } });
  if (!order) throw new NotFoundError('sales order');
  res.json({ success: true, data: financeJson(withTotals(order)) });
}

module.exports = { create, update, confirm: (req, res) => transition(req, res, 'OPEN'), cancel: (req, res) => transition(req, res, 'CANCELLED'), list, get, STATUSES };
