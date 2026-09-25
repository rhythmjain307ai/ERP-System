const prisma = require('../lib/prisma');
const { ValidationError, NotFoundError } = require('../lib/errors');
const { assertCompanyAccess, financeDate, financeId } = require('../lib/finance');
const { Money, utcDate } = require('../lib/accountsPayable');
const { AR_STATUSES, calculateReceivable, agingBucket } = require('../lib/accountsReceivable');

const include = {
  customer: { select: { customer_id: true, customer_code: true, customer_name: true, company_id: true } },
  sales_invoice: { select: { sales_invoice_id: true, invoice_number: true, invoice_date: true, status: true } }
};

function publicReceivable(row, now) {
  const value = calculateReceivable(row, now);
  return { ...value, invoice_amount: value.invoice_amount.toString(), received_amount: value.received_amount.toString(), outstanding_amount: value.outstanding_amount.toString() };
}

function positiveInteger(value, field, fallback, max) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > max) throw new ValidationError(`${field} must be a positive integer no greater than ${max}`);
  return Number(value);
}

function effectiveStatusWhere(status, today) {
  const fields = prisma.accounts_receivable.fields;
  const active = { status: { notIn: ['PAID', 'CANCELLED'] } };
  const current = { OR: [{ due_date: null }, { due_date: { gte: today } }] };
  if (status === 'CANCELLED') return { status };
  if (status === 'PAID') return { OR: [{ status }, { AND: [active, { invoice_amount: { gt: 0 }, received_amount: { equals: fields.invoice_amount } }] }] };
  if (status === 'OVERDUE') return { AND: [active, { due_date: { lt: today }, received_amount: { lt: fields.invoice_amount } }] };
  if (status === 'PARTIALLY_PAID') return { AND: [active, current, { received_amount: { gt: 0, lt: fields.invoice_amount } }] };
  return { AND: [active, { received_amount: 0 }, { OR: [{ invoice_amount: 0 }, current] }] };
}

function filters(req, now) {
  if (req.query.as_of !== undefined) throw new ValidationError('Historical AR balances are not available; reports use current balances');
  const where = { customer: { company_id: req.companyId } };
  if (req.query.customer_id !== undefined) where.customer_id = financeId(req.query.customer_id, 'customer_id');
  if (req.query.status !== undefined) {
    if (!AR_STATUSES.includes(req.query.status)) throw new ValidationError(`status must be one of ${AR_STATUSES.join(', ')}`);
    where.AND = [effectiveStatusWhere(req.query.status, utcDate(now))];
  }
  if (req.query.due_from !== undefined || req.query.due_to !== undefined) {
    where.due_date = {};
    if (req.query.due_from !== undefined) where.due_date.gte = financeDate(req.query.due_from, 'due_from');
    if (req.query.due_to !== undefined) where.due_date.lte = financeDate(req.query.due_to, 'due_to');
    if (where.due_date.gte && where.due_date.lte && where.due_date.gte > where.due_date.lte) throw new ValidationError('due_from cannot be after due_to');
  }
  return where;
}

async function resolveCustomer(req, where) {
  if (req.params.customerId === undefined) return;
  const customerId = financeId(req.params.customerId, 'customerId');
  if (where.customer_id !== undefined && where.customer_id !== customerId) throw new ValidationError('customer_id must match the customer in the URL');
  const customer = await prisma.customer.findUnique({ where: { customer_id: customerId }, select: { company_id: true } });
  if (!customer) throw new NotFoundError('customer');
  assertCompanyAccess(req, customer.company_id);
  where.customer_id = customerId;
}

async function list(req, res) {
  const now = new Date(), where = filters(req, now);
  await resolveCustomer(req, where);
  const page = positiveInteger(req.query.page, 'page', 1, 2147483647), pageSize = positiveInteger(req.query.pageSize, 'pageSize', 25, 100), skip = (page - 1) * pageSize;
  if (skip > 2147483647) throw new ValidationError('Requested page exceeds the supported offset');
  const [rows, total] = await prisma.$transaction([
    prisma.accounts_receivable.findMany({ where, include, orderBy: { accounts_receivable_id: 'desc' }, skip, take: pageSize }),
    prisma.accounts_receivable.count({ where })
  ], { isolationLevel: 'RepeatableRead' });
  res.json({ success: true, data: rows.map(row => publicReceivable(row, now)), meta: { page, pageSize, total, pageCount: Math.ceil(total / pageSize), as_of: utcDate(now).toISOString().slice(0, 10) } });
}

async function get(req, res) {
  if (req.query.as_of !== undefined) throw new ValidationError('Historical AR balances are not available; reports use current balances');
  const row = await prisma.accounts_receivable.findUnique({ where: { accounts_receivable_id: financeId(req.params.id, 'id') }, include });
  if (!row) throw new NotFoundError('accounts receivable');
  assertCompanyAccess(req, row.customer.company_id);
  res.json({ success: true, data: publicReceivable(row) });
}

async function aging(req, res) {
  const now = new Date(), where = filters(req, now);
  await resolveCustomer(req, where);
  const data = await prisma.$transaction(async tx => {
    const buckets = Object.fromEntries(['current', 'days_1_30', 'days_31_60', 'days_61_90', 'days_91_plus', 'undated'].map(key => [key, { count: 0, outstanding_amount: new Money(0) }]));
    let totalOutstanding = new Money(0), count = 0, cursor;
    for (;;) {
      const rows = await tx.accounts_receivable.findMany({ where, orderBy: { accounts_receivable_id: 'asc' }, take: 500, ...(cursor === undefined ? {} : { cursor: { accounts_receivable_id: cursor }, skip: 1 }) });
      for (const row of rows) {
        const value = calculateReceivable(row, now), bucketName = agingBucket(value);
        if (!bucketName) continue;
        buckets[bucketName].count++;
        buckets[bucketName].outstanding_amount = buckets[bucketName].outstanding_amount.plus(value.outstanding_amount);
        totalOutstanding = totalOutstanding.plus(value.outstanding_amount); count++;
      }
      if (rows.length < 500) break;
      cursor = rows[rows.length - 1].accounts_receivable_id;
    }
    return { as_of: utcDate(now).toISOString().slice(0, 10), buckets: Object.fromEntries(Object.entries(buckets).map(([key, bucket]) => [key, { count: bucket.count, outstanding_amount: bucket.outstanding_amount.toString() }])), count, total_outstanding: totalOutstanding.toString() };
  }, { isolationLevel: 'RepeatableRead' });
  res.json({ success: true, data });
}

module.exports = { list, get, aging };
