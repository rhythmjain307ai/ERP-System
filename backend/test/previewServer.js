// Explicit isolated browser test harness: in-memory persistence, real routes/OCR/auth.
// Never imported by server.js. Binds only to localhost and never connects to PostgreSQL.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const express = require('express');
const prisma = require('../lib/prisma');
const { createAuthToken } = require('../middleware/auth');
const { createCanvas } = require('@napi-rs/canvas');
const { invoiceText, pdf } = require('./invoiceFixtures');
const documents = [], reviews = [];
prisma.users.findUnique = async () => ({ user_id: 1n, is_active: true, role: { role_permission: ['documents.write','documents.review'].map(permission_code => ({ permission: { permission_code } })) } });
prisma.document.create = async ({ data }) => {
  const { invoice_extraction_review, ...rest } = data;
  const doc = { ...rest, document_id: BigInt(documents.length + 1), uploaded_at: new Date() };
  documents.push(doc); reviews.push({ ...invoice_extraction_review.create, document_id: doc.document_id, invoice_extraction_review_id: doc.document_id }); return doc;
};
prisma.document.findMany = async () => documents.map(doc => ({ ...doc, invoice_extraction_review: reviews.find(review => review.document_id === doc.document_id) }));
prisma.document.findUnique = async ({ where }) => (await prisma.document.findMany()).find(doc => doc.document_id === where.document_id);
prisma.invoice_extraction_review.findMany = async () => reviews;
prisma.invoice_extraction_review.findUnique = async ({ where }) => reviews.find(review => review.invoice_extraction_review_id === where.invoice_extraction_review_id);
prisma.invoice_extraction_review.update = async ({ where, data }) => { const review = reviews.find(review => where.document_id ? review.document_id === where.document_id : review.invoice_extraction_review_id === where.invoice_extraction_review_id); Object.assign(review, data); return review; };
async function main() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'erp-browser-fixtures-'));
  await fs.writeFile(path.join(dir, 'invoice.pdf'), pdf(invoiceText('INV-BROWSER-101')));
  await fs.writeFile(path.join(dir, 'uncertain.pdf'), pdf('Vendor unknown. This invoice has unreadable transaction details.'));
  const canvas = createCanvas(1500, 2100), ctx = canvas.getContext('2d');
  ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 1500, 2100); ctx.fillStyle = 'black'; ctx.font = '34px Arial';
  invoiceText('INV-BROWSER-102').split('\n').forEach((line, index) => ctx.fillText(line, 65, 110 + index * 70));
  await fs.writeFile(path.join(dir, 'invoice.png'), canvas.toBuffer('image/png'));
  const shell = express();
  shell.get('/', async (req, res) => { const html = await fs.readFile(path.join(__dirname, '../../app/index.html'), 'utf8'); res.type('html').send(html.replace('<script src="app.js">', `<script>window.ERP_AUTH_TOKEN=${JSON.stringify(createAuthToken(1))}</script><script src="app.js">`)); });
  shell.use(require('../app'));
  const server = shell.listen(4001, '127.0.0.1', () => console.log(`Isolated preview: http://localhost:4001; fixtures: ${dir}`));
  process.on('SIGINT', async () => { server.close(); for (const doc of documents) await fs.unlink(path.join(__dirname, '../uploads', doc.file_name)).catch(() => {}); await fs.rm(dir, { recursive: true, force: true }); process.exit(); });
}
main().catch(error => { console.error(error); process.exitCode = 1; });
