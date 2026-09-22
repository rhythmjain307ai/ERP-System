const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { verifyUploadedFile } = require('../middleware/upload');

test('accepts a file whose bytes match its declared PNG type', async () => {
  const filePath = path.join(os.tmpdir(), `erp-upload-${Date.now()}.png`);
  await fs.writeFile(filePath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  await verifyUploadedFile({ path: filePath, mimetype: 'image/png' });
  await fs.unlink(filePath);
});

test('rejects and removes a file with spoofed image MIME type', async () => {
  const filePath = path.join(os.tmpdir(), `erp-upload-${Date.now()}.jpg`);
  await fs.writeFile(filePath, 'not an image');
  await assert.rejects(verifyUploadedFile({ path: filePath, mimetype: 'image/jpeg' }));
  await assert.rejects(fs.access(filePath));
});
