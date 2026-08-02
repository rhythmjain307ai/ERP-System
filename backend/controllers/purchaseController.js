const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

exports.list = async (req, res, next) => {
  try {
    const pos = await prisma.purchaseOrder.findMany({ include: { items: true } });
    res.json(pos);
  } catch (err) { next(err); }
};

exports.create = async (req, res, next) => {
  const data = req.body;
  try {
    if (!data.vendorId || !Array.isArray(data.items) || data.items.length === 0) {
      return res.status(400).json({ error: 'vendorId and items[] are required' });
    }

    const result = await prisma.$transaction(async (tx) => {
      const vendor = await tx.vendor.findUnique({ where: { vendorId: data.vendorId } });
      if (!vendor) throw new Error('Vendor not found');

      const po = await tx.purchaseOrder.create({ data: {
        poId: data.poId || `PO-${Date.now()}`,
        vendorId: vendor.id,
        orderDate: data.orderDate ? new Date(data.orderDate) : new Date(),
        expectedDate: data.expectedDate ? new Date(data.expectedDate) : null,
        status: data.status || 'draft'
      }});

      for (const item of data.items) {
        const sku = await tx.inventory.findUnique({ where: { skuId: item.skuId } });
        if (!sku) throw new Error(`SKU ${item.skuId} not found`);
        await tx.purchaseOrderItem.create({ data: {
          poId: po.id,
          skuId: sku.id,
          description: item.description || null,
          quantity: item.quantity,
          rate: item.rate
        }});
      }

      return po;
    });

    res.status(201).json(result);
  } catch (err) { next(err); }
};

exports.receive = async (req, res, next) => {
  const { id } = req.params; // purchaseOrder id
  try {
    const result = await prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.findUnique({ where: { id }, include: { items: true } });
      if (!po) throw new Error('Purchase order not found');
      if (po.status === 'received' || po.status === 'closed') throw new Error(`${po.poId} has already been received`);

      for (const item of po.items) {
        await tx.inventory.update({ where: { id: item.skuId }, data: { stock: { increment: item.quantity } } });
      }

      const updated = await tx.purchaseOrder.update({ where: { id }, data: { status: 'received' } });
      return updated;
    });

    res.json(result);
  } catch (err) { next(err); }
};
