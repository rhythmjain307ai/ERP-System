const fs = require('node:fs/promises');
const { recognize } = require('tesseract.js');
const pdfParse = require('pdf-parse');
const { ValidationError } = require('../errors');

const IMAGE_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/pjpeg', 'image/png']);

function normalizeMimeType(mimeType) {
  return String(mimeType || '').toLowerCase().replace(/^image\/jpg$/, 'image/jpeg').replace(/^image\/pjpeg$/, 'image/jpeg');
}

async function extractText(filePath, mimeType) {
  const normalized = normalizeMimeType(mimeType);
  if (normalized === 'application/pdf') {
    console.info('PDF text extraction started');
    let parsed;
    try {
      parsed = await pdfParse(await fs.readFile(filePath));
    } catch (error) {
      throw new ValidationError('The PDF could not be read for text extraction. It has been saved for manual review.', { cause: error.message });
    }
    const text = parsed.text || '';
    if (!text.trim()) throw new ValidationError('This PDF contains no searchable text. Image-only PDF scans require manual review or PDF rendering support.');
    console.info('PDF text extraction completed', { pages: parsed.numpages, characters: text.length });
    return { text, confidence: 100, engine: 'pdf-parse', version: require('pdf-parse/package.json').version };
  }
  if (!IMAGE_TYPES.has(normalized)) {
    throw new ValidationError('This file type is stored securely but is not supported for local OCR. The file has been saved for manual review.');
  }
  console.info('OCR started', { mimeType: normalized });
  const result = await recognize(filePath, 'eng', { logger: () => {} });
  const text = result.data.text || '';
  console.info('OCR completed', { characters: text.length, confidence: result.data.confidence });
  return { text, confidence: Number(result.data.confidence || 0), engine: 'tesseract.js', version: require('tesseract.js/package.json').version };
}

module.exports = { extractText, IMAGE_TYPES, normalizeMimeType };
