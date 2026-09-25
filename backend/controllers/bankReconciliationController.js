const prisma = require('../lib/prisma');
const { financeId, positiveMoney, financeDate, assertCompanyAccess, audit, financeJson } = require('../lib/finance');
const { Money } = require('../lib/accountsPayable');
const { range } = require('./vendorLedgerController');
const { ApiError, NotFoundError, ValidationError } = require('../lib/errors');

async function create(req, res) {
  const bankId = financeId(req.body.bank_account_id, 'bank_account_id');
  const amount = positiveMoney(req.body.amount);
  const date = financeDate(req.body.transaction_date, 'transaction_date');
  if (!['DEBIT', 'CREDIT'].includes(req.body.transaction_type)) throw new ValidationError('transaction_type must be DEBIT or CREDIT');
  for (const field of ['reference_number', 'description']) if (req.body[field] !== undefined && (typeof req.body[field] !== 'string' || req.body[field].length > 1000)) throw new ValidationError(`${field} must be a string of at most 1000 characters`);
  const data = await prisma.$transaction(async tx => {
    const bank = await tx.bank_account.findUnique({ where: { bank_account_id: bankId } });
    if (!bank?.is_active) throw new ValidationError('An active bank account is required');
    assertCompanyAccess(req, bank.company_id);
    const row = await tx.bank_transaction.create({ data: { bank_account_id: bankId, transaction_date: date, transaction_type: req.body.transaction_type, amount: amount.toString(), reference_number: req.body.reference_number, description: req.body.description } });
    await audit(tx, req.user.user_id, 'BANK_TRANSACTION_RECORDED', 'bank_transaction', row.bank_transaction_id, undefined, row);
    return row;
  });
  res.status(201).json({ success: true, data: financeJson(data) });
}

async function transition(req, res, action) {
  const id = financeId(req.params.id, 'bank_transaction_id');
  const requestedPayment = action === 'match' ? financeId(req.body.payment_id, 'payment_id') : null;
  const data = await prisma.$transaction(async tx => {
    const initial = await tx.bank_transaction.findUnique({ where: { bank_transaction_id: id } });
    if (!initial) throw new NotFoundError('bank transaction');
    const paymentId = requestedPayment || initial.payment_id;
    if (!paymentId) throw new ApiError(409, 'Bank transaction is not matched');
    // Same payment-first lock order as allocations/reversals.
    await tx.$queryRaw`SELECT "payment_id" FROM "public"."payment" WHERE "payment_id" = ${paymentId} FOR UPDATE`;
    await tx.$queryRaw`SELECT "bank_transaction_id" FROM "public"."bank_transaction" WHERE "bank_transaction_id" = ${id} FOR UPDATE`;
    const row = await tx.bank_transaction.findUnique({ where: { bank_transaction_id: id }, include: { bank_account: true } });
    assertCompanyAccess(req, row.bank_account.company_id);
    const payment = await tx.payment.findUnique({ where: { payment_id: paymentId }, include: { vendor: true } });
    if (!payment || payment.status !== 'CREATED' || payment.payment_type !== 'VENDOR_PAYMENT' || payment.mode === 'CASH' || !row.bank_account.is_active || payment.bank_account_id !== row.bank_account_id || payment.vendor?.company_id !== row.bank_account.company_id || row.transaction_type !== 'DEBIT' || !new Money(row.amount.toString()).eq(payment.amount.toString())) throw new ValidationError('Bank transaction and payment must match bank, company, direction, amount, and active payment status');
    if (action === 'match') {
      if (row.reconciliation_status !== 'UNRECONCILED' || row.payment_id) throw new ApiError(409, 'Bank transaction is already linked');
      if (await tx.bank_transaction.findUnique({ where: { payment_id: paymentId } })) throw new ApiError(409, 'Payment is already linked to a bank transaction');
    } else if (row.reconciliation_status !== 'MATCHED' || row.payment_id !== paymentId) throw new ApiError(409, 'Only the current MATCHED link may be reconciled or unmatched');
    const changes = action === 'match' ? { payment_id: paymentId, reconciliation_status: 'MATCHED', matched_by: req.user.user_id, matched_at: new Date() }
      : action === 'reconcile' ? { reconciliation_status: 'RECONCILED', reconciled_by: req.user.user_id, reconciled_at: new Date() }
        : { payment_id: null, reconciliation_status: 'UNRECONCILED', matched_by: null, matched_at: null };
    const updated = await tx.bank_transaction.update({ where: { bank_transaction_id: id }, data: changes });
    await audit(tx, req.user.user_id, `BANK_${action.toUpperCase()}`, 'bank_transaction', id, row, updated);
    return updated;
  });
  res.json({ success: true, data: financeJson(data) });
}

async function report(req, res) {
  const bankId = financeId(req.query.bank_account_id, 'bank_account_id');
  const { from, to } = range(req.query);
  const data = await prisma.$transaction(async tx => {
    const bank = await tx.bank_account.findUnique({ where: { bank_account_id: bankId }, select: { bank_account_id: true, bank_name: true, account_name: true, company_id: true } });
    if (!bank) throw new NotFoundError('bank account');
    assertCompanyAccess(req, bank.company_id);
    const rows = await tx.bank_transaction.findMany({ where: { bank_account_id: bankId, transaction_date: { gte: from, lte: to } }, include: { payment: true }, orderBy: [{ transaction_date: 'asc' }, { bank_transaction_id: 'asc' }] });
    const totals = Object.fromEntries(['UNRECONCILED', 'MATCHED', 'RECONCILED'].map(key => [key, { count: 0, debit: new Money(0), credit: new Money(0) }]));
    for (const row of rows) { const total = totals[row.reconciliation_status]; total.count++; const field = row.transaction_type.toLowerCase(); total[field] = total[field].plus(row.amount.toString()); }
    return { bank, from, to, transactions: rows, totals };
  }, { isolationLevel: 'RepeatableRead' });
  res.json({ success: true, data: financeJson(data) });
}
module.exports = { create, report, match: (req, res) => transition(req, res, 'match'), reconcile: (req, res) => transition(req, res, 'reconcile'), unmatch: (req, res) => transition(req, res, 'unmatch') };
