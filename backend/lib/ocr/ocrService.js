const fs = require('node:fs/promises');
const { createWorker, PSM } = require('tesseract.js');
const { PDFParse } = require('pdf-parse');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { ValidationError } = require('../errors');

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png']);
const MAX_PAGES = positiveLimit(process.env.OCR_MAX_PDF_PAGES, 50);
const OCR_TIMEOUT_MS = positiveLimit(process.env.OCR_TIMEOUT_MS, 120_000);
const MIN_EMBEDDED_TEXT = 30;
const LOW_QUALITY_CONFIDENCE = 0.62;
const MAX_CONCURRENT_JOBS = positiveLimit(process.env.OCR_MAX_CONCURRENT_JOBS, 2);
const MAX_QUEUED_JOBS = positiveLimit(process.env.OCR_MAX_QUEUED_JOBS, 20);
let activeJobs = 0;
const queuedJobs = [];

function positiveLimit(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const finite = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const clamp01 = value => Math.max(0, Math.min(1, finite(value) / 100));
function bbox(value) {
  if (!value) return null;
  const normalized = { x0: finite(value.x0), y0: finite(value.y0), x1: finite(value.x1), y1: finite(value.y1) };
  return normalized.x1 > normalized.x0 && normalized.y1 > normalized.y0 ? normalized : null;
}

function normalizeTesseractPage(data, pageNumber, width, height, preprocessed = false) {
  const blocks = [];
  const lines = [];
  for (const [blockIndex, block] of (data.blocks || []).entries()) {
    const normalizedBlock = { text: String(block.text || '').trim(), confidence: clamp01(block.confidence), bbox: bbox(block.bbox), paragraphs: [] };
    for (const [paragraphIndex, paragraph] of (block.paragraphs || []).entries()) {
      const normalizedParagraph = { text: String(paragraph.text || '').trim(), confidence: clamp01(paragraph.confidence), bbox: bbox(paragraph.bbox), lines: [] };
      for (const line of paragraph.lines || []) {
        const normalizedLine = {
          text: String(line.text || '').replace(/\s+/g, ' ').trim(), confidence: clamp01(line.confidence), bbox: bbox(line.bbox), blockIndex, paragraphIndex,
          words: (line.words || []).map(word => ({ text: String(word.text || '').trim(), confidence: clamp01(word.confidence), bbox: bbox(word.bbox) })).filter(word => word.text)
        };
        if (normalizedLine.text || normalizedLine.words.length) {
          normalizedParagraph.lines.push(normalizedLine);
          lines.push(normalizedLine);
        }
      }
      normalizedBlock.paragraphs.push(normalizedParagraph);
    }
    blocks.push(normalizedBlock);
  }
  return { pageNumber, width, height, text: String(data.text || '').trim(), confidence: clamp01(data.confidence), rotationRadians: finite(data.rotateRadians), source: 'ocr', preprocessed, blocks, lines };
}

async function embeddedLayout(parser, pageNumber, text) {
  const pdfPage = await parser.doc.getPage(pageNumber);
  const viewport = pdfPage.getViewport({ scale: 1 });
  const content = await pdfPage.getTextContent();
  const rows = [];
  for (const item of content.items || []) {
    const value = String(item.str || '').trim();
    if (!value) continue;
    const x = finite(item.transform?.[4]);
    const fontHeight = Math.max(1, Math.abs(finite(item.height) || finite(item.transform?.[3]) || 8));
    const top = Math.max(0, viewport.height - finite(item.transform?.[5]) - fontHeight);
    let row = rows.find(candidate => Math.abs(candidate.top - top) <= Math.max(2, fontHeight * 0.35));
    if (!row) { row = { top, height: fontHeight, items: [] }; rows.push(row); }
    row.items.push({ value, x, width: Math.max(1, finite(item.width)), top, height: fontHeight });
  }
  const lines = rows.sort((a, b) => a.top - b.top).map((row, lineIndex) => {
    row.items.sort((a, b) => a.x - b.x);
    const words = [];
    for (const item of row.items) {
      const parts = item.value.split(/\s+/).filter(Boolean);
      const totalChars = parts.reduce((sum, part) => sum + part.length, 0) || 1;
      let cursor = item.x;
      for (const part of parts) {
        const width = item.width * (part.length / totalChars);
        words.push({ text: part, confidence: 1, bbox: { x0: cursor, y0: item.top, x1: cursor + width, y1: item.top + item.height } });
        cursor += width + item.width * (1 / totalChars);
      }
    }
    const boxes = words.map(word => word.bbox);
    return { text: row.items.map(item => item.value).join(' '), confidence: 1, bbox: boxes.length ? { x0: Math.min(...boxes.map(box => box.x0)), y0: Math.min(...boxes.map(box => box.y0)), x1: Math.max(...boxes.map(box => box.x1)), y1: Math.max(...boxes.map(box => box.y1)) } : null, blockIndex: 0, paragraphIndex: lineIndex, words };
  });
  pdfPage.cleanup();
  return { pageNumber, width: viewport.width, height: viewport.height, text: String(text || '').trim(), confidence: 1, rotationRadians: 0, source: 'embedded_text', preprocessed: false, blocks: [], lines };
}

function imageQuality(page) {
  const words = page.lines.flatMap(line => line.words).filter(word => /[A-Z0-9]/i.test(word.text));
  const confidence = words.length ? words.reduce((sum, word) => sum + word.confidence, 0) / words.length : page.confidence;
  return (confidence * 0.75) + Math.min(1, page.text.replace(/\s/g, '').length / 250) * 0.25;
}

async function preprocessImage(input) {
  const image = await loadImage(input);
  const scale = Math.max(1, Math.min(2, 2200 / Math.max(1, image.width)));
  const canvas = createCanvas(Math.round(image.width * scale), Math.round(image.height * scale));
  const context = canvas.getContext('2d');
  context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  const histogram = new Uint32Array(256);
  for (let index = 0; index < pixels.data.length; index += 4) {
    const gray = Math.round(pixels.data[index] * 0.299 + pixels.data[index + 1] * 0.587 + pixels.data[index + 2] * 0.114);
    histogram[gray]++;
  }
  const count = canvas.width * canvas.height;
  const percentile = target => { let sum = 0; for (let value = 0; value < 256; value++) { sum += histogram[value]; if (sum >= count * target) return value; } return 255; };
  const low = percentile(0.03);
  const high = Math.max(low + 20, percentile(0.97));
  for (let index = 0; index < pixels.data.length; index += 4) {
    const gray = Math.round(pixels.data[index] * 0.299 + pixels.data[index + 1] * 0.587 + pixels.data[index + 2] * 0.114);
    const enhanced = Math.max(0, Math.min(255, Math.round((gray - low) * 255 / (high - low))));
    pixels.data[index] = enhanced; pixels.data[index + 1] = enhanced; pixels.data[index + 2] = enhanced;
  }
  context.putImageData(pixels, 0, 0);
  return { data: canvas.toBuffer('image/png'), width: canvas.width, height: canvas.height };
}

async function runRecognition(worker, image, pageNumber, width, height, preprocessed = false) {
  let timer;
  try {
    const result = await Promise.race([
      worker.recognize(image, { rotateAuto: true }, { text: true, blocks: true, tsv: true }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('OCR timeout')), OCR_TIMEOUT_MS); })
    ]);
    return normalizeTesseractPage(result.data, pageNumber, width, height, preprocessed);
  } finally { clearTimeout(timer); }
}

async function recognizeAdaptive(worker, image, pageNumber, width, height) {
  const first = await runRecognition(worker, image, pageNumber, width, height, false);
  if (imageQuality(first) >= LOW_QUALITY_CONFIDENCE && first.text.replace(/\s/g, '').length >= 40) return { page: first, warning: null };
  const processed = await preprocessImage(image);
  const second = await runRecognition(worker, processed.data, pageNumber, processed.width, processed.height, true);
  if (imageQuality(second) > imageQuality(first) + 0.02) return { page: second, warning: `Page ${pageNumber} used adaptive grayscale and contrast preprocessing after a low-quality first OCR pass.` };
  return { page: first, warning: `Page ${pageNumber} remained low confidence after adaptive OCR preprocessing and requires review.` };
}

async function withWorker(callback) {
  const worker = await createWorker('eng', 1, { errorHandler: () => {} });
  try {
    await worker.setParameters({ preserve_interword_spaces: '1', user_defined_dpi: '300', tessedit_pageseg_mode: PSM.AUTO });
    return await callback(worker);
  } finally { await worker.terminate(); }
}

function documentResult(pages, engine, warnings = []) {
  const confidence = pages.reduce((sum, page) => sum + page.confidence * 100, 0) / Math.max(1, pages.length);
  return { text: pages.map(page => page.text).join('\n\n'), confidence, engine, version: 'pdf-parse@2.4.5+tesseract.js@7', warnings, pages };
}

async function extractText(filePath, mimeType) {
  await acquireJob();
  try { return await extractDocument(filePath, mimeType); } finally { releaseJob(); }
}

async function acquireJob() {
  if (activeJobs < MAX_CONCURRENT_JOBS) { activeJobs++; return; }
  if (queuedJobs.length >= MAX_QUEUED_JOBS) throw new ValidationError('The local OCR queue is full. Your document is saved; retry extraction in a few minutes.');
  await new Promise(resolve => queuedJobs.push(resolve));
}

function releaseJob() {
  const next = queuedJobs.shift();
  if (next) next();
  else activeJobs = Math.max(0, activeJobs - 1);
}

async function extractDocument(filePath, mimeType) {
  if (IMAGE_TYPES.has(mimeType)) {
    const input = await fs.readFile(filePath);
    const image = await loadImage(input);
    return withWorker(async worker => {
      const { page, warning } = await recognizeAdaptive(worker, input, 1, image.width, image.height);
      return documentResult([page], 'tesseract.js', warning ? [warning] : []);
    });
  }
  if (mimeType !== 'application/pdf') throw new ValidationError('Unsupported document format.');
  const parser = new PDFParse({ data: await fs.readFile(filePath) });
  try {
    const info = await parser.getInfo();
    if (info.total > MAX_PAGES) throw new ValidationError(`PDF exceeds ${MAX_PAGES} pages. Split it into smaller PDFs or enter the fields manually.`);
    const embedded = [];
    let needsOcr = false;
    for (let pageNumber = 1; pageNumber <= info.total; pageNumber++) {
      const result = await parser.getText({ partial: [pageNumber] });
      const text = result.pages.map(item => item.text).join('\n').trim();
      embedded.push(text);
      if (text.replace(/\s/g, '').length < MIN_EMBEDDED_TEXT) needsOcr = true;
    }
    const pages = [];
    const warnings = [];
    if (!needsOcr) {
      for (let pageNumber = 1; pageNumber <= info.total; pageNumber++) pages.push(await embeddedLayout(parser, pageNumber, embedded[pageNumber - 1]));
      return documentResult(pages, 'pdf-parse');
    }
    await withWorker(async worker => {
      for (let pageNumber = 1; pageNumber <= info.total; pageNumber++) {
        if (embedded[pageNumber - 1].replace(/\s/g, '').length >= MIN_EMBEDDED_TEXT) {
          pages.push(await embeddedLayout(parser, pageNumber, embedded[pageNumber - 1]));
          continue;
        }
        try {
          const rendered = await parser.getScreenshot({ partial: [pageNumber], desiredWidth: 2200, imageDataUrl: false });
          const screenshot = rendered.pages[0];
          const recognized = await recognizeAdaptive(worker, screenshot.data, pageNumber, screenshot.width, screenshot.height);
          pages.push(recognized.page);
          if (recognized.warning) warnings.push(recognized.warning);
        } catch (error) {
          pages.push({ pageNumber, width: 0, height: 0, text: '', confidence: 0, rotationRadians: 0, source: 'ocr', preprocessed: false, blocks: [], lines: [] });
          warnings.push(`Page ${pageNumber} could not be OCR processed (${error.name || 'OCR error'}). Upload a clearer image or enter uncertain fields manually.`);
        }
      }
    });
    return documentResult(pages, 'pdf-parse+tesseract.js', warnings);
  } finally { await parser.destroy(); }
}

module.exports = { extractText, extractDocument, normalizeTesseractPage, preprocessImage, IMAGE_TYPES, limits: { maxPages: MAX_PAGES, timeoutMs: OCR_TIMEOUT_MS, maxConcurrentJobs: MAX_CONCURRENT_JOBS, maxQueuedJobs: MAX_QUEUED_JOBS } };
