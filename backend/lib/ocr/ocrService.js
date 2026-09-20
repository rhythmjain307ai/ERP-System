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
    let parsed = null;
    try {
      parsed = await pdfParse(await fs.readFile(filePath));
    } catch (error) { console.warn('PDF text extraction unavailable; rendering pages for OCR', { message: error.message }); }
    if (parsed?.text?.trim()) {
      console.info('PDF text extraction completed', { pages: parsed.numpages, characters: parsed.text.length });
      return { text: parsed.text, confidence: 100, engine: 'pdf-parse', version: require('pdf-parse/package.json').version };
    }
    return extractPdfImages(filePath);
  }
  if (!IMAGE_TYPES.has(normalized)) {
    throw new ValidationError('This file type is stored securely but is not supported for local OCR. The file has been saved for manual review.');
  }
  return recognizeImage(filePath, normalized);
}

async function recognizeImage(input, mimeType = 'image/png') {
  console.info('OCR started', { mimeType });
  const result = await recognize(input, 'eng', { logger: () => {} });
  const text = result.data.text || '';
  console.info('OCR completed', { characters: text.length, confidence: result.data.confidence });
  return { text, confidence: Number(result.data.confidence || 0), engine: 'tesseract.js', version: require('tesseract.js/package.json').version };
}

async function extractPdfImages(filePath) {
  let document;
  try {
    const { pdf } = await import('pdf-to-img');
    document = await pdf(filePath, { scale: 2 });
    const pages = [];
    for await (const image of document) pages.push(await recognizeImage(image));
    const text = pages.map((page) => page.text).filter(Boolean).join('\n');
    if (!text.trim()) throw new ValidationError('This PDF contains no readable invoice text. It has been saved for manual review.');
    const confidence = pages.length ? pages.reduce((total, page) => total + page.confidence, 0) / pages.length : 0;
    return { text, confidence, engine: 'pdf-to-img+tesseract.js', version: require('tesseract.js/package.json').version };
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new ValidationError('The PDF could not be rendered for OCR. It has been saved for manual review.', { cause: error.message });
  } finally {
    if (document) await document.destroy();
  }
}

module.exports = { extractText, IMAGE_TYPES, normalizeMimeType };
