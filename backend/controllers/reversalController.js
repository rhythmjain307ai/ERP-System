const prisma = require('../lib/prisma');
const { Money, recalculatePayable, utcDate } = require('../lib/accountsPayable');
const { financeId, financeDate, assertCompanyAccess, audit, financeJson } = require('../lib/finance');
const { postJournal } = require('../lib/accounting');
const { ApiError, ValidationError, NotFoundError } = require('../lib/errors');

function parameters(req) {
  if (typeof req.body.reason !== 'string' || !req.body.reason.trim() || req.body.reason.length > 1000) throw new ValidationError('A reversal reason of 1 to 1000 characters is required');
  const date = financeDate(req.body.reversal_date, 'reversal_date');
  if (date > utcDate()) throw new ValidationError('Reversal date cannot be in the future');
  return { date, reason: req.body.reason.trim(), userId: req.user.user_id };
}

async function reverseEntry(tx, entryId, p) {
  await tx.$queryRaw`SELECT "accounting_entry_id" FROM "public"."accounting_entry" WHERE "accounting_entry_id" = ${entryId} FOR UPDATE`;
  const entry = await tx.accounting_entry.findUnique({ where: { accounting_entry_id: entryId }, include: { journal_entry: { include: { journal_line: true } } } });
  if (!entry) throw new NotFoundError('accounting entry');
  if (entry.status !== 'POSTED' || entry.reversal_of_id) throw new ApiError(409, 'Entry is already reversed or is itself a reversal');
  if (p.date < entry.entry_date) throw new ValidationError('Reversal date cannot precede the original entry');
  if (entry.journal_entry.length !== 1 || entry.journal_entry[0].status !== 'POSTED') throw new ApiError(409, 'Source journal is not eligible for reversal');
  const original = entry.journal_entry[0];
  const result = await postJournal(tx, { companyId: entry.company_id, sourceType: 'REVERSAL', sourceId: entryId, date: p.date, userId: p.userId,
    description: p.reason, reversalOf: entryId, journalReversalOf: original.journal_entry_id,
    lines: original.journal_line.map(line => ({ accountId: line.account_id, debit: line.credit_amount, credit: line.debit_amount })) });
  await tx.journal_entry.update({ where: { journal_entry_id: original.journal_entry_id }, data: { status: 'REVERSED' } });
  await tx.accounting_entry.update({ where: { accounting_entry_id: entryId }, data: { status: 'REVERSED' } });
  await audit(tx, p.userId, 'JOURNAL_REVERSED', 'journal_entry', original.journal_entry_id, original, { reversal_journal_id: result.journal.journal_entry_id, reason: p.reason, reversal_date: p.date });
  return result;
}

async function invoice(req, res) {
  const id = financeId(req.params.id, 'vendor_invoice_id'), p = parameters(req);
  const data = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "vendor_invoice_id" FROM "public"."vendor_invoice" WHERE "vendor_invoice_id" = ${id} FOR UPDATE`;
    const invoice = await tx.vendor_invoice.findUnique({ where: { vendor_invoice_id: id }, include: { vendor: { select: { company_id: true } } } });
    if (!invoice) throw new NotFoundError('vendor invoice');
    assertCompanyAccess(req, invoice.vendor.company_id);
    if (invoice.status !== 'BOOKED' || invoice.reversed_at) throw new ApiError(409, 'Only an unreversed BOOKED invoice can be reversed');
    const ap = await tx.accounts_payable.findUnique({ where: { vendor_invoice_id: id } });
    if (!ap) throw new ApiError(409, 'Legacy invoice has no AP; reconciliation is required');
    await tx.$queryRaw`SELECT "accounts_payable_id" FROM "public"."accounts_payable" WHERE "accounts_payable_id" = ${ap.accounts_payable_id} FOR UPDATE`;
    const current = await tx.accounts_payable.findUnique({ where: { accounts_payable_id: ap.accounts_payable_id } });
    if (!current.paid_amount.isZero() || await tx.payment_allocation.count({ where: { accounts_payable_id: ap.accounts_payable_id, reversed_at: null } })) throw new ApiError(409, 'Reverse active payments before reversing the invoice');
    const entry = await tx.accounting_entry.findFirst({ where: { source_type: 'VENDOR_INVOICE', source_id: id } });
    if (!entry) throw new ApiError(409, 'Legacy invoice has no journal; reconciliation is required');
    const reversal = await reverseEntry(tx, entry.accounting_entry_id, p);
    const updated = await tx.vendor_invoice.update({ where: { vendor_invoice_id: id }, data: { reversed_at: new Date(), reversed_by: p.userId, reversal_reason: p.reason } });
    await tx.accounts_payable.update({ where: { accounts_payable_id: ap.accounts_payable_id }, data: { status: 'CANCELLED', outstanding_amount: 0 } });
    await audit(tx, p.userId, 'INVOICE_REVERSED', 'vendor_invoice', id, invoice, updated);
    return { invoice: updated, reversal };
  });
  res.json({ success: true, data: financeJson(data) });
}

async function payment(req, res) {
  const id = financeId(req.params.id, 'payment_id'), p = parameters(req);
  const data = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "payment_id" FROM "public"."payment" WHERE "payment_id" = ${id} FOR UPDATE`;
    const payment = await tx.payment.findUnique({ where: { payment_id: id }, include: { vendor: { select: { company_id: true } } } });
    if (!payment) throw new NotFoundError('payment');
    if (payment.status !== 'CREATED' || payment.payment_type !== 'VENDOR_PAYMENT') throw new ApiError(409, 'Payment cannot be reversed');
    if (!payment.vendor) throw new ApiError(409, 'Payment vendor is missing');
    assertCompanyAccess(req, payment.vendor.company_id);
    if (p.date < payment.payment_date) throw new ValidationError('Reversal date cannot precede payment date');
    if (await tx.bank_transaction.count({ where: { payment_id: id } })) throw new ApiError(409, 'Unmatch the bank transaction before reversing the payment');
    const allocations = await tx.payment_allocation.findMany({ where: { payment_id: id, reversed_at: null }, orderBy: { accounts_payable_id: 'asc' } });
    const apIds = [...new Set(allocations.map(a => a.accounts_payable_id?.toString()))];
    if (apIds.includes(undefined)) throw new ApiError(409, 'Vendor payment has an invalid allocation target');
    for (const text of apIds) {
      const apId = BigInt(text);
      await tx.$queryRaw`SELECT "accounts_payable_id" FROM "public"."accounts_payable" WHERE "accounts_payable_id" = ${apId} FOR UPDATE`;
      const ap = await tx.accounts_payable.findUnique({ where: { accounts_payable_id: apId } });
      const sum = await tx.payment_allocation.aggregate({ where: { accounts_payable_id: apId, reversed_at: null }, _sum: { allocated_amount: true } });
      if (ap.status === 'CANCELLED' || !new Money(ap.paid_amount.toString()).eq(sum._sum.allocated_amount?.toString() || '0')) throw new ApiError(409, 'AP balances require reconciliation before reversal');
    }
    for (const allocation of allocations) {
      const entry = await tx.accounting_entry.findFirst({ where: { source_type: 'PAYMENT_ALLOCATION', source_id: allocation.payment_allocation_id } });
      if (!entry) throw new ApiError(409, 'Allocation has no journal; reconciliation is required');
      await reverseEntry(tx, entry.accounting_entry_id, p);
      await tx.payment_allocation.update({ where: { payment_allocation_id: allocation.payment_allocation_id }, data: { reversed_at: new Date(), reversed_by: p.userId, reversal_reason: p.reason } });
      await audit(tx, p.userId, 'ALLOCATION_REVERSED', 'payment_allocation', allocation.payment_allocation_id, allocation, { reason: p.reason, reversal_date: p.date });
    }
    for (const text of apIds) {
      const apId = BigInt(text);
      const remaining = await tx.payment_allocation.aggregate({ where: { accounts_payable_id: apId, reversed_at: null }, _sum: { allocated_amount: true } });
      // Explicit reversal is the only operation permitted to reopen PAID AP.
      await tx.accounts_payable.update({ where: { accounts_payable_id: apId }, data: { paid_amount: remaining._sum.allocated_amount || 0, status: 'OPEN' } });
      await recalculatePayable(tx, apId);
    }
    const updated = await tx.payment.update({ where: { payment_id: id }, data: { status: 'REVERSED', reversed_at: new Date(), reversed_by: p.userId, reversal_reason: p.reason } });
    await audit(tx, p.userId, 'PAYMENT_REVERSED', 'payment', id, payment, updated);
    return updated;
  });
  res.json({ success: true, data: financeJson(data) });
}

async function journal(req, res) {
  const id = financeId(req.params.id, 'journal_entry_id'), p = parameters(req);
  const data = await prisma.$transaction(async tx => {
    const journal = await tx.journal_entry.findUnique({ where: { journal_entry_id: id }, include: { accounting_entry: true } });
    if (!journal) throw new NotFoundError('journal');
    if (!journal.accounting_entry || journal.accounting_entry.source_type !== 'MANUAL') throw new ApiError(409, 'Reverse managed journals through their invoice or payment');
    assertCompanyAccess(req, journal.accounting_entry.company_id);
    return reverseEntry(tx, journal.accounting_entry_id, p);
  });
  res.json({ success: true, data: financeJson(data) });
}
module.exports = { invoice, payment, journal };
