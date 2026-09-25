const prisma = require('../lib/prisma');
const { postAllocation } = require('../lib/accounting');
const { ValidationError, ApiError, NotFoundError } = require('../lib/errors');
const { Money, recalculatePayable } = require('../lib/accountsPayable');
const { financeId, positiveMoney, financeDate, assertCompanyAccess, audit, financeJson } = require('../lib/finance');

const MODES = ['BANK', 'CASH', 'CHEQUE', 'UPI', 'NEFT', 'RTGS', 'IMPS', 'OTHER'];

async function create(req, res) {
  const vendorId = financeId(req.body.vendor_id, 'vendor_id');
  const payableId = financeId(req.body.accounts_payable_id, 'accounts_payable_id');
  const amount = positiveMoney(req.body.amount);
  if (!MODES.includes(req.body.mode)) throw new ValidationError(`mode must be one of ${MODES.join(', ')}`);
  if (req.body.payment_type !== 'VENDOR_PAYMENT') throw new ValidationError('payment_type must be VENDOR_PAYMENT for this endpoint');
  if (req.body.customer_id !== undefined) throw new ValidationError('Vendor payments cannot specify customer_id');
  const paymentDate = financeDate(req.body.payment_date, 'payment_date');
  const bankId = req.body.mode === 'CASH' ? null : financeId(req.body.bank_account_id, 'bank_account_id');
  if (req.body.mode === 'CASH' && req.body.bank_account_id != null) throw new ValidationError('CASH payments cannot specify bank_account_id');
  for (const key of ['reference_number', 'remarks']) {
    if (req.body[key] !== undefined && (typeof req.body[key] !== 'string' || req.body[key].length > 1000)) throw new ValidationError(`${key} must be a string of at most 1000 characters`);
  }
  const payment = await prisma.$transaction(async tx => {
    const vendor = await tx.vendor.findUnique({ where: { vendor_id: vendorId } });
    if (!vendor || !vendor.is_active) throw new ValidationError('Vendor does not exist or is inactive');
    assertCompanyAccess(req, vendor.company_id);
    await tx.$queryRaw`SELECT "accounts_payable_id" FROM "public"."accounts_payable" WHERE "accounts_payable_id" = ${payableId} FOR UPDATE`;
    const payable = await tx.accounts_payable.findUnique({ where: { accounts_payable_id: payableId } });
    if (!payable || payable.vendor_id !== vendorId) throw new ValidationError('AP must exist and belong to the payment vendor');
    if (['PAID', 'CANCELLED'].includes(payable.status)) throw new ApiError(409, 'Cannot create a payment against terminal AP');
    if (bankId) {
      const bank = await tx.bank_account.findUnique({ where: { bank_account_id: bankId } });
      if (!bank || !bank.is_active || bank.company_id !== vendor.company_id) throw new ValidationError('Bank account must be active and belong to the vendor company');
    }
    const created = await tx.payment.create({ data: { created_by: req.user.user_id, created_at: new Date(), vendor_id: vendorId, bank_account_id: bankId,
      payment_type: 'VENDOR_PAYMENT', mode: req.body.mode, amount: amount.toString(), payment_date: paymentDate,
      reference_number: req.body.reference_number, remarks: req.body.remarks } });
    await audit(tx, req.user.user_id, 'PAYMENT_CREATED', 'payment', created.payment_id, undefined,
      { ...created, intended_accounts_payable_id: payableId });
    return created;
  });
  res.status(201).json({ success: true, data: financeJson(payment) });
}

async function allocate(req, res) {
  const paymentId = financeId(req.params.id, 'payment_id');
  if (!Array.isArray(req.body.allocations) || !req.body.allocations.length || req.body.allocations.length > 100) throw new ValidationError('allocations must contain 1 to 100 rows');
  const rows = req.body.allocations.map(row => ({ id: financeId(row?.accounts_payable_id, 'accounts_payable_id'), amount: positiveMoney(row?.allocated_amount, 'allocated_amount') }));
  if (new Set(rows.map(row => row.id.toString())).size !== rows.length) throw new ValidationError('Duplicate AP in one allocation request');
  rows.sort((a, b) => a.id < b.id ? -1 : 1);
  const total = rows.reduce((sum, row) => sum.plus(row.amount), new Money(0));
  const data = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "payment_id" FROM "public"."payment" WHERE "payment_id" = ${paymentId} FOR UPDATE`;
    const payment = await tx.payment.findUnique({ where: { payment_id: paymentId }, include: { vendor: { select: { company_id: true } } } });
    if (!payment) throw new NotFoundError('payment');
    if (payment.payment_type !== 'VENDOR_PAYMENT' || payment.status === 'REVERSED' || !payment.vendor) throw new ApiError(409, 'Payment cannot be allocated');
    assertCompanyAccess(req, payment.vendor.company_id);
    const allocated = await tx.payment_allocation.aggregate({ where: { payment_id: paymentId, reversed_at: null }, _sum: { allocated_amount: true } });
    const available = new Money(payment.amount.toString()).minus(allocated._sum.allocated_amount?.toString() || '0');
    if (total.gt(available)) throw new ApiError(409, 'Allocation exceeds available payment balance');
    const created = [];
    for (const row of rows) {
      await tx.$queryRaw`SELECT "accounts_payable_id" FROM "public"."accounts_payable" WHERE "accounts_payable_id" = ${row.id} FOR UPDATE`;
      const ap = await tx.accounts_payable.findUnique({ where: { accounts_payable_id: row.id } });
      if (!ap || ap.vendor_id !== payment.vendor_id) throw new ValidationError('AP must exist and belong to the payment vendor');
      if (['PAID', 'CANCELLED'].includes(ap.status)) throw new ApiError(409, 'Terminal AP cannot receive allocations');
      const sum = await tx.payment_allocation.aggregate({ where: { accounts_payable_id: row.id, reversed_at: null }, _sum: { allocated_amount: true } });
      const paid = new Money(sum._sum.allocated_amount?.toString() || '0');
      if (!paid.eq(ap.paid_amount.toString())) throw new ApiError(409, 'AP paid amount does not match its allocations; reconcile legacy balances first');
      if (row.amount.gt(new Money(ap.invoice_amount.toString()).minus(paid))) throw new ApiError(409, 'Allocation exceeds AP outstanding balance');
      const allocation = await tx.payment_allocation.create({ data: { created_by: req.user.user_id, payment_id: paymentId, accounts_payable_id: row.id, allocated_amount: row.amount.toString() } });
      await tx.accounts_payable.update({ where: { accounts_payable_id: row.id }, data: { paid_amount: paid.plus(row.amount).toString() } });
      await recalculatePayable(tx, row.id);
      await postAllocation(tx, payment, allocation, req.user.user_id);
      await audit(tx, req.user.user_id, 'PAYMENT_ALLOCATED', 'payment_allocation', allocation.payment_allocation_id, undefined, allocation);
      created.push(allocation);
    }
    return { allocations: created, unallocated_amount: available.minus(total).toString() };
  });
  res.status(201).json({ success: true, data: financeJson(data) });
}

module.exports = { create, allocate };
