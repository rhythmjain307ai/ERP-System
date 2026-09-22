const fs = require('node:fs/promises');
const { createWorker } = require('tesseract.js');
const { PDFParse } = require('pdf-parse');
const { ValidationError } = require('../errors');

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png']);
let activeJobs = 0;

async function extractText(filePath, mimeType) {
  if (activeJobs >= 2) throw new ValidationError('The local OCR engine is busy. Your document is saved; use Retry extraction shortly.');
  activeJobs++;
  try { return await extractDocument(filePath, mimeType); } finally { activeJobs--; }
}
async function extractDocument(filePath, mimeType) {
  if (IMAGE_TYPES.has(mimeType)) return { ...await recognize(filePath), engine: 'tesseract.js', version: '7' };
  if (mimeType !== 'application/pdf') throw new ValidationError('Unsupported document format.');
  const parser = new PDFParse({ data: await fs.readFile(filePath) });
  try {
    const info = await parser.getInfo();
    if (info.total > 10) throw new ValidationError('PDF exceeds 10 pages. Split it into smaller PDFs or enter the fields manually.');
    const pages = [], warnings = [];
    let scanned = false;
    for (let page = 1; page <= info.total; page++) {
      const result = await parser.getText({ partial: [page] });
      const text = result.pages.map(item => item.text).join('\n').trim();
      if (text.replace(/\s/g, '').length >= 30) pages.push({ text, confidence: 100 });
      else {
        scanned = true;
        try {
          const rendered = await parser.getScreenshot({ partial: [page], desiredWidth: 1800, imageDataUrl: false });
          pages.push(await recognize(rendered.pages[0].data));
        } catch {
          pages.push({ text, confidence: 0 });
          warnings.push(`Page ${page} could not be OCR processed. Check PDF rendering support and access to Tesseract English language data, or upload that page as a clear JPG/PNG.`);
        }
      }
    }
    return { text: pages.map(page => page.text).join('\n\n'), confidence: pages.reduce((sum, page) => sum + page.confidence, 0) / Math.max(1, pages.length), engine: scanned ? 'pdf-parse+tesseract.js' : 'pdf-parse', version: '2.4.5/7', warnings };
  } finally { await parser.destroy(); }
}

async function recognize(image) {
  const worker = await createWorker('eng', 1, { errorHandler: () => {} });
  let timer;
  try {
    await worker.setParameters({ preserve_interword_spaces: '1', user_defined_dpi: '300' });
    const result = await Promise.race([worker.recognize(image, { rotateAuto: true }), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('OCR timeout')), 90000); })]);
    return { text: result.data.text || '', confidence: Number(result.data.confidence || 0) };
  } finally { clearTimeout(timer); await worker.terminate(); }
}

module.exports = { extractText, IMAGE_TYPES };
