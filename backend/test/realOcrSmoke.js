// Opt-in local smoke check. Synthetic fixtures only; no database access.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createCanvas } = require('@napi-rs/canvas');
const { PDFParse } = require('pdf-parse');
const { extractText } = require('../lib/ocr/ocrService');
const { extractInvoice } = require('../lib/ocr/invoiceExtractor');
const { invoiceText, pdf } = require('./invoiceFixtures');
const assert = require('node:assert/strict');
function scannedPdf(jpeg, width, height) {
  const stream = 'q 600 0 0 840 0 0 cm /Im0 Do Q';
  const objects = [Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'), Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'), Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 840] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>'), Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`), jpeg, Buffer.from('\nendstream')]), Buffer.from(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)];
  const chunks = [Buffer.from('%PDF-1.4\n')], offsets = [];
  for (let i = 0; i < objects.length; i++) { offsets.push(Buffer.concat(chunks).length); chunks.push(Buffer.from(`${i + 1} 0 obj\n`), objects[i], Buffer.from('\nendobj\n')); }
  const offset = Buffer.concat(chunks).length;
  chunks.push(Buffer.from(`xref\n0 6\n0000000000 65535 f \n${offsets.map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF`)); return Buffer.concat(chunks);
}
async function main() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'erp-real-ocr-'));
  try {
    const canvas = createCanvas(1500, 2100), ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 1500, 2100); ctx.fillStyle = 'black'; ctx.font = '34px Arial';
    invoiceText('INV-SMOKE-101').split('\n').forEach((line, index) => ctx.fillText(line, 65, 110 + index * 70));
    const cases = [['invoice.png', canvas.toBuffer('image/png'), 'image/png'], ['invoice.pdf', pdf(invoiceText('INV-SMOKE-101')), 'application/pdf'], ['scan.pdf', scannedPdf(canvas.toBuffer('image/jpeg'), 1500, 2100), 'application/pdf']];
    for (const [name, bytes, type] of cases) {
      const file = path.join(dir, name); await fs.writeFile(file, bytes);
      const result = await extractText(file, type), fields = extractInvoice(result.text);
      assert.equal(fields.invoiceNumber, 'INV-SMOKE-101'); assert.equal(fields.amounts.total, 100300);
      console.log(JSON.stringify({ file: name, engine: result.engine, invoiceNumber: fields.invoiceNumber, total: fields.amounts.total, warnings: result.warnings || [] }));
    }
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
