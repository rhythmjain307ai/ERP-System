function serialize(value) {
  if (typeof value === 'bigint') return value.toString();
  if (value && typeof value === 'object') {
    if (value.constructor && value.constructor.name === 'Decimal') return value.toString();
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value.map(serialize);
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serialize(item)]));
  }
  return value;
}

module.exports = serialize;