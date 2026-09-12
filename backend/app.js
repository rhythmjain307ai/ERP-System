const express = require('express');
const serialize = require('./lib/serialize');
const errorHandler = require('./middleware/errors');
const { createRoutes } = require('./routes/moduleRoutes');

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  const json = res.json.bind(res);
  res.json = (body) => json(serialize(body));
  next();
});

const routes = createRoutes();
app.use('/api/master', routes.master);
app.use('/api/inventory', routes.inventory);
app.use('/api/procurement', routes.procurement);
app.use('/api/sales', routes.sales);
app.use('/api/documents', routes.documents);
app.use('/api/approvals', routes.approvals);
app.use('/api/weighbridge-tickets', routes.weighbridgeTickets);
app.use('/api/customers', routes.customers);
app.use('/api/vendors', routes.vendors);

app.get('/health', (req, res) => res.json({ ok: true }));

app.use((req, res) => res.status(404).json({ success: false, error: { message: 'Route not found' } }));
app.use(errorHandler);

module.exports = app;
