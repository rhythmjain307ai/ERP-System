const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

exports.list = async (req, res, next) => {
  try {
    const customers = await prisma.customer.findMany();
    res.json(customers);
  } catch (err) {
    next(err);
  }
};

exports.get = async (req, res, next) => {
  try {
    const customer = await prisma.customer.findUnique({ where: { id: req.params.id } });
    if (!customer) return res.status(404).json({ error: 'Customer not found' });
    res.json(customer);
  } catch (err) {
    next(err);
  }
};

exports.create = async (req, res, next) => {
  try {
    const payload = req.body;
    if (!payload.companyName) return res.status(400).json({ error: 'companyName is required' });
    const created = await prisma.customer.create({ data: {
      customerId: payload.customerId || `CUS-${Date.now()}`,
      companyName: payload.companyName,
      gstin: payload.gstin || null,
      city: payload.city || null,
      contact: payload.contact || null,
      creditLimit: payload.creditLimit || 0,
      outstanding: 0,
      status: payload.status || 'active'
    }});
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
};

exports.update = async (req, res, next) => {
  try {
    const payload = req.body;
    const updated = await prisma.customer.update({ where: { id: req.params.id }, data: payload });
    res.json(updated);
  } catch (err) {
    next(err);
  }
};

exports.remove = async (req, res, next) => {
  try {
    await prisma.customer.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
};
