const { randomUUID } = require('crypto');
const { Money } = require('./accountsPayable');
const { ApiError, ValidationError } = require('./errors');
const { audit } = require('./finance');

const ACCOUNT_TYPES = { inventory: 'ASSET', expense: 'EXPENSE', input_cgst: 'ASSET', input_sgst: 'ASSET', input_igst: 'ASSET', input_cess: 'ASSET', payable: 'LIABILITY', cash: 'ASSET', rounding: 'EXPENSE' };
async function validateConfig(tx, companyId, config) {
  const required = Object.entries(ACCOUNT_TYPES).map(([key, type]) => ({ key, type, accountId: config[`${key}_account_id`] }));
  const accountIds = [...new Set(required.map(({ accountId }) => accountId).filter((accountId) => accountId != null))];
  const accounts = await tx.chart_of_account.findMany({ where: { account_id: { in: accountIds } } });
  const accountsById = new Map(accounts.map((account) => [account.account_id.toString(), account]));
  for (const { key, type, accountId } of required) {
    const account = accountId == null ? null : accountsById.get(accountId.toString());
    if (!account || account.company_id !== companyId || !account.is_active || account.account_type !== type) throw new ValidationError(`${key} GL mapping must be an active ${type} account in this company`);
  }
  return config;
}
async function getConfig(tx, companyId) {
  const config = await tx.company_finance_config.findUnique({ where: { company_id: companyId } });
  if (!config) throw new ApiError(409, 'Configure company GL mappings before posting');
  return validateConfig(tx, companyId, config);
}

async function postJournal(tx, { companyId, sourceType, sourceId, date, userId, lines, description, reversalOf, journalReversalOf }) {
  let debit = new Money(0), credit = new Money(0);
  const prepared = [];
  for (const line of lines) {
    const dr = new Money(String(line.debit || 0)), cr = new Money(String(line.credit || 0));
    if (!dr.isFinite() || !cr.isFinite() || dr.lt(0) || cr.lt(0) || dr.decimalPlaces() > 2 || cr.decimalPlaces() > 2 || (dr.gt(0) && cr.gt(0))) throw new ValidationError('Journal lines must contain valid debit or credit amounts');
    if (dr.isZero() && cr.isZero()) continue;
    debit = debit.plus(dr); credit = credit.plus(cr);
    prepared.push({ account_id: line.accountId, debit_amount: dr.toString(), credit_amount: cr.toString() });
  }
  if (!debit.eq(credit)) throw new ValidationError('Journal is not balanced: debits must equal credits');
  const accountIds = [...new Set(prepared.map(({ account_id }) => account_id).filter((accountId) => accountId != null))];
  const accounts = await tx.chart_of_account.findMany({ where: { account_id: { in: accountIds } } });
  const validAccountIds = new Set(accounts.filter((account) => account.company_id === companyId && account.is_active).map((account) => account.account_id.toString()));
  if (accountIds.some((accountId) => !validAccountIds.has(accountId.toString()))) throw new ValidationError('Journal account must be active and belong to the source company');
  const entry = await tx.accounting_entry.create({ data: { company_id: companyId, entry_date: date, source_type: sourceType, source_id: sourceId, description, created_by: userId, reversal_of_id: reversalOf } });
  const journal = await tx.journal_entry.create({ data: { accounting_entry_id: entry.accounting_entry_id, journal_number: `J-${randomUUID()}`, entry_date: date, description, created_by: userId, reversal_of_id: journalReversalOf,
    journal_line: { create: prepared } }, include: { journal_line: true } });
  await audit(tx, userId, 'JOURNAL_POSTED', 'journal_entry', journal.journal_entry_id, undefined, { ...journal, source_type: sourceType, source_id: sourceId });
  return { entry, journal };
}

async function postInvoice(tx, invoice, userId) {
  const vendor = await tx.vendor.findUnique({ where: { vendor_id: invoice.vendor_id } });
  const c = await getConfig(tx, vendor.company_id);
  const items = await tx.vendor_invoice_item.findMany({ where: { vendor_invoice_id: invoice.vendor_invoice_id }, include: { inventory_item: true } });
  let inventory = new Money(0), expense = new Money(invoice.other_charges.toString()), taxable = new Money(0);
  for (const item of items) {
    const amount = new Money(item.taxable_amount.toString());
    taxable = taxable.plus(amount);
    if (item.inventory_item?.is_stock_item) inventory = inventory.plus(amount); else expense = expense.plus(amount);
  }
  if (!taxable.eq(invoice.taxable_amount.toString())) throw new ValidationError('Invoice taxable header does not match its lines');
  const lines = [{ accountId: c.inventory_account_id, debit: inventory }, { accountId: c.expense_account_id, debit: expense }];
  let total = inventory.plus(expense);
  for (const tax of ['cgst', 'sgst', 'igst', 'cess']) {
    const amount = new Money(invoice[`${tax}_amount`].toString());
    total = total.plus(amount);
    lines.push({ accountId: c[`input_${tax}_account_id`], debit: amount });
  }
  const round = new Money(invoice.round_off.toString());
  total = total.plus(round);
  if (!total.eq(invoice.total_amount.toString())) throw new ValidationError('Invoice total does not balance with its tax and charge components');
  lines.push({ accountId: c.rounding_account_id, debit: round.gt(0) ? round : 0, credit: round.lt(0) ? round.negated() : 0 });
  lines.push({ accountId: c.payable_account_id, credit: invoice.total_amount });
  return postJournal(tx, { companyId: vendor.company_id, sourceType: 'VENDOR_INVOICE', sourceId: invoice.vendor_invoice_id, date: invoice.invoice_date, userId, lines, description: `Vendor invoice ${invoice.invoice_number}` });
}

async function postAllocation(tx, payment, allocation, userId) {
  const vendor = await tx.vendor.findUnique({ where: { vendor_id: payment.vendor_id } });
  const c = await getConfig(tx, vendor.company_id);
  let creditAccount = c.cash_account_id;
  if (payment.mode !== 'CASH') {
    const bank = await tx.bank_account.findUnique({ where: { bank_account_id: payment.bank_account_id || 0n }, include: { gl_account: true } });
    if (!bank?.is_active || bank.company_id !== vendor.company_id || !bank.gl_account?.is_active || bank.gl_account.company_id !== vendor.company_id || bank.gl_account.account_type !== 'ASSET') throw new ValidationError('Active bank GL mapping is required');
    creditAccount = bank.gl_account_id;
  }
  return postJournal(tx, { companyId: vendor.company_id, sourceType: 'PAYMENT_ALLOCATION', sourceId: allocation.payment_allocation_id, date: allocation.allocated_at, userId,
    description: `Vendor payment ${payment.payment_id} allocation`, lines: [
      { accountId: c.payable_account_id, debit: allocation.allocated_amount }, { accountId: creditAccount, credit: allocation.allocated_amount }
    ] });
}

module.exports = { ACCOUNT_TYPES, validateConfig, getConfig, postJournal, postInvoice, postAllocation };
