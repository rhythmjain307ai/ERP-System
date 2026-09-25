const prisma = require('../lib/prisma');
const vendorLedger = require('../lib/vendorLedger');
const { financeId, financeDate, assertCompanyAccess, financeJson } = require('../lib/finance');
const { ValidationError } = require('../lib/errors');
function range(query) {
  const from = financeDate(query.from === undefined ? '1970-01-01' : query.from, 'from');
  const to = financeDate(query.to, 'to');
  if (from > to) throw new ValidationError('from cannot be after to');
  return { from, to };
}
async function get(req, res) {
  const id = financeId(req.params.vendorId, 'vendorId');
  const { from, to } = range(req.query);
  const vendor = await prisma.vendor.findUnique({ where: { vendor_id: id }, select: { company_id: true } });
  if (vendor) assertCompanyAccess(req, vendor.company_id);
  const data = await prisma.$transaction(tx => vendorLedger(tx, id, from, to), { isolationLevel: 'RepeatableRead' });
  res.json({ success: true, data: financeJson(data) });
}
module.exports = { get, range };
