const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

exports.list = async (req, res, next) => {
  try {
    const items = await prisma.inventory.findMany();
    res.json(items);
  } catch (err) { next(err); }
};

exports.lowStock = async (req, res, next) => {
  try {
    const all = await prisma.inventory.findMany();
    const low = all.filter(i => i.stock <= i.reorderLevel);
    res.json(low);
  } catch (err) { next(err); }
};

exports.updateStock = async (req, res, next) => {
  try {
    const { skuId, quantityChange } = req.body;
    if (!skuId) return res.status(400).json({ error: 'skuId required' });
    const sku = await prisma.inventory.findUnique({ where: { skuId } });
    if (!sku) return res.status(404).json({ error: 'SKU not found' });
    if (sku.stock + Number(quantityChange) < 0) return res.status(400).json({ error: 'Insufficient stock' });
    const updated = await prisma.inventory.update({ where: { id: sku.id }, data: { stock: sku.stock + Number(quantityChange) } });
    res.json(updated);
  } catch (err) { next(err); }
};
