const express = require('express');
const customersRouter = require('./routes/customers');
const invoicesRouter = require('./routes/invoices');
const purchaseRouter = require('./routes/purchaseOrders');
const productionRouter = require('./routes/production');
const inventoryRouter = require('./routes/inventory');

const app = express();
app.use(express.json());

app.use('/api/customers', customersRouter);
app.use('/api/invoices', invoicesRouter);
app.use('/api/purchase-orders', purchaseRouter);
app.use('/api/production', productionRouter);
app.use('/api/inventory', inventoryRouter);

app.get('/health', (req, res) => res.json({ ok: true }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Internal error' });
});

module.exports = app;
