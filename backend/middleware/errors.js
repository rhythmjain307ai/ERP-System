const { Prisma } = require('@prisma/client');
const multer = require('multer');
const { ApiError } = require('../lib/errors');

function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  let status = error.status || 500;
  let message = error.message || 'Internal server error';
  let details = error.details;

  if (error instanceof multer.MulterError) {
    status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    message = error.code === 'LIMIT_FILE_SIZE' ? 'File is too large. The maximum upload size is 10 MB.' : 'Invalid file upload.';
  } else if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2025') { status = 404; message = 'Record not found'; }
    else if (error.code === 'P2002') { status = 409; message = 'A record with this unique value already exists'; details = error.meta; }
    else if (error.code === 'P2003') { status = 400; message = 'A referenced record does not exist'; details = error.meta; }
  } else if (!(error instanceof ApiError)) {
    console.error(error);
  }

  if (status >= 500) { message = 'The server could not complete this request. Please retry or contact the administrator.'; details = undefined; }
  res.status(status).json({ success: false, error: { message, ...(details ? { details } : {}) } });
}

module.exports = errorHandler;
