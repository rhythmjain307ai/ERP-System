const { PrismaClient } = require('@prisma/client');

function positiveInteger(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

const prisma = global.__erpPrisma || new PrismaClient({
  transactionOptions: {
    maxWait: positiveInteger('PRISMA_TRANSACTION_MAX_WAIT_MS', 10000),
    timeout: positiveInteger('PRISMA_TRANSACTION_TIMEOUT_MS', 30000)
  }
});

if (process.env.NODE_ENV !== 'production') global.__erpPrisma = prisma;

module.exports = prisma;
