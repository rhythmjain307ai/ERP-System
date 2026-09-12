const { Prisma } = require('@prisma/client');
const { ValidationError } = require('./errors');

function decimal(value, field) {
  if (value === undefined || value === null || value === '') throw new ValidationError(`${field} is required`);
  try {
    const result = new Prisma.Decimal(value);
    if (!result.isFinite()) throw new Error('not finite');
    return result;
  } catch {
    throw new ValidationError(`${field} must be a number`);
  }
}

function calculateNetWeight(grossWeightKg, tareWeightKg) {
  const gross = decimal(grossWeightKg, 'gross_weight_kg');
  const tare = decimal(tareWeightKg, 'tare_weight_kg');
  if (gross.isNegative()) throw new ValidationError('gross_weight_kg must not be negative');
  if (tare.isNegative()) throw new ValidationError('tare_weight_kg must not be negative');
  if (gross.lessThan(tare)) throw new ValidationError('gross_weight_kg must be greater than or equal to tare_weight_kg');
  return gross.minus(tare);
}

module.exports = { calculateNetWeight, decimal };
