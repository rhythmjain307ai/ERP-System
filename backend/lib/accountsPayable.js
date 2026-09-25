const { Prisma } = require('@prisma/client');
const { ApiError, NotFoundError, ValidationError } = require('./errors');

const Money = Prisma.Decimal.clone({ precision: 40 });
const AP_STATUSES = ['OPEN', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED'];
const DAY_MS = 86400000;

function utcDate(value = new Date()) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new ValidationError('A valid date is required');
  return new Date(`${value.toISOString().slice(0, 10)}T00:00:00.000Z`);
}

function money(value, field) {
  let amount;
  try { amount = new Money(value.toString()); } catch { throw new ValidationError(`${field} must be a monetary amount`); }
  if (!amount.isFinite() || amount.lt(0) || amount.decimalPlaces() > 2) {
    throw new ValidationError(`${field} must be nonnegative with at most two decimal places`);
  }
  return amount;
}

// Phase 2G uses persisted paid_amount. Allocation will supply it transactionally in Phase 2I.
function calculatePayable(payable, now = new Date()) {
  if (!AP_STATUSES.includes(payable.status)) throw new ValidationError('Unknown accounts payable status');
  const invoiceAmount = money(payable.invoice_amount, 'invoice_amount');
  const paidAmount = money(payable.paid_amount, 'paid_amount');
  if (paidAmount.gt(invoiceAmount)) throw new ValidationError('paid_amount cannot exceed invoice_amount');
  const outstanding = invoiceAmount.minus(paidAmount);
  const today = utcDate(now);
  const dueDate = payable.due_date == null ? null : utcDate(payable.due_date);
  let status = payable.status;
  // Cancellation is reserved for reversals; recalculation must not change its balances.
  if (status === 'CANCELLED') {
    return { ...payable, invoice_amount: invoiceAmount, paid_amount: paidAmount,
      outstanding_amount: money(payable.outstanding_amount, 'outstanding_amount'), days_overdue: 0 };
  }
  if (status === 'PAID' && !outstanding.isZero()) throw new ApiError(409, 'PAID accounts payable cannot be reopened');
  if (status !== 'PAID') {
    if (invoiceAmount.gt(0) && outstanding.isZero()) status = 'PAID';
    else if (outstanding.gt(0) && dueDate && dueDate < today) status = 'OVERDUE';
    else if (paidAmount.gt(0)) status = 'PARTIALLY_PAID';
    else status = 'OPEN';
  }
  const daysOverdue = outstanding.gt(0) && dueDate ? Math.max(0, (today - dueDate) / DAY_MS) : 0;
  return { ...payable, invoice_amount: invoiceAmount, paid_amount: paidAmount,
    outstanding_amount: outstanding, status, days_overdue: daysOverdue };
}

// Pass an interactive transaction client so the lock covers reading AND updating.
async function recalculatePayable(tx, payableId, now = new Date()) {
  if (typeof tx.$transaction === 'function') throw new TypeError('recalculatePayable requires an interactive transaction client');
  await tx.$queryRaw`SELECT "accounts_payable_id" FROM "public"."accounts_payable" WHERE "accounts_payable_id" = ${payableId} FOR UPDATE`;
  const payable = await tx.accounts_payable.findUnique({ where: { accounts_payable_id: payableId } });
  if (!payable) throw new NotFoundError('accounts payable');
  const calculated = calculatePayable(payable, now);
  if (payable.status === 'CANCELLED') return calculated;
  await tx.accounts_payable.update({ where: { accounts_payable_id: payableId }, data: {
    outstanding_amount: calculated.outstanding_amount,
    status: calculated.status
  } });
  return calculated;
}

function agingBucket(payable) {
  if (['PAID', 'CANCELLED'].includes(payable.status) || !payable.outstanding_amount.gt(0)) return null;
  if (payable.due_date == null) return 'undated';
  if (payable.days_overdue === 0) return 'current';
  if (payable.days_overdue <= 30) return 'days_1_30';
  if (payable.days_overdue <= 60) return 'days_31_60';
  if (payable.days_overdue <= 90) return 'days_61_90';
  return 'days_91_plus';
}

module.exports = { AP_STATUSES, Money, utcDate, calculatePayable, recalculatePayable, agingBucket };
