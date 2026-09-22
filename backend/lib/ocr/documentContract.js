const stored = { PROCESSED: 'EXTRACTED', NEEDS_REVIEW: 'UNDER_REVIEW', FAILED: 'VALIDATION_FAILED' };
const exposed = Object.fromEntries(Object.entries(stored).map(([api, db]) => [db, api]));
function databaseStatus(status) { return stored[status] || status; }
function publicReview(review) { return review ? { ...review, extraction_status: exposed[review.extraction_status] || review.extraction_status } : null; }
function publicDocument(document) {
  return { ...document, file_url: `/api/documents/${document.document_id}/file`, invoice_extraction_review: publicReview(document.invoice_extraction_review) };
}
module.exports = { databaseStatus, publicReview, publicDocument };
