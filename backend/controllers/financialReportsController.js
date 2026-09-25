const prisma = require('../lib/prisma');
const { Money, calculatePayable, utcDate } = require('../lib/accountsPayable');
const { financeId, assertCompanyAccess, financeJson } = require('../lib/finance');
const { range } = require('./vendorLedgerController');
const { NotFoundError, ValidationError } = require('../lib/errors');

const posted = { in: ['POSTED', 'REVERSED'] };
const sum = (rows, key) => rows.reduce((total, row) => total.plus(row[key].toString()), new Money(0));
function report(build, current = false) {
  return async (req, res) => {
    const companyId = financeId(req.query.company_id, 'company_id');
    assertCompanyAccess(req, companyId);
    if (current && ['from', 'to', 'as_of'].some(key => req.query[key] !== undefined)) throw new ValidationError('This report uses current AP balances; date filters are not supported');
    const dates = current ? {} : range(req.query);
    const data = await prisma.$transaction(async tx => {
      if (!await tx.company.findUnique({ where: { company_id: companyId } })) throw new NotFoundError('company');
      return build(tx, companyId, dates, req.query);
    }, { isolationLevel: 'RepeatableRead' });
    res.json({ success: true, data: financeJson(data) });
  };
}

const outstanding = report(async (tx, companyId) => {
  const rows = await tx.accounts_payable.findMany({ where: { vendor: { company_id: companyId }, status: { not: 'CANCELLED' } }, include: { vendor: { select: { vendor_name: true } } }, orderBy: { vendor_id: 'asc' } });
  const vendors = new Map(), now = new Date();
  for (const row of rows) {
    const payable = calculatePayable(row, now);
    if (payable.outstanding_amount.isZero()) continue;
    const key = String(row.vendor_id);
    const entry = vendors.get(key) || { vendor_id: row.vendor_id, vendor_name: row.vendor.vendor_name, invoice_amount: new Money(0), paid_amount: new Money(0), outstanding_amount: new Money(0), overdue_amount: new Money(0), count: 0 };
    for (const field of ['invoice_amount', 'paid_amount', 'outstanding_amount']) entry[field] = entry[field].plus(payable[field]);
    if (payable.status === 'OVERDUE') entry.overdue_amount = entry.overdue_amount.plus(payable.outstanding_amount);
    entry.count++; vendors.set(key, entry);
  }
  const entries = [...vendors.values()];
  return { company_id: companyId, as_of: utcDate(now), entries, total_outstanding: sum(entries, 'outstanding_amount'), basis: 'Current unsettled AP only; excludes cancelled and fully paid AP.' };
}, true);

const registerFields = ['taxable_amount', 'cgst_amount', 'sgst_amount', 'igst_amount', 'cess_amount', 'discount_amount', 'other_charges', 'round_off', 'total_amount'];
async function purchaseRegister(tx, companyId, { from, to }) {
  const entries = await tx.accounting_entry.findMany({ where: {
    company_id: companyId, status: posted, entry_date: { gte: from, lte: to },
    OR: [{ source_type: 'VENDOR_INVOICE' }, { source_type: 'REVERSAL', reversal_of: { source_type: 'VENDOR_INVOICE' } }]
  }, include: { reversal_of: true }, orderBy: [{ entry_date: 'asc' }, { accounting_entry_id: 'asc' }] });
  const invoices = await tx.vendor_invoice.findMany({ where: { vendor: { company_id: companyId },
    vendor_invoice_id: { in: entries.map(e => (e.reversal_of || e).source_id).filter(id => id != null) } }, include: { vendor: { select: { vendor_name: true } } } });
  const byId = new Map(invoices.map(i => [String(i.vendor_invoice_id), i]));
  const rows = entries.map(entry => {
    const invoice = byId.get(String((entry.reversal_of || entry).source_id));
    if (!invoice) throw new ValidationError('Posted invoice source is missing from this company');
    return { accounting_entry_id: entry.accounting_entry_id, date: entry.entry_date, type: entry.reversal_of ? 'REVERSAL' : 'INVOICE',
      vendor_invoice_id: invoice.vendor_invoice_id, invoice_number: invoice.invoice_number, invoice_date: invoice.invoice_date,
      vendor_id: invoice.vendor_id, vendor_name: invoice.vendor.vendor_name, supplier_gstin: invoice.supplier_gstin, recipient_gstin: invoice.recipient_gstin, place_of_supply: invoice.place_of_supply,
      ...Object.fromEntries(registerFields.map(field => [field, new Money(invoice[field].toString()).times(entry.reversal_of ? -1 : 1)])) };
  });
  return { company_id: companyId, from, to, entries: rows, totals: Object.fromEntries(registerFields.map(field => [field, sum(rows, field)])),
    basis: 'Posted invoice events and dated reversals. Unposted historical invoices are excluded; GST amounts do not determine tax-credit eligibility.' };
}
const purchases = report(purchaseRegister);
const gst = report(purchaseRegister);

async function journalLines(tx, companyId, to, accountId) {
  return tx.journal_line.findMany({ where: {
    ...(accountId ? { account_id: accountId } : {}), chart_of_account: { company_id: companyId },
    journal_entry: { status: posted, entry_date: { lte: to }, accounting_entry: { company_id: companyId, status: posted } }
  }, include: { chart_of_account: true, journal_entry: { include: { accounting_entry: { include: { reversal_of: true } } } } },
  orderBy: [{ journal_entry: { entry_date: 'asc' } }, { journal_entry_id: 'asc' }, { journal_line_id: 'asc' }] });
}
const trialBalance = report(async (tx, companyId, { from, to }) => {
  const lines = await journalLines(tx, companyId, to);
  const accounts = new Map();
  for (const line of lines) {
    const account = line.chart_of_account;
    const row = accounts.get(String(line.account_id)) || { account_id: line.account_id, account_code: account.account_code, account_name: account.account_name, account_type: account.account_type,
      opening_balance: new Money(0), debits: new Money(0), credits: new Money(0) };
    if (line.journal_entry.entry_date < from) row.opening_balance = row.opening_balance.plus(line.debit_amount.toString()).minus(line.credit_amount.toString());
    else { row.debits = row.debits.plus(line.debit_amount.toString()); row.credits = row.credits.plus(line.credit_amount.toString()); }
    accounts.set(String(line.account_id), row);
  }
  const entries = [...accounts.values()].sort((a, b) => a.account_code.localeCompare(b.account_code)).map(row => {
    const closing = row.opening_balance.plus(row.debits).minus(row.credits);
    return { ...row, closing_balance: closing, closing_debit: Money.max(closing, 0), closing_credit: Money.max(closing.negated(), 0) };
  });
  const totals = Object.fromEntries(['opening_balance', 'debits', 'credits', 'closing_debit', 'closing_credit'].map(field => [field, sum(entries, field)]));
  return { company_id: companyId, from, to, entries, totals, balanced: totals.debits.eq(totals.credits) && totals.closing_debit.eq(totals.closing_credit), balance_convention: 'Debit positive, credit negative.' };
});
const generalLedger = report(async (tx, companyId, { from, to }, query) => {
  const accountId = query.account_id === undefined ? undefined : financeId(query.account_id, 'account_id');
  if (accountId && !await tx.chart_of_account.findFirst({ where: { account_id: accountId, company_id: companyId } })) throw new NotFoundError('company account');
  const lines = await journalLines(tx, companyId, to, accountId);
  const accounts = new Map();
  for (const line of lines) {
    const account = line.chart_of_account;
    const row = accounts.get(String(line.account_id)) || { account_id: line.account_id, account_code: account.account_code, account_name: account.account_name, opening_balance: new Money(0), closing_balance: new Money(0), entries: [] };
    row.closing_balance = row.closing_balance.plus(line.debit_amount.toString()).minus(line.credit_amount.toString());
    if (line.journal_entry.entry_date < from) row.opening_balance = row.closing_balance;
    else row.entries.push({ journal_line_id: line.journal_line_id, journal_entry_id: line.journal_entry_id, date: line.journal_entry.entry_date,
      source_type: line.journal_entry.accounting_entry.source_type, source_id: line.journal_entry.accounting_entry.source_id,
      description: line.description || line.journal_entry.description, debit_amount: line.debit_amount, credit_amount: line.credit_amount, running_balance: row.closing_balance });
    accounts.set(String(line.account_id), row);
  }
  return { company_id: companyId, from, to, accounts: [...accounts.values()].sort((a, b) => a.account_code.localeCompare(b.account_code)), balance_convention: 'Debit positive, credit negative.' };
});
const cashFlow = report(async (tx, companyId, { from, to }) => {
  const lines = await journalLines(tx, companyId, to);
  const rows = [];
  for (const line of lines) {
    const entry = line.journal_entry.accounting_entry, source = entry.reversal_of || entry;
    if (line.journal_entry.entry_date < from || source.source_type !== 'PAYMENT_ALLOCATION') continue;
    // Allocation journals credit cash/bank assets; their reversals debit the same historical account.
    if (line.chart_of_account.account_type !== 'ASSET') continue;
    rows.push({ date: line.journal_entry.entry_date, journal_entry_id: line.journal_entry_id, account_id: line.account_id,
      type: entry.reversal_of ? 'REVERSAL' : 'PAYMENT_ALLOCATION', payment_allocation_id: source.source_id,
      inflow: line.debit_amount, outflow: line.credit_amount });
  }
  const inflow = sum(rows, 'inflow'), outflow = sum(rows, 'outflow');
  return { company_id: companyId, from, to, entries: rows, total_inflow: inflow, total_outflow: outflow, net_cash_flow: inflow.minus(outflow),
    basis: 'Procurement cash impact of posted payment allocations and reversals only. Unallocated payments have no journal and are excluded.' };
});
module.exports = { outstanding, purchases, gst, trialBalance, generalLedger, cashFlow };
