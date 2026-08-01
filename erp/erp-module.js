(function registerForgeErpModule(root, factory) {
  const moduleApi = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = moduleApi;
  }

  root.ForgeERPModule = moduleApi;
})(typeof globalThis !== "undefined" ? globalThis : this, function createForgeErpModule() {
  const money = value => Math.round(Number(value || 0) * 100) / 100;
  const todayIso = () => new Date().toISOString().slice(0, 10);
  const nextId = (prefix, collection) => {
    const numbers = collection
      .map(item => Number(String(item.id).replace(/\D/g, "")))
      .filter(Number.isFinite);
    const nextNumber = numbers.length ? Math.max(...numbers) + 1 : 1;
    return `${prefix}-${String(nextNumber).padStart(4, "0")}`;
  };

  const state = {
    customers: [
      {
        id: "CUS-0001",
        name: "Acme Auto Parts",
        gstin: "27AAECA1234F1Z5",
        city: "Pune",
        creditLimit: 12000000,
        outstanding: 620000,
        contact: "Nisha Mehta",
        status: "active"
      },
      {
        id: "CUS-0002",
        name: "Prime Axles Ltd",
        gstin: "06AABCP4567K1Z2",
        city: "Faridabad",
        creditLimit: 18000000,
        outstanding: 1070000,
        contact: "Karan Sethi",
        status: "active"
      },
      {
        id: "CUS-0003",
        name: "Nexon Heavy Tools",
        gstin: "24AACCN8192R1Z8",
        city: "Rajkot",
        creditLimit: 9000000,
        outstanding: 210000,
        contact: "Dev Patel",
        status: "active"
      }
    ],
    vendors: [
      {
        id: "VEN-0001",
        name: "Bharat Steel Traders",
        category: "Raw material",
        leadTimeDays: 4,
        outstanding: 1460000,
        status: "preferred"
      },
      {
        id: "VEN-0002",
        name: "Indo Furnace Services",
        category: "Maintenance",
        leadTimeDays: 2,
        outstanding: 280000,
        status: "active"
      },
      {
        id: "VEN-0003",
        name: "Shakti Logistics",
        category: "Freight",
        leadTimeDays: 1,
        outstanding: 130000,
        status: "active"
      }
    ],
    inventory: [
      {
        id: "SKU-EN8-ROUND",
        name: "EN-8 Steel Rounds",
        type: "raw",
        warehouse: "Warehouse 2",
        unit: "kg",
        stock: 4200,
        reorderLevel: 6000,
        averageCost: 82
      },
      {
        id: "SKU-SHAFT-48",
        name: "Forged Shafts 48mm",
        type: "finished",
        warehouse: "Warehouse 1",
        unit: "pcs",
        stock: 1240,
        reorderLevel: 320,
        averageCost: 680
      },
      {
        id: "SKU-DIE-LUBE",
        name: "Die Lubricant",
        type: "consumable",
        warehouse: "Stores",
        unit: "litre",
        stock: 82,
        reorderLevel: 120,
        averageCost: 210
      }
    ],
    invoices: [
      {
        id: "INV-2051",
        customerId: "CUS-0002",
        issueDate: "2026-07-18",
        dueDate: "2026-07-30",
        status: "sent",
        items: [
          { skuId: "SKU-SHAFT-48", description: "Forged Shafts 48mm", quantity: 900, rate: 988.89 }
        ],
        paidAmount: 0
      },
      {
        id: "INV-2050",
        customerId: "CUS-0001",
        issueDate: "2026-07-17",
        dueDate: "2026-07-28",
        status: "draft",
        items: [
          { skuId: "SKU-SHAFT-48", description: "Forged Shafts 48mm", quantity: 420, rate: 1000 }
        ],
        paidAmount: 0
      }
    ],
    purchaseOrders: [
      {
        id: "PO-4109",
        vendorId: "VEN-0001",
        orderDate: "2026-07-23",
        expectedDate: "2026-07-26",
        status: "in_transit",
        items: [
          { skuId: "SKU-EN8-ROUND", description: "EN-8 Steel Rounds", quantity: 10000, rate: 84 }
        ]
      }
    ],
    productionJobs: [
      {
        id: "JOB-7782",
        productSkuId: "SKU-SHAFT-48",
        plannedQuantity: 1400,
        completedQuantity: 1036,
        line: "Line A",
        status: "running",
        startDate: "2026-07-24"
      },
      {
        id: "JOB-7783",
        productSkuId: "SKU-SHAFT-48",
        plannedQuantity: 850,
        completedQuantity: 0,
        line: "Line B",
        status: "scheduled",
        startDate: "2026-07-26"
      }
    ],
    expenses: [
      { id: "EXP-0001", category: "Power & Fuel", date: "2026-07-20", amount: 1240000, status: "posted" },
      { id: "EXP-0002", category: "Maintenance", date: "2026-07-21", amount: 86000, status: "approved" },
      { id: "EXP-0003", category: "Factory Admin", date: "2026-07-22", amount: 38000, status: "posted" }
    ],
    payments: [
      { id: "PAY-0001", invoiceId: "INV-2049", type: "incoming", date: "2026-07-22", amount: 270000, status: "reconciled" },
      { id: "PAY-0002", vendorId: "VEN-0001", type: "outgoing", date: "2026-07-25", amount: 1460000, status: "scheduled" }
    ]
  };

  const collectionNames = Object.keys(state);
  const listeners = new Set();

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function emit(eventName, payload) {
    const event = { name: eventName, payload: clone(payload), at: new Date().toISOString() };
    listeners.forEach(listener => listener(event));
  }

  function sum(collection, selector) {
    return money(collection.reduce((total, item) => total + Number(selector(item) || 0), 0));
  }

  function invoiceTotal(invoice) {
    return money(invoice.items.reduce((total, item) => total + item.quantity * item.rate, 0));
  }

  function findById(collectionName, id) {
    const collection = state[collectionName];
    if (!collection) {
      throw new Error(`Unknown ERP collection: ${collectionName}`);
    }

    return collection.find(item => item.id === id) || null;
  }

  function requireRecord(collectionName, id) {
    const record = findById(collectionName, id);
    if (!record) {
      throw new Error(`Could not find ${collectionName} record ${id}`);
    }

    return record;
  }

  function updateStock(skuId, quantityChange) {
    const item = requireRecord("inventory", skuId);
    const nextStock = item.stock + Number(quantityChange || 0);

    if (nextStock < 0) {
      throw new Error(`${item.name} does not have enough stock`);
    }

    item.stock = money(nextStock);
    return item;
  }

  function listRecords(collectionName, filters) {
    const collection = state[collectionName];
    if (!collection) {
      throw new Error(`Unknown ERP collection: ${collectionName}`);
    }

    let records = collection;
    Object.entries(filters || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        records = records.filter(record => String(record[key]).toLowerCase() === String(value).toLowerCase());
      }
    });

    return clone(records);
  }

  function getRecord(collectionName, id) {
    return clone(requireRecord(collectionName, id));
  }

  function getDashboardSummary() {
    const invoiceTotals = state.invoices.map(invoice => ({
      ...invoice,
      total: invoiceTotal(invoice),
      balance: money(invoiceTotal(invoice) - invoice.paidAmount)
    }));
    const sales = sum(invoiceTotals, invoice => invoice.total);
    const receivables = sum(invoiceTotals, invoice => invoice.balance);
    const inventoryValue = sum(state.inventory, item => item.stock * item.averageCost);
    const expenses = sum(state.expenses, expense => expense.amount);
    const purchaseCommitments = sum(state.purchaseOrders, order =>
      order.status === "closed" ? 0 : order.items.reduce((total, item) => total + item.quantity * item.rate, 0)
    );
    const runningJobs = state.productionJobs.filter(job => job.status === "running").length;
    const lowStockItems = state.inventory.filter(item => item.stock <= item.reorderLevel);

    return clone({
      sales,
      receivables,
      inventoryValue,
      expenses,
      purchaseCommitments: money(purchaseCommitments),
      grossProfit: money(sales - expenses),
      activeCustomers: state.customers.filter(customer => customer.status === "active").length,
      openInvoices: invoiceTotals.filter(invoice => invoice.status !== "paid").length,
      runningJobs,
      lowStockCount: lowStockItems.length,
      lowStockItems
    });
  }

  function getAlerts() {
    const overdueInvoices = state.invoices
      .filter(invoice => invoice.status !== "paid" && invoice.dueDate < todayIso())
      .map(invoice => ({
        id: `ALERT-${invoice.id}`,
        type: "receivable",
        severity: "high",
        title: `${invoice.id} is overdue`,
        recordId: invoice.id
      }));

    const lowStock = state.inventory
      .filter(item => item.stock <= item.reorderLevel)
      .map(item => ({
        id: `ALERT-${item.id}`,
        type: "inventory",
        severity: item.stock <= item.reorderLevel * 0.6 ? "high" : "medium",
        title: `${item.name} below reorder level`,
        recordId: item.id
      }));

    const delayedJobs = state.productionJobs
      .filter(job => job.status === "delayed")
      .map(job => ({
        id: `ALERT-${job.id}`,
        type: "production",
        severity: "medium",
        title: `${job.id} delayed on ${job.line}`,
        recordId: job.id
      }));

    return clone([...overdueInvoices, ...lowStock, ...delayedJobs]);
  }

  function search(query) {
    const term = String(query || "").trim().toLowerCase();
    if (!term) {
      return [];
    }

    return collectionNames.flatMap(collectionName =>
      state[collectionName]
        .filter(record => JSON.stringify(record).toLowerCase().includes(term))
        .map(record => ({ collection: collectionName, record: clone(record) }))
    );
  }

  function createCustomer(input) {
    const customer = {
      id: nextId("CUS", state.customers),
      name: input.name,
      gstin: input.gstin || "",
      city: input.city || "",
      creditLimit: money(input.creditLimit || 0),
      outstanding: 0,
      contact: input.contact || "",
      status: input.status || "active"
    };

    if (!customer.name) {
      throw new Error("Customer name is required");
    }

    state.customers.push(customer);
    emit("customer.created", customer);
    return clone(customer);
  }

  function createInvoice(input) {
    const customer = requireRecord("customers", input.customerId);
    const items = (input.items || []).map(item => {
      const sku = requireRecord("inventory", item.skuId);
      return {
        skuId: sku.id,
        description: item.description || sku.name,
        quantity: Number(item.quantity),
        rate: money(item.rate)
      };
    });

    if (!items.length) {
      throw new Error("Invoice requires at least one line item");
    }

    items.forEach(item => updateStock(item.skuId, -item.quantity));

    const invoice = {
      id: nextId("INV", state.invoices),
      customerId: customer.id,
      issueDate: input.issueDate || todayIso(),
      dueDate: input.dueDate,
      status: input.status || "draft",
      items,
      paidAmount: 0
    };

    if (!invoice.dueDate) {
      throw new Error("Invoice dueDate is required");
    }

    state.invoices.push(invoice);
    customer.outstanding = money(customer.outstanding + invoiceTotal(invoice));
    emit("invoice.created", invoice);
    return clone({ ...invoice, total: invoiceTotal(invoice) });
  }

  function recordPayment(input) {
    const invoice = requireRecord("invoices", input.invoiceId);
    const customer = requireRecord("customers", invoice.customerId);
    const amount = money(input.amount);

    if (amount <= 0) {
      throw new Error("Payment amount must be greater than zero");
    }

    const balance = money(invoiceTotal(invoice) - invoice.paidAmount);
    if (amount > balance) {
      throw new Error("Payment amount cannot exceed invoice balance");
    }

    invoice.paidAmount = money(invoice.paidAmount + amount);
    invoice.status = invoice.paidAmount >= invoiceTotal(invoice) ? "paid" : "part_paid";
    customer.outstanding = money(Math.max(0, customer.outstanding - amount));

    const payment = {
      id: nextId("PAY", state.payments),
      invoiceId: invoice.id,
      type: "incoming",
      date: input.date || todayIso(),
      amount,
      status: input.status || "reconciled"
    };

    state.payments.push(payment);
    emit("payment.recorded", payment);
    return clone(payment);
  }

  function createPurchaseOrder(input) {
    const vendor = requireRecord("vendors", input.vendorId);
    const items = (input.items || []).map(item => {
      const sku = requireRecord("inventory", item.skuId);
      return {
        skuId: sku.id,
        description: item.description || sku.name,
        quantity: Number(item.quantity),
        rate: money(item.rate)
      };
    });

    if (!items.length) {
      throw new Error("Purchase order requires at least one line item");
    }

    const order = {
      id: nextId("PO", state.purchaseOrders),
      vendorId: vendor.id,
      orderDate: input.orderDate || todayIso(),
      expectedDate: input.expectedDate || "",
      status: input.status || "draft",
      items
    };

    state.purchaseOrders.push(order);
    emit("purchaseOrder.created", order);
    return clone(order);
  }

  function receivePurchaseOrder(orderId) {
    const order = requireRecord("purchaseOrders", orderId);

    if (order.status === "received" || order.status === "closed") {
      throw new Error(`${order.id} has already been received`);
    }

    order.items.forEach(item => updateStock(item.skuId, item.quantity));
    order.status = "received";
    emit("purchaseOrder.received", order);
    return clone(order);
  }

  function createProductionJob(input) {
    const sku = requireRecord("inventory", input.productSkuId);
    const job = {
      id: nextId("JOB", state.productionJobs),
      productSkuId: sku.id,
      plannedQuantity: Number(input.plannedQuantity),
      completedQuantity: 0,
      line: input.line || "Line A",
      status: input.status || "scheduled",
      startDate: input.startDate || todayIso()
    };

    if (job.plannedQuantity <= 0) {
      throw new Error("Production job quantity must be greater than zero");
    }

    state.productionJobs.push(job);
    emit("productionJob.created", job);
    return clone(job);
  }

  function updateProductionProgress(jobId, completedQuantity) {
    const job = requireRecord("productionJobs", jobId);
    const quantity = Number(completedQuantity);

    if (quantity < 0 || quantity > job.plannedQuantity) {
      throw new Error("Completed quantity must be within planned quantity");
    }

    const delta = quantity - job.completedQuantity;
    job.completedQuantity = quantity;
    job.status = quantity >= job.plannedQuantity ? "completed" : "running";

    if (delta > 0) {
      updateStock(job.productSkuId, delta);
    }

    emit("productionJob.updated", job);
    return clone(job);
  }

  function getState() {
    return clone(state);
  }

  function subscribe(listener) {
    if (typeof listener !== "function") {
      throw new Error("Subscriber must be a function");
    }

    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return {
    listRecords,
    getRecord,
    getState,
    getDashboardSummary,
    getAlerts,
    search,
    createCustomer,
    createInvoice,
    recordPayment,
    createPurchaseOrder,
    receivePurchaseOrder,
    createProductionJob,
    updateProductionProgress,
    subscribe
  };
});