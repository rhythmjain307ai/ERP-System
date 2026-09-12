const { PrismaClient } = require('@prisma/client');

const prisma = global.__erpPrisma || new PrismaClient();

if (process.env.NODE_ENV !== 'production') global.__erpPrisma = prisma;

module.exports = prisma;