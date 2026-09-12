const prisma = require('../lib/prisma');
const { NotFoundError, ValidationError } = require('../lib/errors');

function toId(value) {
  try { return BigInt(value); } catch { throw new ValidationError('id must be an integer'); }
}

function makeCrud({ model, idField, fields, requiredFields = [], searchFields = [], statusField, responseSelect }) {
  const pick = (body) => Object.fromEntries(Object.entries(body).filter(([key]) => fields.includes(key)));
  const selected = (args) => responseSelect ? { ...args, select: responseSelect } : args;
  return {
    list: async (req, res) => {
      const page = Math.max(Number(req.query.page) || 1, 1);
      const pageSize = Math.min(Math.max(Number(req.query.pageSize) || 25, 1), 100);
      const where = {};
      if (req.query.status && statusField) where[statusField] = req.query.status;
      if (req.query.search && searchFields.length) where.OR = searchFields.map((field) => ({ [field]: { contains: req.query.search, mode: 'insensitive' } }));
      const [data, total] = await prisma.$transaction([
        prisma[model].findMany(selected({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: { [idField]: 'desc' } })),
        prisma[model].count({ where })
      ]);
      res.json({ success: true, data, meta: { page, pageSize, total, pageCount: Math.ceil(total / pageSize) } });
    },
    get: async (req, res) => {
      const data = await prisma[model].findUnique(selected({ where: { [idField]: toId(req.params.id) } }));
      if (!data) throw new NotFoundError(model);
      res.json({ success: true, data });
    },
    create: async (req, res) => {
      const missing = requiredFields.filter((field) => req.body[field] === undefined || req.body[field] === null);
      if (missing.length) throw new ValidationError('Required fields are missing', { fields: missing });
      const data = await prisma[model].create(selected({ data: pick(req.body) }));
      res.status(201).json({ success: true, data });
    },
    update: async (req, res) => {
      const data = await prisma[model].update(selected({ where: { [idField]: toId(req.params.id) }, data: pick(req.body) }));
      res.json({ success: true, data });
    },
    remove: async (req, res) => {
      await prisma[model].delete({ where: { [idField]: toId(req.params.id) } });
      res.status(204).end();
    }
  };
}

module.exports = makeCrud;