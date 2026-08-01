const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // Customers
  const customersData = [
    {
      customerId: 'CUS-0001',
      companyName: 'Acme Auto Parts',
      gstin: '27AAECA1234F1Z5',
      city: 'Pune',
      creditLimit: 12000000,
      outstanding: 620000,
      contact: 'Nisha Mehta',
      status: 'active'
    },
    {
      customerId: 'CUS-0002',
      companyName: 'Prime Axles Ltd',
      gstin: '06AABCP4567K1Z2',
      city: 'Faridabad',
      creditLimit: 18000000,
      outstanding: 1070000,
      contact: 'Karan Sethi',
      status: 'active'
    },
    {
      customerId: 'CUS-0003',
      companyName: 'Nexon Heavy Tools',
      gstin: '24AACCN8192R1Z8',
      city: 'Rajkot',
      creditLimit: 9000000,
      outstanding: 210000,
      contact: 'Dev Patel',
      status: 'active'
    }
  ];

  for (const c of customersData) {
    await prisma.customer.upsert({
      where: { customerId: c.customerId },
      update: c,
      create: c
    });
  }

  // Vendors
  const vendorsData = [
    { vendorId: 'VEN-0001', companyName: 'Bharat Steel Traders', category: 'Raw material', leadTimeDays: 4, outstanding: 1460000, status: 'preferred' },
    { vendorId: 'VEN-0002', companyName: 'Indo Furnace Services', category: 'Maintenance', leadTimeDays: 2, outstanding: 280000, status: 'active' },
    { vendorId: 'VEN-0003', companyName: 'Shakti Logistics', category: 'Freight', leadTimeDays: 1, outstanding: 130000, status: 'active' }
  ];

  for (const v of vendorsData) {
    await prisma.vendor.upsert({ where: { vendorId: v.vendorId }, update: v, create: v });
  }

  // Inventory
  const inventoryData = [
    { skuId: 'SKU-EN8-ROUND', name: 'EN-8 Steel Rounds', type: 'raw', warehouse: 'Warehouse 2', unit: 'kg', stock: 4200, reorderLevel: 6000, averageCost: 82 },
    { skuId: 'SKU-SHAFT-48', name: 'Forged Shafts 48mm', type: 'finished', warehouse: 'Warehouse 1', unit: 'pcs', stock: 1240, reorderLevel: 320, averageCost: 680 },
    { skuId: 'SKU-DIE-LUBE', name: 'Die Lubricant', type: 'consumable', warehouse: 'Stores', unit: 'litre', stock: 82, reorderLevel: 120, averageCost: 210 }
  ];

  for (const i of inventoryData) {
    await prisma.inventory.upsert({ where: { skuId: i.skuId }, update: i, create: i });
  }

  // Expenses
  const expensesData = [
    { expenseId: 'EXP-0001', category: 'Power & Fuel', date: new Date('2026-07-20'), amount: 1240000, status: 'posted' },
    { expenseId: 'EXP-0002', category: 'Maintenance', date: new Date('2026-07-21'), amount: 86000, status: 'approved' },
    { expenseId: 'EXP-0003', category: 'Factory Admin', date: new Date('2026-07-22'), amount: 38000, status: 'posted' }
  ];

  for (const e of expensesData) {
    await prisma.expense.upsert({ where: { expenseId: e.expenseId }, update: e, create: e });
  }

  // Purchase Orders
  const poData = [
    {
      poId: 'PO-4109',
      vendorId: (await prisma.vendor.findUnique({ where: { vendorId: 'VEN-0001' } })).id,
      orderDate: new Date('2026-07-23'),
      expectedDate: new Date('2026-07-26'),
      status: 'in_transit'
    }
  ];

  for (const p of poData) {
    await prisma.purchaseOrder.upsert({ where: { poId: p.poId }, update: p, create: p });
  }

  // Production Jobs
  const jobsData = [
    { jobId: 'JOB-7782', productId: (await prisma.inventory.findUnique({ where: { skuId: 'SKU-SHAFT-48' } })).id, plannedQuantity: 1400, completedQuantity: 1036, line: 'Line A', status: 'running', startDate: new Date('2026-07-24') },
    { jobId: 'JOB-7783', productId: (await prisma.inventory.findUnique({ where: { skuId: 'SKU-SHAFT-48' } })).id, plannedQuantity: 850, completedQuantity: 0, line: 'Line B', status: 'scheduled', startDate: new Date('2026-07-26') }
  ];

  for (const j of jobsData) {
    await prisma.productionJob.upsert({ where: { jobId: j.jobId }, update: j, create: j });
  }

  // Invoices and invoice items
  const invoicesData = [
    {
      invoiceId: 'INV-2051',
      customerId: (await prisma.customer.findUnique({ where: { customerId: 'CUS-0002' } })).id,
      issueDate: new Date('2026-07-18'),
      dueDate: new Date('2026-07-30'),
      status: 'sent',
      paidAmount: 0,
      total: 900 * 988.89
    },
    {
      invoiceId: 'INV-2050',
      customerId: (await prisma.customer.findUnique({ where: { customerId: 'CUS-0001' } })).id,
      issueDate: new Date('2026-07-17'),
      dueDate: new Date('2026-07-28'),
      status: 'draft',
      paidAmount: 0,
      total: 420 * 1000
    }
  ];

  for (const inv of invoicesData) {
    await prisma.invoice.upsert({ where: { invoiceId: inv.invoiceId }, update: inv, create: inv });
  }

  // Create invoice items linking to inventory and invoices
  const inv2051 = await prisma.invoice.findUnique({ where: { invoiceId: 'INV-2051' } });
  const inv2050 = await prisma.invoice.findUnique({ where: { invoiceId: 'INV-2050' } });
  const skuShaft = await prisma.inventory.findUnique({ where: { skuId: 'SKU-SHAFT-48' } });

  await prisma.invoiceItem.upsert({
    where: { id: 'invitem-1' },
    update: { description: 'Forged Shafts 48mm', quantity: 900, rate: 988.89, skuId: skuShaft.id, invoiceId: inv2051.id },
    create: { id: 'invitem-1', description: 'Forged Shafts 48mm', quantity: 900, rate: 988.89, skuId: skuShaft.id, invoiceId: inv2051.id }
  });

  await prisma.invoiceItem.upsert({
    where: { id: 'invitem-2' },
    update: { description: 'Forged Shafts 48mm', quantity: 420, rate: 1000, skuId: skuShaft.id, invoiceId: inv2050.id },
    create: { id: 'invitem-2', description: 'Forged Shafts 48mm', quantity: 420, rate: 1000, skuId: skuShaft.id, invoiceId: inv2050.id }
  });

  // Payments
  const paymentsData = [
    { paymentId: 'PAY-0001', invoiceId: inv2051.id, type: 'incoming', date: new Date('2026-07-22'), amount: 270000, status: 'reconciled' },
    { paymentId: 'PAY-0002', vendorId: (await prisma.vendor.findUnique({ where: { vendorId: 'VEN-0001' } })).id, type: 'outgoing', date: new Date('2026-07-25'), amount: 1460000, status: 'scheduled' }
  ];

  for (const p of paymentsData) {
    await prisma.payment.upsert({ where: { paymentId: p.paymentId }, update: p, create: p });
  }

  console.log('Seeding complete');
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
