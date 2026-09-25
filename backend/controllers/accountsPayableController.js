const prisma = require('../lib/prisma');
const { ValidationError, NotFoundError } = require('../lib/errors');
const { assertCompanyAccess } = require('../lib/finance');
const { AP_STATUSES, Money, utcDate, calculatePayable, agingBucket } = require('../lib/accountsPayable');

const include = {
  vendor: { select: { vendor_id: true, vendor_code: true, vendor_name: true, company_id: true } },
  vendor_invoice: { select: { vendor_invoice_id: true, invoice_number: true, invoice_date: true } }
};

function publicPayable(row, now) {
  const payable = calculatePayable(row, now);
  // The app serializer recognizes Prisma's Decimal constructor, not precision clones.
  return { ...payable, invoice_amount: payable.invoice_amount.toString(),
    paid_amount: payable.paid_amount.toString(), outstanding_amount: payable.outstanding_amount.toString() };
}

function positiveId(value, field) {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || BigInt(value) > 9223372036854775807n) {
    throw new ValidationError(`${field} must be a positive bigint ID`);
  }
  return BigInt(value);
}

function positiveInteger(value, field, fallback, max) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > max) {
    throw new ValidationError(`${field} must be a positive integer no greater than ${max}`);
  }
  return Number(value);
}

function filters(req, now) {
  if (req.query.as_of !== undefined) throw new ValidationError('Historical AP balances are not available; reports use current balances');
  const where = {};
  const companyId = req.query.company_id === undefined ? req.companyId : positiveId(req.query.company_id, 'company_id');
  assertCompanyAccess(req, companyId);
  where.vendor = { company_id: companyId };
  if (req.query.vendor_id !== undefined) where.vendor_id = positiveId(req.query.vendor_id, 'vendor_id');
  if (req.query.status !== undefined) {
    if (!AP_STATUSES.includes(req.query.status)) throw new ValidationError(`status must be one of ${AP_STATUSES.join(', ')}`);
    where.AND = [effectiveStatusWhere(req.query.status, utcDate(now))];
  }
  return where;
}

// Filter on effective balances/status, not cached status, before pagination/counting.
function effectiveStatusWhere(status, today) {
  const fields = prisma.accounts_payable.fields;
  const active = { status: { notIn: ['PAID', 'CANCELLED'] } };
  const current = { OR: [{ due_date: null }, { due_date: { gte: today } }] };
  if (status === 'CANCELLED') return { status };
  if (status === 'PAID') return { OR: [{ status }, { AND: [active, { invoice_amount: { gt: 0 }, paid_amount: { equals: fields.invoice_amount } }] }] };
  if (status === 'OVERDUE') return { AND: [active, { due_date: { lt: today }, paid_amount: { lt: fields.invoice_amount } }] };
  if (status === 'PARTIALLY_PAID') return { AND: [active, current, { paid_amount: { gt: 0, lt: fields.invoice_amount } }] };
  return { AND: [active, { paid_amount: 0 }, { OR: [{ invoice_amount: 0 }, current] }] };
}

async function list(req, res) {
  const now = new Date();
  const where = filters(req, now);
  if (req.params.vendorId !== undefined) {
    const vendorId = positiveId(req.params.vendorId, 'vendorId');
    if (where.vendor_id !== undefined && where.vendor_id !== vendorId) throw new ValidationError('vendor_id must match the vendor in the URL');
    where.vendor_id = vendorId;
    const vendor = await prisma.vendor.findUnique({ where: { vendor_id: vendorId }, select: { vendor_id: true, company_id: true } });
    if (!vendor) throw new NotFoundError('vendor');
    assertCompanyAccess(req, vendor.company_id);
  }
  const page = positiveInteger(req.query.page, 'page', 1, 2147483647);
  const pageSize = positiveInteger(req.query.pageSize, 'pageSize', 25, 100);
  const skip = (page - 1) * pageSize;
  if (skip > 2147483647) throw new ValidationError('Requested page exceeds the supported offset');
  const [rows, total] = await prisma.$transaction([
    prisma.accounts_payable.findMany({ where, include, orderBy: { accounts_payable_id: 'desc' }, skip, take: pageSize }),
    prisma.accounts_payable.count({ where })
  ], { isolationLevel: 'RepeatableRead' });
  res.json({ success: true, data: rows.map(row => publicPayable(row, now)),
    meta: { page, pageSize, total, pageCount: Math.ceil(total / pageSize), as_of: utcDate(now).toISOString().slice(0, 10) } });
}

async function get(req, res) {
  if (req.query.as_of !== undefined) throw new ValidationError('Historical AP balances are not available; reports use current balances');
  const payable = await prisma.accounts_payable.findUnique({ where: { accounts_payable_id: positiveId(req.params.id, 'id') }, include });
  if (!payable) throw new NotFoundError('accounts payable');
  assertCompanyAccess(req, payable.vendor.company_id);
  res.json({ success: true, data: publicPayable(payable) });
}

async function aging(req, res) {
  const now = new Date();
  const where = filters(req, now);
  const data = await prisma.$transaction(async (tx) => {
    const buckets = Object.fromEntries(['current', 'days_1_30', 'days_31_60', 'days_61_90', 'days_91_plus', 'undated']
      .map(key => [key, { count: 0, outstanding_amount: new Money(0) }]));
    let totalOutstanding = new Money(0);
    let count = 0;
    let cursor;
    // Bound memory usage while retaining a consistent snapshot for the report.
    for (;;) {
      const rows = await tx.accounts_payable.findMany({ where, orderBy: { accounts_payable_id: 'asc' }, take: 500,
        ...(cursor === undefined ? {} : { cursor: { accounts_payable_id: cursor }, skip: 1 }) });
      for (const row of rows) {
        const payable = calculatePayable(row, now);
        const bucket = agingBucket(payable);
        if (!bucket) continue;
        buckets[bucket].count++;
        buckets[bucket].outstanding_amount = buckets[bucket].outstanding_amount.plus(payable.outstanding_amount);
        totalOutstanding = totalOutstanding.plus(payable.outstanding_amount);
        count++;
      }
      if (rows.length < 500) break;
      cursor = rows[rows.length - 1].accounts_payable_id;
    }
    return { as_of: utcDate(now).toISOString().slice(0, 10),
      buckets: Object.fromEntries(Object.entries(buckets).map(([key, bucket]) => [key, {
        count: bucket.count, outstanding_amount: bucket.outstanding_amount.toString()
      }])), count, total_outstanding: totalOutstanding.toString() };
  }, { isolationLevel: 'RepeatableRead' });
  res.json({ success: true, data });
}

module.exports = { list, get, aging };
