const prisma = require('../lib/prisma');
const customerLedger = require('../lib/customerLedger');
const { financeId, financeDate, assertCompanyAccess, financeJson } = require('../lib/finance');
const { ValidationError } = require('../lib/errors');

function range(query) {
  const from = financeDate(query.from === undefined ? '1970-01-01' : query.from, 'from');
  const to = financeDate(query.to, 'to');
  if (from > to) throw new ValidationError('from cannot be after to');
  return { from, to };
}

async function get(req, res) {
  const customerId = financeId(req.params.customerId, 'customerId'), { from, to } = range(req.query);
  const customer = await prisma.customer.findUnique({ where: { customer_id: customerId }, select: { company_id: true } });
  if (customer) assertCompanyAccess(req, customer.company_id);
  const data = await prisma.$transaction(tx => customerLedger(tx, customerId, from, to), { isolationLevel: 'RepeatableRead' });
  res.json({ success: true, data: financeJson(data) });
}

module.exports = { get, range };
