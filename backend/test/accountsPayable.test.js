const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const setupIntegration = require('./setup');
const prisma = require('../lib/prisma');
const app = require('../app');
const { createAuthToken } = require('../middleware/auth');
const { AP_STATUSES, calculatePayable, recalculatePayable, agingBucket } = require('../lib/accountsPayable');

const NOW = new Date('2026-09-24T12:00:00Z');
const integration = Boolean(process.env.TEST_DATABASE_URL);
const root = '/api/procurement/accounts-payable';
let context;

function due(daysOverdue) { return new Date(Date.UTC(2026, 8, 24 - daysOverdue)); }
function payable(overrides = {}) {
  return { invoice_amount: '100.00', paid_amount: '0.00', outstanding_amount: '999.00',
    due_date: due(-1), status: 'OPEN', ...overrides };
}
function calculate(overrides = {}) { return calculatePayable(payable(overrides), NOW); }

test('OPEN recalculates outstanding without mutating input', () => {
  const input = payable();
  const result = calculatePayable(input, NOW);
  assert.equal(result.status, 'OPEN');
  assert.equal(result.outstanding_amount.toFixed(2), '100.00');
  assert.equal(result.days_overdue, 0);
  assert.equal(input.outstanding_amount, '999.00');
});

test('partial payment recalculates the balance and status', () => {
  const result = calculate({ paid_amount: '25.15' });
  assert.equal(result.status, 'PARTIALLY_PAID');
  assert.equal(result.outstanding_amount.toFixed(2), '74.85');
});

for (const status of ['OPEN', 'PARTIALLY_PAID', 'OVERDUE']) {
  test(`full settlement from ${status} becomes PAID even after the due date`, () => {
    const result = calculate({ status, paid_amount: '100', due_date: due(10) });
    assert.equal(result.status, 'PAID');
    assert.equal(result.outstanding_amount.toFixed(2), '0.00');
    assert.equal(result.days_overdue, 0);
  });
}

for (const [status, paid] of [['OPEN', '0'], ['PARTIALLY_PAID', '25'], ['OVERDUE', '50']]) {
  test(`${status} with ${paid} paid is OVERDUE when outstanding is past due`, () => {
    const result = calculate({ status, paid_amount: paid, due_date: due(1) });
    assert.equal(result.status, 'OVERDUE');
    assert.equal(result.days_overdue, 1);
  });
}

test('due today, future, and missing due dates do not become overdue', () => {
  for (const dueDate of [due(0), due(-1), null]) {
    assert.equal(calculate({ due_date: dueDate }).status, 'OPEN');
    assert.equal(calculate({ due_date: dueDate, paid_amount: '1' }).status, 'PARTIALLY_PAID');
  }
});

test('overdue detection uses UTC calendar boundaries', () => {
  const row = payable({ due_date: due(0) });
  assert.equal(calculatePayable(row, new Date('2026-09-24T23:59:59.999Z')).status, 'OPEN');
  const result = calculatePayable(row, new Date('2026-09-25T00:00:00Z'));
  assert.equal(result.status, 'OVERDUE');
  assert.equal(result.days_overdue, 1);
});

test('PAID remains terminal and inconsistent paid balances cannot reopen', () => {
  assert.equal(calculate({ status: 'PAID', paid_amount: '100' }).status, 'PAID');
  assert.throws(() => calculate({ status: 'PAID', paid_amount: '99' }), { status: 409 });
});

test('CANCELLED balances remain unchanged and are excluded from aging', () => {
  const result = calculate({ status: 'CANCELLED', outstanding_amount: '45', due_date: due(10) });
  assert.equal(result.status, 'CANCELLED');
  assert.equal(result.outstanding_amount.toFixed(2), '45.00');
  assert.equal(agingBucket(result), null);
});

test('zero value AP stays OPEN and has no aging exposure', () => {
  const result = calculate({ invoice_amount: '0', due_date: due(100) });
  assert.equal(result.status, 'OPEN');
  assert.equal(result.outstanding_amount.toFixed(2), '0.00');
  assert.equal(agingBucket(result), null);
});

test('Decimal calculations preserve cents near the schema maximum', () => {
  const result = calculate({ invoice_amount: '99999999999999.99', paid_amount: '99999999999999.98' });
  assert.equal(result.outstanding_amount.toFixed(2), '0.01');
  assert.equal(result.status, 'PARTIALLY_PAID');
});

test('invalid balances, status, and dates are rejected', () => {
  for (const values of [
    { invoice_amount: '-1' }, { paid_amount: '-1' }, { paid_amount: '101' },
    { invoice_amount: 'NaN' }, { paid_amount: 'Infinity' }, { paid_amount: '0.001' },
    { invoice_amount: null }, { status: 'UNKNOWN' }, { due_date: new Date('invalid') }
  ]) assert.throws(() => calculate(values), { status: 400 });
  assert.throws(() => calculatePayable(payable(), new Date('invalid')), { status: 400 });
});

test('aging boundaries assign every outstanding amount to exactly one bucket', () => {
  for (const [days, bucket] of [[-1, 'current'], [0, 'current'], [1, 'days_1_30'], [30, 'days_1_30'],
    [31, 'days_31_60'], [60, 'days_31_60'], [61, 'days_61_90'], [90, 'days_61_90'], [91, 'days_91_plus']]) {
    assert.equal(agingBucket(calculate({ due_date: due(days) })), bucket);
  }
  assert.equal(agingBucket(calculate({ due_date: null })), 'undated');
  assert.equal(agingBucket(calculate({ paid_amount: '100' })), null);
});

test.before(async () => {
  context = await setupIntegration();
  test.mock.timers.enable({ apis: ['Date'], now: NOW });
});
test.afterEach(async () => {
  if (context) await prisma.accounts_payable.deleteMany({ where: { vendor_id: { in: [BigInt(context.vendorId), BigInt(context.otherVendorId)] } } });
});
test.after(async () => {
  test.mock.timers.reset();
  try { if (context) await context.cleanup(); } finally { await prisma.$disconnect(); }
});

async function createPayable(overrides = {}) {
  return prisma.accounts_payable.create({ data: { ...payable({ outstanding_amount: '100' }), vendor_id: BigInt(context.vendorId), ...overrides } });
}
function get(path, query = {}) { return request(app).get(path).set('Authorization', context.auth).query(query); }
async function read(id) { return prisma.accounts_payable.findUnique({ where: { accounts_payable_id: id } }); }
function recalculate(id) { return prisma.$transaction(tx => recalculatePayable(tx, id, NOW)); }

test('AP detail derives current amounts and overdue status without persisting them', { skip: !integration }, async () => {
  const row = await createPayable({ paid_amount: '25.15', outstanding_amount: '100', due_date: due(1) });
  const response = await get(`${root}/${row.accounts_payable_id}`);
  assert.equal(response.status, 200);
  assert.equal(response.body.data.status, 'OVERDUE');
  assert.equal(response.body.data.invoice_amount, '100');
  assert.equal(response.body.data.paid_amount, '25.15');
  assert.equal(response.body.data.outstanding_amount, '74.85');
  assert.equal(response.body.data.days_overdue, 1);
  assert.equal(response.body.data.vendor.vendor_id, context.vendorId);
  assert.deepEqual(await read(row.accounts_payable_id), row);
});

test('AP status filtering, counts and pagination use effective status', { skip: !integration }, async () => {
  const rows = await Promise.all([
    createPayable(), createPayable({ paid_amount: '20' }), createPayable({ paid_amount: '100' }),
    createPayable({ due_date: due(2) }), createPayable({ status: 'CANCELLED' }),
    createPayable({ invoice_amount: '0', outstanding_amount: '0', due_date: due(10) }),
    createPayable({ status: 'OVERDUE', due_date: null }), createPayable({ status: 'PAID', paid_amount: '100', outstanding_amount: '0' }),
    createPayable({ paid_amount: '40', due_date: due(5) })
  ]);
  await createPayable({ vendor_id: BigInt(context.otherVendorId), due_date: due(2) });
  for (const status of AP_STATUSES) {
    const expected = rows.filter(row => calculatePayable(row, NOW).status === status)
      .sort((a, b) => a.accounts_payable_id > b.accounts_payable_id ? -1 : 1);
    const first = await get(root, { vendor_id: context.vendorId, status, pageSize: 1 });
    assert.equal(first.status, 200);
    assert.equal(first.body.meta.total, expected.length);
    assert.equal(first.body.meta.pageCount, expected.length);
    assert.equal(first.body.data[0].accounts_payable_id, expected[0].accounts_payable_id.toString());
    for (let page = 1; page <= expected.length; page++) {
      const response = await get(root, { vendor_id: context.vendorId, status, pageSize: 1, page });
      assert.equal(response.body.data[0].status, status);
      assert.equal(response.body.data[0].accounts_payable_id, expected[page - 1].accounts_payable_id.toString());
    }
  }
});

test('vendor AP lists are isolated and return empty pagination consistently', { skip: !integration }, async () => {
  await createPayable();
  const path = `/api/procurement/vendors/${context.otherVendorId}/accounts-payable`;
  const empty = await get(path);
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.body.data, []);
  assert.equal(empty.body.meta.total, 0);
  const other = await createPayable({ vendor_id: BigInt(context.otherVendorId) });
  const response = await get(path);
  assert.deepEqual(response.body.data.map(row => row.accounts_payable_id), [other.accounts_payable_id.toString()]);
  assert.equal((await get(path, { vendor_id: context.vendorId })).status, 400);
  assert.deepEqual((await get(path, { page: 2, pageSize: 1 })).body.data, []);
});

test('AP endpoints reject invalid IDs, filters, pagination, and historical reports', { skip: !integration }, async () => {
  for (const id of ['0', '-1', '1.5', 'abc', '9223372036854775808']) assert.equal((await get(`${root}/${id}`)).status, 400);
  for (const query of [{ status: 'DRAFT' }, { vendor_id: '-1' }, { page: 0 }, { page: '1.5' }, { pageSize: 101 },
    { pageSize: 'abc' }, { page: 2147483647, pageSize: 100 }, { status: ['OPEN', 'PAID'] }, { as_of: '2020-01-01' }]) {
    assert.equal((await get(root, query)).status, 400);
  }
  assert.equal((await get(`${root}/aging`, { as_of: '2020-01-01' })).status, 400);
  assert.equal((await get(`${root}/999999999`)).status, 404);
  assert.equal((await get('/api/procurement/vendors/999999999/accounts-payable')).status, 404);
  assert.equal((await get('/api/procurement/vendors/bad/accounts-payable')).status, 400);
});

test('all four AP routes require existing authentication and procurement permission', { skip: !integration }, async () => {
  const paths = [root, `${root}/aging`, `${root}/1`, `/api/procurement/vendors/${context.vendorId}/accounts-payable`];
  for (const path of paths) assert.equal((await request(app).get(path)).status, 401);
  const role = await prisma.role.create({ data: { role_name: `ap-no-access-${context.userId}` } });
  let user;
  try {
    user = await prisma.users.create({ data: { username: `ap-no-access-${context.userId}`, password_hash: 'test-only', role_id: role.role_id } });
    for (const path of paths) {
      assert.equal((await request(app).get(path).set('Authorization', `Bearer ${createAuthToken(user.user_id)}`)).status, 403);
    }
  } finally {
    if (user) await prisma.users.delete({ where: { user_id: user.user_id } });
    await prisma.role.delete({ where: { role_id: role.role_id } });
  }
});

test('aging returns exact bucket totals, excludes paid/cancelled, and never writes', { skip: !integration }, async () => {
  for (const days of [-1, 0, 1, 30, 31, 60, 61, 90, 91]) await createPayable({ due_date: due(days), paid_amount: '0.01' });
  await createPayable({ due_date: null, paid_amount: '0.01' });
  await createPayable({ due_date: due(100), paid_amount: '100' });
  await createPayable({ status: 'CANCELLED', due_date: due(100) });
  await createPayable({ invoice_amount: '0', outstanding_amount: '0', due_date: due(100) });
  await createPayable({ vendor_id: BigInt(context.otherVendorId) });
  const where = { vendor_id: BigInt(context.vendorId) };
  const before = await prisma.accounts_payable.findMany({ where, orderBy: { accounts_payable_id: 'asc' } });
  const response = await get(`${root}/aging`, { vendor_id: context.vendorId });
  assert.equal(response.status, 200);
  assert.equal(response.body.data.as_of, '2026-09-24');
  assert.equal(response.body.data.count, 10);
  assert.equal(response.body.data.total_outstanding, '999.9');
  for (const [bucket, count] of Object.entries({ current: 2, days_1_30: 2, days_31_60: 2, days_61_90: 2, days_91_plus: 1, undated: 1 })) {
    assert.equal(response.body.data.buckets[bucket].count, count);
    assert.equal(response.body.data.buckets[bucket].outstanding_amount, count === 2 ? '199.98' : '99.99');
  }
  assert.deepEqual(await prisma.accounts_payable.findMany({ where, orderBy: { accounts_payable_id: 'asc' } }), before);
  const filtered = await get(`${root}/aging`, { vendor_id: context.vendorId, status: 'OVERDUE' });
  assert.equal(filtered.body.data.count, 7);
  assert.equal(filtered.body.data.total_outstanding, '699.93');
});

test('aging batches beyond 500 AP rows without loss or duplication', { skip: !integration }, async () => {
  await prisma.accounts_payable.createMany({ data: Array.from({ length: 501 }, () => ({
    vendor_id: BigInt(context.vendorId), invoice_amount: '0.03', paid_amount: '0.01', outstanding_amount: '0.03', status: 'OPEN', due_date: due(31)
  })) });
  const response = await get(`${root}/aging`, { vendor_id: context.vendorId });
  assert.equal(response.status, 200);
  assert.equal(response.body.data.count, 501);
  assert.equal(response.body.data.total_outstanding, '10.02');
  assert.equal(response.body.data.buckets.days_31_60.count, 501);
});

test('empty aging reports return all buckets with zero totals', { skip: !integration }, async () => {
  const response = await get(`${root}/aging`, { vendor_id: context.vendorId });
  assert.equal(response.status, 200);
  assert.equal(response.body.data.count, 0);
  assert.equal(response.body.data.total_outstanding, '0');
  assert.equal(Object.keys(response.body.data.buckets).length, 6);
  for (const bucket of Object.values(response.body.data.buckets)) assert.deepEqual(bucket, { count: 0, outstanding_amount: '0' });
});

test('aging preserves cents when totals exceed the per-invoice amount limit', { skip: !integration }, async () => {
  for (let index = 0; index < 2; index++) await createPayable({ invoice_amount: '99999999999999.99', outstanding_amount: '0' });
  const response = await get(`${root}/aging`, { vendor_id: context.vendorId });
  assert.equal(response.status, 200);
  assert.equal(response.body.data.total_outstanding, '199999999999999.98');
  assert.equal(response.body.data.buckets.current.outstanding_amount, '199999999999999.98');
});

test('transactional recalculation persists balances through partial, overdue, and paid states', { skip: !integration }, async () => {
  const row = await createPayable({ paid_amount: '25.15' });
  const id = row.accounts_payable_id;
  await recalculate(id);
  assert.equal((await read(id)).status, 'PARTIALLY_PAID');
  assert.equal((await read(id)).outstanding_amount.toFixed(2), '74.85');
  await prisma.accounts_payable.update({ where: { accounts_payable_id: id }, data: { due_date: due(1) } });
  await recalculate(id);
  assert.equal((await read(id)).status, 'OVERDUE');
  await prisma.accounts_payable.update({ where: { accounts_payable_id: id }, data: { paid_amount: '100' } });
  await recalculate(id);
  const paid = await read(id);
  assert.equal(paid.status, 'PAID');
  assert.equal(paid.outstanding_amount.toFixed(2), '0.00');
  await recalculate(id);
  assert.deepEqual(await read(id), paid);
});

test('recalculation preserves cancelled records and rejects reopening paid records', { skip: !integration }, async () => {
  const cancelled = await createPayable({ status: 'CANCELLED', outstanding_amount: '45' });
  await recalculate(cancelled.accounts_payable_id);
  assert.deepEqual(await read(cancelled.accounts_payable_id), cancelled);
  const paid = await createPayable({ status: 'PAID', paid_amount: '90', outstanding_amount: '10' });
  await assert.rejects(recalculate(paid.accounts_payable_id), { status: 409 });
  assert.deepEqual(await read(paid.accounts_payable_id), paid);
  assert.equal((await get(`${root}/${paid.accounts_payable_id}`)).status, 409);
});

test('recalculation rollback restores both the paid amount and derived balance', { skip: !integration }, async () => {
  const row = await createPayable();
  await assert.rejects(prisma.$transaction(async tx => {
    await tx.accounts_payable.update({ where: { accounts_payable_id: row.accounts_payable_id }, data: { paid_amount: '50' } });
    const result = await recalculatePayable(tx, row.accounts_payable_id, NOW);
    assert.equal(result.status, 'PARTIALLY_PAID');
    assert.equal((await tx.accounts_payable.findUnique({ where: { accounts_payable_id: row.accounts_payable_id } })).outstanding_amount.toFixed(2), '50.00');
    throw new Error('Injected failure after AP recalculation');
  }), /Injected failure/);
  assert.deepEqual(await read(row.accounts_payable_id), row);
});

test('recalculation rejects overpayment, missing AP, and clients without a transaction', { skip: !integration }, async () => {
  const row = await createPayable({ paid_amount: '101' });
  await assert.rejects(recalculate(row.accounts_payable_id), { status: 400 });
  assert.deepEqual(await read(row.accounts_payable_id), row);
  await assert.rejects(recalculate(999999999n), { status: 404 });
  await assert.rejects(recalculatePayable(prisma, row.accounts_payable_id, NOW), /interactive transaction/);
});

test('concurrent recalculation reads the balance after the preceding transaction commits', { skip: !integration, timeout: 10000 }, async () => {
  const row = await createPayable();
  let locked, release, started;
  const acquired = new Promise(resolve => { locked = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const secondStarted = new Promise(resolve => { started = resolve; });
  const first = prisma.$transaction(async tx => {
    await recalculatePayable(tx, row.accounts_payable_id, NOW);
    locked();
    await gate;
    await tx.accounts_payable.update({ where: { accounts_payable_id: row.accounts_payable_id }, data: { paid_amount: '70' } });
    return recalculatePayable(tx, row.accounts_payable_id, NOW);
  });
  await acquired;
  const second = prisma.$transaction(async tx => {
    started();
    return recalculatePayable(tx, row.accounts_payable_id, NOW);
  });
  await secondStarted;
  release();
  const results = await Promise.all([first, second]);
  for (const result of results) assert.equal(result.outstanding_amount.toFixed(2), '30.00');
  assert.equal((await read(row.accounts_payable_id)).status, 'PARTIALLY_PAID');
});

test('AP reads and recalculation preserve BOOKED invoice and create no financial postings', { skip: !integration }, async () => {
  const created = await request(app).post('/api/procurement/vendor-invoices').set('Authorization', context.auth).send({
    vendor_id: context.vendorId, invoice_number: `AP-2G-${context.userId}`, invoice_date: '2026-09-01', due_date: '2026-09-23',
    items: [{ inventory_item_id: context.inventoryItemId, uom: 'EA', quantity: 1, rate: 100 }]
  });
  assert.equal(created.status, 201);
  const invoiceId = BigInt(created.body.data.vendor_invoice_id);
  context.created.vendorInvoiceIds.push(invoiceId);
  assert.equal((await request(app).post(`/api/procurement/vendor-invoices/${invoiceId}/book`).set('Authorization', context.auth).send({})).status, 200);
  const row = await prisma.accounts_payable.findUnique({ where: { vendor_invoice_id: invoiceId } });
  const invoice = await prisma.vendor_invoice.findUnique({ where: { vendor_invoice_id: invoiceId } });
  const sideEffects = () => Promise.all([prisma.payment.count(), prisma.payment_allocation.count(), prisma.accounting_entry.count(),
    prisma.journal_entry.count(), prisma.journal_line.count(), prisma.stock_movement.count()]);
  const before = await sideEffects();
  const response = await get(`${root}/${row.accounts_payable_id}`);
  assert.equal(response.status, 200);
  assert.equal(response.body.data.vendor_invoice.invoice_number, `AP-2G-${context.userId}`);
  assert.equal(response.body.data.status, 'OVERDUE');
  assert.deepEqual(await read(row.accounts_payable_id), row);
  await recalculate(row.accounts_payable_id);
  assert.equal((await read(row.accounts_payable_id)).status, 'OVERDUE');
  assert.deepEqual(await prisma.vendor_invoice.findUnique({ where: { vendor_invoice_id: invoiceId } }), invoice);
  assert.deepEqual(await sideEffects(), before);
  for (const method of ['post', 'patch', 'delete']) {
    assert.equal((await request(app)[method](`${root}/${row.accounts_payable_id}`).set('Authorization', context.auth).send({ paid_amount: 100 })).status, 404);
  }
});
