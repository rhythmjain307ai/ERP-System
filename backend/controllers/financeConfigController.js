const prisma = require('../lib/prisma');
const { ACCOUNT_TYPES, validateConfig } = require('../lib/accounting');
const { financeId, audit, financeJson } = require('../lib/finance');
const { ValidationError, NotFoundError } = require('../lib/errors');

async function configure(req, res) {
  const companyId = financeId(req.params.companyId, 'companyId');
  const fields = Object.fromEntries(Object.keys(ACCOUNT_TYPES).map(key => [`${key}_account_id`, financeId(req.body[`${key}_account_id`], `${key}_account_id`)]));
  const data = await prisma.$transaction(async tx => {
    if (!await tx.company.findUnique({ where: { company_id: companyId } })) throw new NotFoundError('company');
    await validateConfig(tx, companyId, fields);
    const old = await tx.company_finance_config.findUnique({ where: { company_id: companyId } });
    const config = await tx.company_finance_config.upsert({ where: { company_id: companyId }, create: { company_id: companyId, ...fields }, update: fields });
    await audit(tx, req.user.user_id, 'FINANCE_CONFIGURED', 'company_finance_config', companyId, old || undefined, config);
    return config;
  });
  res.json({ success: true, data: financeJson(data) });
}
async function mapBank(req, res) {
  const bankId = financeId(req.params.id, 'bank_account_id');
  const accountId = financeId(req.body.gl_account_id, 'gl_account_id');
  const data = await prisma.$transaction(async tx => {
    const bank = await tx.bank_account.findUnique({ where: { bank_account_id: bankId } });
    if (!bank) throw new NotFoundError('bank account');
    const account = await tx.chart_of_account.findUnique({ where: { account_id: accountId } });
    if (!account || !account.is_active || account.account_type !== 'ASSET' || account.company_id !== bank.company_id) throw new ValidationError('Bank GL must be an active ASSET account in the bank company');
    const updated = await tx.bank_account.update({ where: { bank_account_id: bankId }, data: { gl_account_id: accountId } });
    await audit(tx, req.user.user_id, 'BANK_GL_MAPPED', 'bank_account', bankId, bank, updated);
    return updated;
  });
  res.json({ success: true, data: financeJson(data) });
}
module.exports = { configure, mapBank };
