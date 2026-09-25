const prisma = require('../lib/prisma');
const { ValidationError, ApiError, NotFoundError } = require('../lib/errors');
const { financeId, positiveMoney, financeDate, assertCompanyAccess, audit, financeJson } = require('../lib/finance');
const { Money } = require('../lib/accountsPayable');
const { recalculateReceivable } = require('../lib/accountsReceivable');
const { postCustomerAllocation } = require('../lib/accounting');

const MODES = ['BANK', 'CASH', 'CHEQUE', 'UPI', 'NEFT', 'RTGS', 'IMPS', 'OTHER'];

async function create(req, res) {
  const customerId = financeId(req.body.customer_id, 'customer_id');
  const amount = positiveMoney(req.body.amount);
  if (!MODES.includes(req.body.mode)) throw new ValidationError(`mode must be one of ${MODES.join(', ')}`);
  if (req.body.payment_type !== 'CUSTOMER_RECEIPT') throw new ValidationError('payment_type must be CUSTOMER_RECEIPT for this endpoint');
  if (req.body.vendor_id !== undefined) throw new ValidationError('Customer receipts cannot specify vendor_id');
  if (req.body.accounts_receivable_id !== undefined || req.body.sales_invoice_id !== undefined) throw new ValidationError('Use payment allocations to settle receivables');
  const paymentDate = financeDate(req.body.payment_date, 'payment_date');
  const bankId = req.body.mode === 'CASH' ? null : financeId(req.body.bank_account_id, 'bank_account_id');
  if (req.body.mode === 'CASH' && req.body.bank_account_id != null) throw new ValidationError('CASH receipts cannot specify bank_account_id');
  for (const key of ['reference_number', 'remarks']) {
    if (req.body[key] !== undefined && (typeof req.body[key] !== 'string' || req.body[key].length > 1000)) throw new ValidationError(`${key} must be a string of at most 1000 characters`);
  }
  const payment = await prisma.$transaction(async tx => {
    const customer = await tx.customer.findUnique({ where: { customer_id: customerId } });
    if (!customer?.is_active) throw new ValidationError('Customer does not exist or is inactive');
    assertCompanyAccess(req, customer.company_id);
    if (bankId) {
      const bank = await tx.bank_account.findUnique({ where: { bank_account_id: bankId } });
      if (!bank?.is_active || bank.company_id !== customer.company_id) throw new ValidationError('Bank account must be active and belong to the customer company');
    }
    const created = await tx.payment.create({ data: { created_by: req.user.user_id, created_at: new Date(), customer_id: customerId, bank_account_id: bankId,
      payment_type: 'CUSTOMER_RECEIPT', mode: req.body.mode, amount: amount.toString(), payment_date: paymentDate,
      reference_number: req.body.reference_number?.trim() || undefined, remarks: req.body.remarks?.trim() || undefined } });
    await audit(tx, req.user.user_id, 'CUSTOMER_PAYMENT_CREATED', 'payment', created.payment_id, undefined, created);
    return created;
  });
  res.status(201).json({ success: true, data: financeJson(payment) });
}

async function allocate(req, res) {
  const paymentId = financeId(req.params.id, 'payment_id');
  if (!Array.isArray(req.body.allocations) || !req.body.allocations.length || req.body.allocations.length > 100) throw new ValidationError('allocations must contain 1 to 100 rows');
  const rows = req.body.allocations.map(row => {
    if (row?.accounts_payable_id !== undefined) throw new ValidationError('Customer receipts can allocate only to accounts receivable');
    return { id: financeId(row?.accounts_receivable_id, 'accounts_receivable_id'), amount: positiveMoney(row?.allocated_amount, 'allocated_amount') };
  });
  if (new Set(rows.map(row => row.id.toString())).size !== rows.length) throw new ValidationError('Duplicate AR in one allocation request');
  rows.sort((a, b) => a.id < b.id ? -1 : 1);
  const total = rows.reduce((sum, row) => sum.plus(row.amount), new Money(0));
  const data = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "payment_id" FROM "public"."payment" WHERE "payment_id" = ${paymentId} FOR UPDATE`;
    const payment = await tx.payment.findUnique({ where: { payment_id: paymentId }, include: { customer: { select: { company_id: true } } } });
    if (!payment) throw new NotFoundError('payment');
    if (payment.payment_type !== 'CUSTOMER_RECEIPT' || payment.status === 'REVERSED' || !payment.customer || payment.vendor_id !== null) throw new ApiError(409, 'Payment cannot be allocated to receivables');
    assertCompanyAccess(req, payment.customer.company_id);
    const allocated = await tx.payment_allocation.aggregate({ where: { payment_id: paymentId, reversed_at: null }, _sum: { allocated_amount: true } });
    const available = new Money(payment.amount.toString()).minus(allocated._sum.allocated_amount?.toString() || '0');
    if (total.gt(available)) throw new ApiError(409, 'Allocation exceeds available payment balance');
    const created = [];
    for (const row of rows) {
      await tx.$queryRaw`SELECT "accounts_receivable_id" FROM "public"."accounts_receivable" WHERE "accounts_receivable_id" = ${row.id} FOR UPDATE`;
      const ar = await tx.accounts_receivable.findUnique({ where: { accounts_receivable_id: row.id } });
      if (!ar || ar.customer_id !== payment.customer_id) throw new ValidationError('AR must exist and belong to the payment customer');
      if (['PAID', 'CANCELLED'].includes(ar.status)) throw new ApiError(409, 'Terminal AR cannot receive allocations');
      const sum = await tx.payment_allocation.aggregate({ where: { accounts_receivable_id: row.id, reversed_at: null }, _sum: { allocated_amount: true } });
      const received = new Money(sum._sum.allocated_amount?.toString() || '0');
      if (!received.eq(ar.received_amount.toString())) throw new ApiError(409, 'AR received amount does not match its allocations; reconcile legacy balances first');
      if (row.amount.gt(new Money(ar.invoice_amount.toString()).minus(received))) throw new ApiError(409, 'Allocation exceeds AR outstanding balance');
      const allocation = await tx.payment_allocation.create({ data: { created_by: req.user.user_id, payment_id: paymentId, accounts_receivable_id: row.id, allocated_amount: row.amount.toString() } });
      await tx.accounts_receivable.update({ where: { accounts_receivable_id: row.id }, data: { received_amount: received.plus(row.amount).toString() } });
      const recalculated = await recalculateReceivable(tx, row.id);
      if (ar.sales_invoice_id) await tx.sales_invoice.update({ where: { sales_invoice_id: ar.sales_invoice_id }, data: { status: recalculated.status === 'PAID' ? 'PAID' : 'PARTIALLY_PAID' } });
      await postCustomerAllocation(tx, payment, allocation, req.user.user_id);
      await audit(tx, req.user.user_id, 'CUSTOMER_PAYMENT_ALLOCATED', 'payment_allocation', allocation.payment_allocation_id, undefined, allocation);
      created.push(allocation);
    }
    return { allocations: created, unallocated_amount: available.minus(total).toString() };
  });
  res.status(201).json({ success: true, data: financeJson(data) });
}

module.exports = { create, allocate };
