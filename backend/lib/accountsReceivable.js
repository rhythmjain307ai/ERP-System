const { ApiError, NotFoundError, ValidationError } = require('./errors');
const { Money, utcDate } = require('./accountsPayable');

const AR_STATUSES = ['OPEN', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED'];
const DAY_MS = 86400000;

function money(value, field) {
  let result;
  try { result = new Money(value.toString()); } catch { throw new ValidationError(`${field} must be a monetary amount`); }
  if (!result.isFinite() || result.lt(0) || result.decimalPlaces() > 2) throw new ValidationError(`${field} must be nonnegative with at most two decimal places`);
  return result;
}

function calculateReceivable(receivable, now = new Date()) {
  if (!AR_STATUSES.includes(receivable.status)) throw new ValidationError('Unknown accounts receivable status');
  const invoiceAmount = money(receivable.invoice_amount, 'invoice_amount');
  const receivedAmount = money(receivable.received_amount, 'received_amount');
  if (receivedAmount.gt(invoiceAmount)) throw new ValidationError('received_amount cannot exceed invoice_amount');
  const outstanding = invoiceAmount.minus(receivedAmount);
  const today = utcDate(now);
  const dueDate = receivable.due_date == null ? null : utcDate(receivable.due_date);
  let status = receivable.status;
  if (status === 'CANCELLED') return { ...receivable, invoice_amount: invoiceAmount, received_amount: receivedAmount, outstanding_amount: money(receivable.outstanding_amount, 'outstanding_amount'), days_overdue: 0 };
  if (status === 'PAID' && !outstanding.isZero()) throw new ApiError(409, 'PAID accounts receivable cannot be reopened');
  if (status !== 'PAID') {
    if (invoiceAmount.gt(0) && outstanding.isZero()) status = 'PAID';
    else if (outstanding.gt(0) && dueDate && dueDate < today) status = 'OVERDUE';
    else if (receivedAmount.gt(0)) status = 'PARTIALLY_PAID';
    else status = 'OPEN';
  }
  const daysOverdue = outstanding.gt(0) && dueDate ? Math.max(0, (today - dueDate) / DAY_MS) : 0;
  return { ...receivable, invoice_amount: invoiceAmount, received_amount: receivedAmount, outstanding_amount: outstanding, status, days_overdue: daysOverdue };
}

async function recalculateReceivable(tx, receivableId, now = new Date()) {
  if (typeof tx.$transaction === 'function') throw new TypeError('recalculateReceivable requires an interactive transaction client');
  await tx.$queryRaw`SELECT "accounts_receivable_id" FROM "public"."accounts_receivable" WHERE "accounts_receivable_id" = ${receivableId} FOR UPDATE`;
  const row = await tx.accounts_receivable.findUnique({ where: { accounts_receivable_id: receivableId } });
  if (!row) throw new NotFoundError('accounts receivable');
  const calculated = calculateReceivable(row, now);
  if (row.status !== 'CANCELLED') await tx.accounts_receivable.update({ where: { accounts_receivable_id: receivableId }, data: { outstanding_amount: calculated.outstanding_amount, status: calculated.status } });
  return calculated;
}

function agingBucket(receivable) {
  if (['PAID', 'CANCELLED'].includes(receivable.status) || !receivable.outstanding_amount.gt(0)) return null;
  if (receivable.due_date == null) return 'undated';
  if (receivable.days_overdue === 0) return 'current';
  if (receivable.days_overdue <= 30) return 'days_1_30';
  if (receivable.days_overdue <= 60) return 'days_31_60';
  if (receivable.days_overdue <= 90) return 'days_61_90';
  return 'days_91_plus';
}

module.exports = { AR_STATUSES, calculateReceivable, recalculateReceivable, agingBucket };
