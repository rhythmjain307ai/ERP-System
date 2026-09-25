const { Money } = require('./accountsPayable');
const { NotFoundError } = require('./errors');

function startOfNextDay(date) { const next = new Date(date); next.setUTCDate(next.getUTCDate() + 1); return next; }

async function customerLedger(tx, customerId, from, to) {
  const customer = await tx.customer.findUnique({ where: { customer_id: customerId }, select: { customer_id: true, customer_code: true, customer_name: true, company_id: true } });
  if (!customer) throw new NotFoundError('customer');
  const toExclusive = startOfNextDay(to);
  const invoices = await tx.sales_invoice.findMany({ where: { customer_id: customerId },
    select: { sales_invoice_id: true, invoice_number: true, invoice_date: true, total_amount: true } });
  const allocations = await tx.payment_allocation.findMany({ where: { accounts_receivable: { customer_id: customerId }, payment: { customer_id: customerId, payment_type: 'CUSTOMER_RECEIPT' } },
    select: { payment_allocation_id: true, payment_id: true, accounts_receivable_id: true, allocated_amount: true, allocated_at: true,
      payment: { select: { reference_number: true, amount: true, payment_date: true } }, accounts_receivable: { select: { sales_invoice_id: true } } } });
  const sources = new Map();
  for (const row of invoices) sources.set(`SALES_INVOICE:${row.sales_invoice_id}`, { type: 'SALES_INVOICE', reference: row.invoice_number, sales_invoice_id: row.sales_invoice_id,
    payment_id: null, payment_allocation_id: null, debit: new Money(row.total_amount.toString()), credit: new Money(0) });
  for (const row of allocations) sources.set(`CUSTOMER_PAYMENT_ALLOCATION:${row.payment_allocation_id}`, { type: 'PAYMENT_ALLOCATION', reference: row.payment.reference_number || row.payment_id.toString(),
    sales_invoice_id: row.accounts_receivable.sales_invoice_id, payment_id: row.payment_id, payment_allocation_id: row.payment_allocation_id, payment_amount: row.payment.amount,
    debit: new Money(0), credit: new Money(row.allocated_amount.toString()) });
  const sourceFilter = { OR: [
    { source_type: 'SALES_INVOICE', source_id: { in: invoices.map(row => row.sales_invoice_id) } },
    { source_type: 'CUSTOMER_PAYMENT_ALLOCATION', source_id: { in: allocations.map(row => row.payment_allocation_id) } }
  ] };
  const accounting = await tx.accounting_entry.findMany({ where: { company_id: customer.company_id, status: { in: ['POSTED', 'REVERSED'] }, entry_date: { lt: toExclusive },
    OR: [sourceFilter, { source_type: 'REVERSAL', reversal_of: sourceFilter }] }, include: { reversal_of: true }, orderBy: [{ entry_date: 'asc' }, { accounting_entry_id: 'asc' }] });
  let opening = new Money(0), balance = new Money(0), debits = new Money(0), credits = new Money(0);
  const entries = [];
  for (const entry of accounting) {
    const source = entry.reversal_of || entry, event = sources.get(`${source.source_type}:${source.source_id}`);
    if (!event) continue;
    const debit = entry.reversal_of ? event.credit : event.debit, credit = entry.reversal_of ? event.debit : event.credit;
    balance = balance.plus(debit).minus(credit);
    if (entry.entry_date < from) { opening = balance; continue; }
    debits = debits.plus(debit); credits = credits.plus(credit);
    entries.push({ accounting_entry_id: entry.accounting_entry_id, date: entry.entry_date, type: entry.reversal_of ? 'ADJUSTMENT' : event.type, reference: event.reference,
      reference_id: source.source_id, sales_invoice_id: event.sales_invoice_id, payment_id: event.payment_id, payment_allocation_id: event.payment_allocation_id,
      ...(event.payment_amount ? { payment_amount: event.payment_amount } : {}), description: entry.description,
      debit_amount: debit.toString(), credit_amount: credit.toString(), running_balance: balance.toString() });
  }
  const receipts = await tx.payment.findMany({ where: { customer_id: customerId, payment_type: 'CUSTOMER_RECEIPT', status: 'CREATED', payment_date: { lt: toExclusive } },
    select: { payment_id: true, payment_date: true, reference_number: true, amount: true, payment_allocation: { where: { reversed_at: null, allocated_at: { lt: toExclusive } }, select: { allocated_amount: true } } }, orderBy: [{ payment_date: 'asc' }, { payment_id: 'asc' }] });
  const unallocatedReceipts = receipts.map(payment => {
    const allocated = payment.payment_allocation.reduce((sum, row) => sum.plus(row.allocated_amount.toString()), new Money(0));
    return { payment_id: payment.payment_id, payment_date: payment.payment_date, reference_number: payment.reference_number, amount: payment.amount, unallocated_amount: new Money(payment.amount.toString()).minus(allocated) };
  }).filter(row => row.unallocated_amount.gt(0));
  const unallocatedTotal = unallocatedReceipts.reduce((sum, row) => sum.plus(row.unallocated_amount), new Money(0));
  const ar = await tx.accounts_receivable.aggregate({ where: { customer_id: customerId, status: { not: 'CANCELLED' } }, _sum: { outstanding_amount: true } });
  const currentAr = new Money(ar._sum.outstanding_amount?.toString() || '0');
  return { customer, from, to, opening_balance: opening.toString(), entries, total_debits: debits.toString(), total_credits: credits.toString(), closing_balance: balance.toString(),
    current_ar_outstanding: currentAr.toString(), reconciles_to_current_ar: toExclusive > new Date() ? balance.eq(currentAr) : null,
    unallocated_receipts: unallocatedReceipts.map(row => ({ ...row, amount: row.amount.toString(), unallocated_amount: row.unallocated_amount.toString() })), unallocated_receipts_total: unallocatedTotal.toString(),
    basis: 'Posted sales invoices and customer payment allocations, including dated reversing entries; unallocated receipts are disclosed separately and do not reduce AR.' };
}

module.exports = customerLedger;
