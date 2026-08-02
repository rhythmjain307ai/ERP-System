const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

exports.listJobs = async (req, res, next) => {
  try {
    const jobs = await prisma.productionJob.findMany({ include: { product: true } });
    res.json(jobs);
  } catch (err) { next(err); }
};

exports.createJob = async (req, res, next) => {
  const data = req.body;
  try {
    if (!data.productSkuId && !data.productId) return res.status(400).json({ error: 'productSkuId or productId and plannedQuantity required' });
    if (!data.plannedQuantity) return res.status(400).json({ error: 'plannedQuantity required' });

    const product = await prisma.inventory.findUnique({ where: { skuId: data.productSkuId || data.productId } });
    if (!product) return res.status(404).json({ error: 'Product not found' });

    const job = await prisma.productionJob.create({ data: {
      jobId: data.jobId || `JOB-${Date.now()}`,
      productId: product.id,
      plannedQuantity: data.plannedQuantity,
      completedQuantity: 0,
      line: data.line || 'Line A',
      status: data.status || 'scheduled',
      startDate: data.startDate ? new Date(data.startDate) : new Date()
    }});

    res.status(201).json(job);
  } catch (err) { next(err); }
};

exports.updateProgress = async (req, res, next) => {
  const { id } = req.params;
  const { completedQuantity } = req.body;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const job = await tx.productionJob.findUnique({ where: { id } });
      if (!job) throw new Error('Production job not found');

      if (completedQuantity < 0 || completedQuantity > job.plannedQuantity) throw new Error('Completed quantity must be within planned quantity');

      const delta = completedQuantity - job.completedQuantity;

      const updated = await tx.productionJob.update({ where: { id }, data: { completedQuantity: completedQuantity, status: completedQuantity >= job.plannedQuantity ? 'completed' : 'running' } });

      if (delta > 0) {
        // increase finished goods stock
        await tx.inventory.update({ where: { id: job.productId }, data: { stock: { increment: delta } } });
      }

      return updated;
    });

    res.json(result);
  } catch (err) { next(err); }
};
