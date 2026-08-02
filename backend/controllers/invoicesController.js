const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

exports.list = async (req, res, next) => {
  try {
    const invoices = await prisma.invoice.findMany({ include: { items: true, payments: true } });
    res.json(invoices);
  } catch (err) {
    next(err);
  }
};

exports.get = async (req, res, next) => {
  try {
    const invoice = await prisma.invoice.findUnique({ where: { id: req.params.id }, include: { items: true, payments: true } });
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    res.json(invoice);
  } catch (err) {
    next(err);
  }
};

// createInvoice: transactional - create invoice, items, decrement stock, update customer outstanding
exports.create = async (req, res, next) => {
  const data = req.body;
  const prismaTx = prisma;
  try {
    if (!data.customerId || !Array.isArray(data.items) || data.items.length === 0) {
      return res.status(400).json({ error: 'customerId and items[] are required' });
    }

    const result = await prismaTx.$transaction(async (tx) => {
      const customer = await tx.customer.findUnique({ where: { customerId: data.customerId } });
      if (!customer) throw new Error('Customer not found');

      // Validate and prepare items
      let total = 0;
      const resolvedItems = [];
      for (const item of data.items) {
        const sku = await tx.inventory.findUnique({ where: { skuId: item.skuId } });
        if (!sku) throw new Error(`SKU ${item.skuId} not found`);
        if (sku.stock < item.quantity) throw new Error(`${sku.name} does not have enough stock`);
        resolvedItems.push({ sku, item });
        total += Number(item.quantity) * Number(item.rate);
      }

      const invoice = await tx.invoice.create({ data: {
        invoiceId: data.invoiceId || `INV-${Date.now()}`,
        customerId: customer.id,
        issueDate: data.issueDate ? new Date(data.issueDate) : new Date(),
        dueDate: new Date(data.dueDate),
        status: data.status || 'draft',
        paidAmount: 0,
        total: total
      }});

      for (const { sku, item } of resolvedItems) {
        await tx.invoiceItem.create({ data: {
          invoiceId: invoice.id,
          skuId: sku.id,
          description: item.description || null,
          quantity: item.quantity,
          rate: item.rate
        }});

        // decrement stock
        await tx.inventory.update({ where: { id: sku.id }, data: { stock: { decrement: item.quantity } } });
      }

      // update customer outstanding
      await tx.customer.update({ where: { id: customer.id }, data: { outstanding: { increment: Number(total) } } });

      return invoice;
    });

    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
};

// recordPayment: update invoice paidAmount/status and customer outstanding
exports.recordPayment = async (req, res, next) => {
  const { id } = req.params; // invoice id
  const { amount, date, status } = req.body;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findUnique({ where: { id } , include: { items: true } });
      if (!invoice) throw new Error('Invoice not found');

      const balance = Number(invoice.total) - Number(invoice.paidAmount);
      if (amount <= 0) throw new Error('Payment amount must be greater than zero');
      if (amount > balance) throw new Error('Payment amount cannot exceed invoice balance');

      const updatedInvoice = await tx.invoice.update({ where: { id }, data: { paidAmount: { increment: Number(amount) }, status: (Number(invoice.paidAmount) + Number(amount) >= Number(invoice.total)) ? 'paid' : 'part_paid' } });

      // update customer outstanding
      await tx.customer.update({ where: { id: invoice.customerId }, data: { outstanding: { decrement: Number(amount) } } });

      const payment = await tx.payment.create({ data: {
        paymentId: `PAY-${Date.now()}`,
        invoiceId: invoice.id,
        type: 'incoming',
        amount: Number(amount),
        date: date ? new Date(date) : new Date(),
        status: status || 'reconciled'
      }});

      return { payment, invoice: updatedInvoice };
    });

    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
};
