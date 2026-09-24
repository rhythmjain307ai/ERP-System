const ocrService = require('./ocrService');
const { extractInvoice } = require('./invoiceExtractor');
const { validateInvoice } = require('./invoiceValidator');
const { databaseStatus } = require('./documentContract');
const { ValidationError } = require('../errors');
const normalize = value => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
function sameInvoice(a, b) {
  if (!a?.invoiceNumber || !b?.invoiceNumber || a.amounts?.total == null || b.amounts?.total == null) return false;
  const vendorMatches = a.vendor?.gstin && b.vendor?.gstin ? normalize(a.vendor.gstin) === normalize(b.vendor.gstin) : normalize(a.vendor?.name) && normalize(a.vendor?.name) === normalize(b.vendor?.name);
  return Boolean(vendorMatches && normalize(a.invoiceNumber) === normalize(b.invoiceNumber) && Math.abs(Number(a.amounts.total) - Number(b.amounts.total)) < 0.01);
}
async function processDocument(prisma, document, filePath) {
  let data;
  try {
    const ocr = await ocrService.extractText(filePath, document.mime_type);
    const fields = extractInvoice(ocr);
    if (document.document_type && document.document_type !== 'PURCHASE_INVOICE') fields.documentType = document.document_type;
    const validation = validateInvoice(fields, ocr.confidence);
    validation.errors.push(...(ocr.warnings || []));
    if (ocr.text.trim().length < 30) validation.errors.push('Almost no text detected. Upload a clearer image or enter the invoice details manually.');
    const reviews = await prisma.invoice_extraction_review.findMany({ where: { document_id: { not: document.document_id } }, select: { document_id: true, extracted_fields: true } });
    const duplicate = reviews.find(review => sameInvoice(fields, review.extracted_fields));
    if (duplicate) validation.errors.push(`Possible duplicate of document ${duplicate.document_id}. Check the original before approving.`);
    data = { extraction_status: databaseStatus(validation.errors.length ? 'NEEDS_REVIEW' : validation.status), extraction_engine: ocr.engine, extraction_version: ocr.version, raw_ocr_output: { text: ocr.text, confidence: ocr.confidence, pages: ocr.pages, warnings: ocr.warnings || [] }, extracted_fields: fields, confidence_score: validation.confidence, validation_errors: validation.errors };
  } catch (error) {
    data = { extraction_status: databaseStatus(error instanceof ValidationError ? 'NEEDS_REVIEW' : 'FAILED'), validation_errors: [error instanceof ValidationError ? error.message : 'Extraction failed. Check that the file is readable and unencrypted, then retry. The original is saved.'] };
    console.error('Document extraction failed', { documentId: String(document.document_id), errorType: error.name });
  }
  const review = await prisma.invoice_extraction_review.update({ where: { document_id: document.document_id }, data: { ...data, updated_at: new Date() } });
  return { ...document, invoice_extraction_review: review };
}
module.exports = { processDocument, sameInvoice };
