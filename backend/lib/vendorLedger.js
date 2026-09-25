const { Money } = require('./accountsPayable');
const { NotFoundError } = require('./errors');

async function vendorLedger(tx, vendorId, from, to) {
  const vendor = await tx.vendor.findUnique({ where: { vendor_id: vendorId }, select: { vendor_id: true, vendor_name: true, company_id: true } });
  if (!vendor) throw new NotFoundError('vendor');
  const invoices = await tx.vendor_invoice.findMany({ where: { vendor_id: vendorId }, select: { vendor_invoice_id: true, invoice_number: true, total_amount: true } });
  const allocations = await tx.payment_allocation.findMany({ where: { payment: { vendor_id: vendorId } }, select: { payment_allocation_id: true, payment_id: true, allocated_amount: true } });
  const sources = new Map();
  for (const invoice of invoices) sources.set(`VENDOR_INVOICE:${invoice.vendor_invoice_id}`, { type: 'INVOICE', reference: invoice.invoice_number, debit: new Money(0), credit: new Money(invoice.total_amount.toString()) });
  for (const allocation of allocations) sources.set(`PAYMENT_ALLOCATION:${allocation.payment_allocation_id}`, { type: 'PAYMENT', reference: allocation.payment_id.toString(), debit: new Money(allocation.allocated_amount.toString()), credit: new Money(0) });
  const sourceFilter = { OR: [
    { source_type: 'VENDOR_INVOICE', source_id: { in: invoices.map(i => i.vendor_invoice_id) } },
    { source_type: 'PAYMENT_ALLOCATION', source_id: { in: allocations.map(a => a.payment_allocation_id) } }
  ] };
  const entries = await tx.accounting_entry.findMany({ where: { company_id: vendor.company_id, status: { in: ['POSTED', 'REVERSED'] }, entry_date: { lte: to },
    OR: [sourceFilter, { source_type: 'REVERSAL', reversal_of: sourceFilter }] }, include: { reversal_of: true }, orderBy: [{ entry_date: 'asc' }, { accounting_entry_id: 'asc' }] });
  let opening = new Money(0), balance = new Money(0), debits = new Money(0), credits = new Money(0);
  const rows = [];
  for (const entry of entries) {
    const source = entry.reversal_of || entry;
    const event = sources.get(`${source.source_type}:${source.source_id}`);
    const debit = entry.reversal_of ? event.credit : event.debit;
    const credit = entry.reversal_of ? event.debit : event.credit;
    balance = balance.plus(credit).minus(debit);
    if (entry.entry_date < from) { opening = balance; continue; }
    debits = debits.plus(debit); credits = credits.plus(credit);
    rows.push({ accounting_entry_id: entry.accounting_entry_id, date: entry.entry_date, type: entry.reversal_of ? 'ADJUSTMENT' : event.type,
      reference: event.reference, description: entry.description, debit_amount: debit.toString(), credit_amount: credit.toString(), running_balance: balance.toString() });
  }
  return { vendor, from, to, opening_balance: opening.toString(), entries: rows, total_debits: debits.toString(), total_credits: credits.toString(), closing_balance: balance.toString(),
    basis: 'Posted invoices and payment allocations, including dated reversing entries; positive balance is payable to vendor.' };
}
module.exports = vendorLedger;
