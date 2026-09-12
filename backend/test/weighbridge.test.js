const test = require('node:test');
const assert = require('node:assert/strict');
const { ValidationError } = require('../lib/errors');
const { calculateNetWeight } = require('../lib/weighbridge');

test('calculates net weight from gross and tare weight', () => {
  assert.equal(calculateNetWeight('1000', '200').toString(), '800');
});

test('calculates zero net weight when gross equals tare', () => {
  assert.equal(calculateNetWeight('200', '200').toString(), '0');
});

test('rejects gross weight below tare weight', () => {
  assert.throws(() => calculateNetWeight('200', '1000'), (error) => {
    assert.ok(error instanceof ValidationError);
    assert.match(error.message, /greater than or equal to tare_weight_kg/);
    return true;
  });
});
