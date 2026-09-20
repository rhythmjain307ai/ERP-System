const { recognize } = require('tesseract.js');
const { ValidationError } = require('../errors');

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png']);

async function extractText(filePath, mimeType) {
  if (!IMAGE_TYPES.has(mimeType)) {
    throw new ValidationError('PDF files are stored securely but local OCR currently supports JPG, JPEG, and PNG only. The PDF has been saved for manual review.');
  }
  console.info('OCR started', { mimeType });
  const result = await recognize(filePath, 'eng', { logger: () => {} });
  const text = result.data.text || '';
  console.info('OCR completed', { characters: text.length, confidence: result.data.confidence });
  return { text, confidence: Number(result.data.confidence || 0), engine: 'tesseract.js', version: require('tesseract.js/package.json').version };
}

module.exports = { extractText, IMAGE_TYPES };
