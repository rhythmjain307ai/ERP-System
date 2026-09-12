const { ValidationError } = require('../lib/errors');

function bodyValidator(validate) {
  return (req, res, next) => {
    try {
      req.body = validate(req.body || {});
      next();
    } catch (error) {
      next(error instanceof ValidationError ? error : new ValidationError(error.message));
    }
  };
}

function required(body, fields) {
  const missing = fields.filter((field) => body[field] === undefined || body[field] === null || body[field] === '');
  if (missing.length) throw new ValidationError('Required fields are missing', { fields: missing });
}

function lineItems(body, field = 'items') {
  if (!Array.isArray(body[field]) || body[field].length === 0) {
    throw new ValidationError(`${field} must contain at least one line item`);
  }
  body[field].forEach((item, index) => {
    if (!item || item.inventory_item_id === undefined) {
      throw new ValidationError(`Invalid ${field}[${index}]`, { fields: [`${field}[${index}].inventory_item_id`] });
    }
    if (!item.uom) throw new ValidationError(`Invalid ${field}[${index}]`, { fields: [`${field}[${index}].uom`] });
    const quantity = item.quantity ?? item.requested_quantity ?? item.ordered_quantity ?? item.received_quantity ?? item.delivered_quantity;
    if (quantity === undefined || Number(quantity) <= 0) {
      throw new ValidationError(`Invalid ${field}[${index}]`, { fields: [`${field}[${index}].quantity must be greater than zero`] });
    }
  });
  return body;
}

module.exports = { bodyValidator, required, lineItems };