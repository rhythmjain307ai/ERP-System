const { Prisma } = require('@prisma/client');
const { ApiError } = require('../lib/errors');

function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  let status = error.status || 500;
  let message = error.message || 'Internal server error';
  let details = error.details;

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2025') { status = 404; message = 'Record not found'; }
    else if (error.code === 'P2002') { status = 409; message = 'A record with this unique value already exists'; details = error.meta; }
    else if (error.code === 'P2003') { status = 400; message = 'A referenced record does not exist'; details = error.meta; }
  } else if (!(error instanceof ApiError)) {
    console.error(error);
  }

  res.status(status).json({ success: false, error: { message, ...(details ? { details } : {}) } });
}

module.exports = errorHandler;