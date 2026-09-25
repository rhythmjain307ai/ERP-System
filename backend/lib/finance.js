const { Money, utcDate } = require('./accountsPayable');
const { ValidationError } = require('./errors');
function financeJson(value) {
  if (typeof value === 'bigint') return value.toString();
  if (Money.isDecimal(value)) return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(financeJson);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, financeJson(item)]));
  return value;
}

function financeId(value, field) {
  const text = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value;
  if (typeof text !== 'string' || !/^[1-9]\d*$/.test(text) || BigInt(text) > 9223372036854775807n) throw new ValidationError(`${field} must be a positive bigint ID`);
  return BigInt(text);
}

function positiveMoney(value, field = 'amount') {
  if (!['string', 'number'].includes(typeof value) || !/^\d+(\.\d{1,2})?$/.test(String(value))) throw new ValidationError(`${field} must be a positive amount with at most two decimals`);
  const amount = new Money(String(value));
  if (!amount.isFinite() || amount.lte(0) || amount.gt('99999999999999.99')) throw new ValidationError(`${field} is outside the supported positive amount range`);
  return amount;
}

function financeDate(value, field) {
  if (value === undefined) return utcDate();
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ValidationError(`${field} must be YYYY-MM-DD`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new ValidationError(`${field} is not a valid date`);
  return date;
}

async function audit(tx, userId, action, table, recordId, oldValues, newValues) {
  return tx.audit_log.create({ data: { user_id: userId, action, table_name: table, record_id: recordId,
    ...(oldValues === undefined ? {} : { old_values: financeJson(oldValues) }),
    ...(newValues === undefined ? {} : { new_values: financeJson(newValues) }) } });
}

module.exports = { financeId, positiveMoney, financeDate, audit, financeJson };
