const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const request = require('supertest');
const prisma = require('../lib/prisma');
const app = require('../app');
const { createAuthToken } = require('../middleware/auth');
const ocr = require('../lib/ocr/ocrService');
const { uploadDirectory } = require('../middleware/upload');
const { pdf, invoiceText } = require('./invoiceFixtures');

test('ten authenticated uploads preserve results across upload, detail, and list, including failures', async t => {
  const documents = [], reviews = [];
  function mockMethod(target, name, replacement) {
    const original = target[name];
    target[name] = replacement;
    t.after(() => { target[name] = original; });
  }
  const allowed = ['PENDING','PROCESSING','EXTRACTED','UNDER_REVIEW','VALIDATION_FAILED','APPROVED','REJECTED'];
  mockMethod(prisma.users, 'findUnique', async () => ({ user_id: 1n, is_active: true, role: { role_permission: [{ permission: { permission_code: 'documents.write' } }, { permission: { permission_code: 'documents.review' } }] } }));
  mockMethod(prisma.document, 'create', async ({ data }) => {
    const { invoice_extraction_review, ...rest } = data;
    const doc = { ...rest, document_id: BigInt(documents.length + 1), uploaded_at: new Date() };
    documents.push(doc); reviews.push({ ...invoice_extraction_review.create, document_id: doc.document_id, invoice_extraction_review_id: doc.document_id }); return doc;
  });
  mockMethod(prisma.document, 'findUnique', async ({ where }) => {
    const doc = documents.find(doc => doc.document_id === where.document_id);
    return doc ? { ...doc, invoice_extraction_review: reviews.find(review => review.document_id === doc.document_id) } : null;
  });
  mockMethod(prisma.document, 'findMany', async () => documents.map(doc => ({ ...doc, invoice_extraction_review: reviews.find(review => review.document_id === doc.document_id) })));
  mockMethod(prisma.invoice_extraction_review, 'findMany', async () => reviews);
  mockMethod(prisma.invoice_extraction_review, 'findUnique', async ({ where }) => reviews.find(review => review.invoice_extraction_review_id === where.invoice_extraction_review_id) || null);
  mockMethod(prisma.invoice_extraction_review, 'update', async ({ where, data }) => {
    assert.ok(allowed.includes(data.extraction_status), 'must satisfy the existing database check constraint');
    const review = reviews.find(review => review.document_id === where.document_id || review.invoice_extraction_review_id === where.invoice_extraction_review_id); Object.assign(review, data); return review;
  });
  const auth = `Bearer ${createAuthToken(1)}`;
  try {
    for (let i = 0; i < 10; i++) {
      const broken = i === 9;
      const uncertain = i === 8;
      const buffer = broken ? Buffer.from('%PDF-broken') : pdf(uncertain ? 'Invoice unreadable vendor details missing' : invoiceText(`INV-${i}`));
      const response = await request(app).post('/api/documents/upload').set('Authorization', auth).attach('file', buffer, { filename: 'bill.pdf', contentType: 'application/pdf' });
      assert.equal(response.status, 201, JSON.stringify(response.body));
      const record = response.body.data;
      const status = record.invoice_extraction_review.extraction_status;
      assert.equal(status, broken ? 'FAILED' : uncertain ? 'NEEDS_REVIEW' : 'PROCESSED');
      const detail = await request(app).get(`/api/documents/${record.document_id}`).set('Authorization', auth);
      assert.deepEqual(detail.body.data.invoice_extraction_review, record.invoice_extraction_review);
      const list = await request(app).get('/api/documents').set('Authorization', auth);
      assert.equal(list.body.data.find(item => item.document_id === record.document_id).invoice_extraction_review.extraction_status, status);
      const original = await request(app).get(record.file_url).set('Authorization', auth);
      assert.equal(original.status, 200);
    }
    const firstReview = reviews[0];
    const originalConfidence = firstReview.confidence_score;
    const reviewUpdate = await request(app).patch(`/api/documents/reviews/${firstReview.invoice_extraction_review_id}`).set('Authorization', auth).send({ reviewer_decision: 'NEEDS_CORRECTION', extracted_fields: firstReview.extracted_fields, review_notes: 'Manual verification' });
    assert.equal(reviewUpdate.status, 200, JSON.stringify(reviewUpdate.body));
    assert.equal(reviewUpdate.body.data.confidence_score, originalConfidence, 'manual review retains machine extraction confidence');
    assert.equal(documents.length, 10); assert.equal(reviews.length, 10);
    console.log('10/10 upload contract scenarios passed: 8 digital PDFs processed, 1 uncertain retained, 1 invalid PDF retained as failed. Database mocked; PDF engine real.');
  } finally { for (const doc of documents) await fs.unlink(path.join(uploadDirectory, doc.file_name)); }
});
