const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const multer = require('multer');
const { ValidationError } = require('../lib/errors');

const uploadDirectory = path.resolve(__dirname, '..', 'uploads');
fs.mkdirSync(uploadDirectory, { recursive: true });
const allowedMimeTypes = new Set(['image/jpeg', 'image/png', 'application/pdf']);
const extensions = { 'image/jpeg': '.jpg', 'image/png': '.png', 'application/pdf': '.pdf' };

const storage = multer.diskStorage({
  destination: uploadDirectory,
  filename: (req, file, callback) => callback(null, `${crypto.randomUUID()}${extensions[file.mimetype]}`)
});

const documentUpload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, callback) => {
    if (!allowedMimeTypes.has(file.mimetype)) return callback(new ValidationError('Unsupported file type. Upload a JPG, JPEG, PNG, or PDF.'));
    callback(null, true);
  }
}).single('file');

async function verifyUploadedFile(file) {
  const header = await fsp.readFile(file.path, { encoding: null }).then((buffer) => buffer.subarray(0, 12));
  const isJpeg = header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
  const isPng = header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isPdf = header.subarray(0, 5).toString('ascii') === '%PDF-';
  const valid = (file.mimetype === 'image/jpeg' && isJpeg) || (file.mimetype === 'image/png' && isPng) || (file.mimetype === 'application/pdf' && isPdf);
  if (!valid) {
    await fsp.unlink(file.path).catch(() => {});
    throw new ValidationError('File contents do not match an allowed image or PDF format.');
  }
}

module.exports = { documentUpload, verifyUploadedFile, uploadDirectory };
