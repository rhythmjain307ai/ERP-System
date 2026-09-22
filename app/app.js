const appState = {
  activeView: "dashboard",
  activeModule: "customers",
  titles: {
    dashboard: "Dashboard",
    operations: "Operations",
    documents: "Documents",
    analytics: "Analytics",
    profile: "Profile"
  }
};

const moduleData = {
  customers: {
    title: "Customers",
    subtitle: "Customer list, details, ledger, outstanding payments",
    rows: [
      ["Acme Auto Parts", "Ledger ₹28.4L · Outstanding ₹6.2L", "AA"],
      ["Prime Axles Ltd", "Ledger ₹42.8L · Outstanding ₹10.7L", "PA"],
      ["Nexon Heavy Tools", "Ledger ₹18.9L · Outstanding ₹2.1L", "NH"]
    ],
    amountLabel: "Customers"
  },
  vendors: {
    title: "Vendors",
    subtitle: "Vendor details, purchase history, outstanding bills",
    rows: [
      ["Bharat Steel Traders", "EN-8 rounds · Bills due ₹14.6L", "BS"],
      ["Indo Furnace Services", "Maintenance · Bills due ₹2.8L", "IF"],
      ["Shakti Logistics", "Freight · Bills due ₹1.3L", "SL"]
    ],
    amountLabel: "Vendors"
  },
  invoices: {
    title: "Invoices",
    subtitle: "Invoice list, details, create flow, PDF preview",
    rows: [
      ["INV-2051", "Prime Axles Ltd · Due in 6 days", "₹8.9L"],
      ["INV-2050", "Acme Auto Parts · Awaiting approval", "₹4.2L"],
      ["INV-2049", "Nexon Heavy Tools · Paid", "₹2.7L"]
    ],
    amountLabel: "Invoices"
  },
  purchase: {
    title: "Purchase Management",
    subtitle: "Purchase orders, vendor bills, live tracking",
    rows: [
      ["PO-4109", "EN-8 steel bars · Delivery tomorrow", "₹8.4L"],
      ["VB-8821", "Vendor bill review · GST matched", "₹3.1L"],
      ["PO-4108", "Consumables · In transit", "₹74K"]
    ],
    amountLabel: "Open"
  },
  inventory: {
    title: "Inventory",
    subtitle: "Raw materials, finished goods, stock movement, warehouses",
    rows: [
      ["EN-8 Steel", "Raw material · Low stock alert", "4.2T"],
      ["Forged Shafts 48mm", "Finished goods · Warehouse 1", "1,240"],
      ["Die Lubricant", "Stock movement · Issued to Line B", "82L"]
    ],
    amountLabel: "Items"
  },
  production: {
    title: "Production",
    subtitle: "Production orders, job status, machines, work orders",
    rows: [
      ["JOB-7782", "Crankshaft forging · 74% complete", "Line A"],
      ["Machine H-12", "Hydraulic press · Running", "OEE 86%"],
      ["WO-3321", "Heat treatment · Delayed 42 min", "Alert"]
    ],
    amountLabel: "Jobs"
  },
  payments: {
    title: "Payments",
    subtitle: "Incoming, outgoing, bank reconciliation",
    rows: [
      ["Incoming", "Acme Auto Parts · UTR matched", "₹6.2L"],
      ["Outgoing", "Bharat Steel Traders · Scheduled", "₹14.6L"],
      ["Bank Reconciliation", "3 entries need review", "3"]
    ],
    amountLabel: "Pending"
  },
  expenses: {
    title: "Expenses",
    subtitle: "Expense list, categories, add expense",
    rows: [
      ["Power & Fuel", "Furnace usage · July", "₹12.4L"],
      ["Maintenance", "Press H-12 service", "₹86K"],
      ["Factory Admin", "Safety equipment", "₹38K"]
    ],
    amountLabel: "Categories"
  }
};

const screenTitle = document.getElementById("screenTitle");
const moduleStack = document.getElementById("moduleStack");
const toast = document.getElementById("toast");
const fab = document.getElementById("fab");

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 1800);
}

function showAuth(screen) {
  document.querySelectorAll(".screen").forEach(item => {
    item.classList.toggle("is-active", item.dataset.screen === screen);
  });
  if (screen === "login") {
    document.querySelector('[data-screen="login"]').classList.add("is-active");
  }
}

function enterApp() {
  document.querySelectorAll(".screen").forEach(item => item.classList.remove("is-active"));
  document.querySelector('[data-screen="app"]').classList.add("is-active");
  routeTo("dashboard");
}

function routeTo(view) {
  appState.activeView = view;
  document.querySelectorAll(".content-view").forEach(item => {
    item.classList.toggle("is-active", item.dataset.view === view);
  });
  document.querySelectorAll(".bottom-nav button").forEach(item => {
    item.classList.toggle("is-active", item.dataset.route === view);
  });
  screenTitle.textContent = appState.titles[view];
  fab.style.display = view === "profile" ? "none" : "grid";
  if (view === "documents") loadDocuments();
}

function renderModule(name) {
  if (name === "purchase") return renderProcurement();
  if (name === "sales") return renderSales();
  if (name === "inventory") return renderInventory();
  const module = moduleData[name];
  appState.activeModule = name;
  moduleStack.innerHTML = `
    <article class="module-card">
      <header>
        <div>
          <strong>${module.title}</strong>
          <small>${module.subtitle}</small>
        </div>
        <span class="status-pill good">${module.amountLabel}</span>
      </header>
      ${module.rows.map(row => `
        <div class="row">
          <div>
            <strong>${row[0]}</strong>
            <small>${row[1]}</small>
          </div>
          <span class="amount">${row[2]}</span>
        </div>
      `).join("")}
    </article>
    <div class="state-row">
      <article class="state-card skeleton"><span></span><b></b><small></small></article>
      <article class="state-card empty">
        <strong>No errors</strong>
        <small>Error states and empty results use quiet, actionable cards.</small>
      </article>
    </div>
  `;
}

function workflowApi(path, options = {}) {
  const token = authToken();
  if (!token) return Promise.reject(new Error('Your ERP session is not connected. Sign in again to continue.'));
  const headers = { ...(options.headers || {}), Authorization: `Bearer ${token}` };
  if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  return fetch(`/api${path}`, { ...options, headers }).then(async response => {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.error?.message || `Request failed (${response.status})`);
      error.status = response.status;
      throw error;
    }
    return body;
  });
}

const workflowState = { vendors: [], items: [], warehouses: [], purchaseOrders: [], grns: [], selectedPo: null, customers: [], orders: [], invoices: [], deliveries: [], lots: [] };

function optionMarkup(records, valueKey, label) {
  return records.map(record => `<option value="${escapeHtml(record[valueKey])}">${escapeHtml(label(record))}</option>`).join('');
}

function workflowError(error) {
  if (error.status === 401) return 'Your ERP session has expired. Sign in again to continue.';
  if (error.status === 403) return 'You do not have permission to perform this action.';
  if (error.message === 'Failed to fetch') return 'The ERP server could not be reached. Check that the backend is running.';
  return error.message;
}

async function loadWorkflowData() {
  const [vendors, items, warehouses, purchaseOrders, grns] = await Promise.all([
    workflowApi('/master/vendors?pageSize=100'), workflowApi('/inventory/items?pageSize=100'), workflowApi('/inventory/warehouses?pageSize=100'),
    workflowApi('/procurement/purchase-orders?pageSize=100'), workflowApi('/procurement/grns?pageSize=100&status=PENDING')
  ]);
  workflowState.vendors = vendors.data;
  workflowState.items = items.data;
  workflowState.warehouses = warehouses.data;
  workflowState.purchaseOrders = purchaseOrders.data;
  workflowState.grns = grns.data;
}

function procurementShell(content) {
  moduleStack.innerHTML = `<div class="workflow-view"><div class="workflow-title"><div><p class="eyebrow">Procurement control</p><h3>Purchase order to receipt</h3><small>Build orders, record receipts, inspect, and post accepted stock.</small></div><span class="status-pill good">Live API</span></div>${content}</div>`;
}

function renderProcurementLoading(message = 'Loading procurement data…') { procurementShell(`<p class="empty-copy workflow-message">${escapeHtml(message)}</p>`); }

function renderProcurement() {
  renderProcurementLoading();
  loadWorkflowData().then(() => renderProcurementHome()).catch(error => renderProcurementLoading(workflowError(error)));
}

function renderProcurementHome() {
  const poRows = workflowState.purchaseOrders.length ? workflowState.purchaseOrders.map(po => `<article class="workflow-row"><div><strong>${escapeHtml(po.po_number)}</strong><small>${escapeHtml(po.vendor?.vendor_name || 'Vendor')} · ${po.purchase_order_item.length} line(s) · ${escapeHtml(po.status)}</small></div><div class="workflow-row-actions"><span class="status-pill ${po.status === 'RECEIVED' ? 'good' : 'warn'}">${escapeHtml(po.status)}</span><button class="mini-btn" type="button" data-po-id="${po.purchase_order_id}">Open</button><button class="mini-btn" type="button" data-create-grn-po="${po.purchase_order_id}">Receive</button></div></article>`).join('') : '<p class="empty-copy">No purchase orders match the current filters.</p>';
  const grnRows = workflowState.grns.length ? workflowState.grns.map(grn => `<article class="workflow-row"><div><strong>${escapeHtml(grn.grn_number)}</strong><small>${escapeHtml(grn.vendor?.vendor_name || 'Vendor')} · ${escapeHtml(grn.warehouse?.warehouse_name || 'Warehouse')} · ${escapeHtml(grn.purchase_order?.po_number || 'No PO')}</small></div><div class="workflow-row-actions"><span class="status-pill warn">${escapeHtml(grn.inspection_status)}</span><button class="mini-btn" type="button" data-grn-id="${grn.grn_id}">Inspect</button></div></article>`).join('') : '<p class="empty-copy">No pending GRNs need inspection.</p>';
  procurementShell(`<div class="workflow-actions"><button class="primary-btn small workflow-button" type="button" data-workflow="new-po">Create purchase order</button><button class="mini-btn" type="button" data-workflow="new-grn">Create GRN</button></div><section class="panel workflow-panel"><div class="section-head"><h3>Purchase orders</h3><span class="status-pill">${workflowState.purchaseOrders.length}</span></div><div class="workflow-filters"><input id="poSearch" placeholder="Search PO or vendor" aria-label="Search purchase orders"><select id="poStatus" aria-label="Purchase order status"><option value="">All statuses</option><option>DRAFT</option><option>SENT</option><option>PARTIALLY_RECEIVED</option><option>RECEIVED</option></select></div><div class="workflow-list" id="purchaseOrderList">${poRows}</div></section><section class="panel workflow-panel"><div class="section-head"><h3>Pending GRNs</h3><span class="status-pill warn">${workflowState.grns.length}</span></div><div class="workflow-list">${grnRows}</div></section><section id="workflowPane" class="workflow-pane" hidden></section>`);
  document.querySelectorAll('[data-po-id]').forEach(button => button.onclick = () => openPurchaseOrder(button.dataset.poId));
  document.querySelectorAll('[data-create-grn-po]').forEach(button => button.onclick = () => renderGrnForm(button.dataset.createGrnPo));
  document.querySelectorAll('[data-grn-id]').forEach(button => button.onclick = () => openGrn(button.dataset.grnId));
  document.querySelector('[data-workflow="new-po"]').onclick = () => renderPurchaseOrderForm();
  document.querySelector('[data-workflow="new-grn"]').onclick = () => renderGrnForm();
  document.getElementById('poSearch').oninput = filterPurchaseOrders;
  document.getElementById('poStatus').onchange = filterPurchaseOrders;
}

function filterPurchaseOrders() {
  const search = document.getElementById('poSearch').value.trim().toLowerCase();
  const status = document.getElementById('poStatus').value;
  document.querySelectorAll('#purchaseOrderList .workflow-row').forEach(row => { row.hidden = Boolean((search && !row.textContent.toLowerCase().includes(search)) || (status && !row.textContent.includes(status))); });
}

function showWorkflowPane(html) { const pane = document.getElementById('workflowPane'); pane.hidden = false; pane.innerHTML = html; pane.scrollIntoView({ behavior: 'smooth', block: 'start' }); return pane; }

function renderPurchaseOrderForm() {
  const rows = [{ inventory_item_id: '', uom: '', ordered_quantity: '', unit_rate: '', description: '' }];
  showWorkflowPane(`<div class="detail-head"><h3>Create purchase order</h3><button class="mini-btn" type="button" data-close-workflow>Close</button></div><form id="purchaseOrderForm" class="workflow-form"><div class="field-grid"><label>PO number<input name="po_number" required placeholder="PO-1001"></label><label>Vendor<select name="vendor_id" required><option value="">Select vendor</option>${optionMarkup(workflowState.vendors, 'vendor_id', vendor => `${vendor.vendor_code} · ${vendor.vendor_name}`)}</select></label><label>Expected date<input name="expected_date" type="date"></label><label>Payment terms<input name="payment_terms" placeholder="Net 30"></label><label class="wide">Notes<textarea name="notes" rows="2"></textarea></label></div><div class="line-editor"><div class="section-head"><h4>Order lines</h4><button class="mini-btn" type="button" id="addPoLine">Add line</button></div><div id="poLines"></div></div><p id="poFormMessage" class="form-message" role="alert"></p><button class="primary-btn" type="submit">Create purchase order</button></form>`);
  const form = document.getElementById('purchaseOrderForm');
  const lines = document.getElementById('poLines');
  const renderLines = () => { lines.innerHTML = rows.map((line, index) => `<div class="line-editor-row" data-line="${index}"><label>Item<select data-field="inventory_item_id" required><option value="">Select item</option>${optionMarkup(workflowState.items, 'inventory_item_id', item => `${item.item_code} · ${item.item_name}`)}</select></label><label>UOM<input data-field="uom" required value="${escapeHtml(line.uom)}" placeholder="EA"></label><label>Quantity<input data-field="ordered_quantity" required min="0.001" step="0.001" type="number" value="${escapeHtml(line.ordered_quantity)}"></label><label>Unit rate<input data-field="unit_rate" min="0" step="0.01" type="number" value="${escapeHtml(line.unit_rate)}"></label><label>Notes<input data-field="description" value="${escapeHtml(line.description)}"></label><button class="icon-btn" type="button" data-remove-line="${index}" aria-label="Remove line">×</button></div>`).join(''); rows.forEach((line, index) => { const row = lines.querySelector(`[data-line="${index}"]`); Object.entries(line).forEach(([key, value]) => { const input = row.querySelector(`[data-field="${key}"]`); if (input) input.value = value; }); }); lines.querySelectorAll('[data-field]').forEach(input => input.oninput = () => { rows[Number(input.closest('[data-line]').dataset.line)][input.dataset.field] = input.value; }); lines.querySelectorAll('[data-remove-line]').forEach(button => button.onclick = () => { if (rows.length > 1) { rows.splice(Number(button.dataset.removeLine), 1); renderLines(); } }); };
  renderLines();
  document.getElementById('addPoLine').onclick = () => { rows.push({ inventory_item_id: '', uom: '', ordered_quantity: '', unit_rate: '', description: '' }); renderLines(); };
  document.querySelector('[data-close-workflow]').onclick = renderProcurementHome;
  form.onsubmit = async event => { event.preventDefault(); const message = document.getElementById('poFormMessage'); const data = new FormData(form); const items = rows.map(line => ({ inventory_item_id: line.inventory_item_id, uom: line.uom, ordered_quantity: Number(line.ordered_quantity), unit_rate: line.unit_rate === '' ? undefined : Number(line.unit_rate), description: line.description || undefined })); if (items.some(item => !item.inventory_item_id || !item.uom || !item.ordered_quantity || item.ordered_quantity <= 0)) { message.textContent = 'Complete every order line with an item, UOM, and quantity greater than zero.'; return; } event.submitter.disabled = true; message.textContent = 'Creating purchase order…'; try { const response = await workflowApi('/procurement/purchase-orders', { method: 'POST', body: JSON.stringify({ po_number: data.get('po_number'), vendor_id: data.get('vendor_id'), expected_date: data.get('expected_date') || undefined, payment_terms: data.get('payment_terms') || undefined, notes: data.get('notes') || undefined, items }) }); showToast(`Purchase order ${response.data.po_number} created`); await refreshProcurement(); } catch (error) { message.textContent = workflowError(error); event.submitter.disabled = false; } };
}

async function refreshProcurement() { await loadWorkflowData(); renderProcurementHome(); }

async function openPurchaseOrder(id) { const pane = showWorkflowPane('<p class="empty-copy">Loading purchase order…</p>'); try { const response = await workflowApi(`/procurement/purchase-orders/${id}`); const po = response.data; pane.innerHTML = `<div class="detail-head"><h3>${escapeHtml(po.po_number)}</h3><button class="mini-btn" type="button" data-close-workflow>Close</button></div><p class="workflow-subtitle">${escapeHtml(po.vendor.vendor_name)} · ${escapeHtml(po.status)}</p><div class="workflow-list">${po.purchase_order_item.map(item => `<div class="workflow-row"><div><strong>${escapeHtml(item.inventory_item.item_name)}</strong><small>${escapeHtml(item.description || '')}</small></div><span>${escapeHtml(item.ordered_quantity)} ${escapeHtml(item.uom)} · ${currency(item.unit_rate)}</span></div>`).join('')}</div><button class="primary-btn small workflow-button" type="button" data-create-grn-po="${po.purchase_order_id}">Create GRN for this PO</button>`; pane.querySelector('[data-close-workflow]').onclick = renderProcurementHome; pane.querySelector('[data-create-grn-po]').onclick = () => renderGrnForm(po.purchase_order_id); } catch (error) { pane.innerHTML = `<p class="empty-copy">${escapeHtml(workflowError(error))}</p>`; } }

function renderGrnForm(poId = '') {
  const selected = workflowState.purchaseOrders.find(po => String(po.purchase_order_id) === String(poId));
  const poOptions = optionMarkup(workflowState.purchaseOrders.filter(po => !['RECEIVED', 'CANCELLED'].includes(po.status)), 'purchase_order_id', po => `${po.po_number} · ${po.vendor?.vendor_name || ''}`);
  showWorkflowPane(`<div class="detail-head"><h3>Create goods receipt</h3><button class="mini-btn" type="button" data-close-workflow>Close</button></div><form id="grnForm" class="workflow-form"><div class="field-grid"><label>GRN number<input name="grn_number" required placeholder="GRN-1001"></label><label>Purchase order<select id="grnPo" name="purchase_order_id" required><option value="">Select PO</option>${poOptions}</select></label><label>Warehouse<select name="warehouse_id" required><option value="">Select warehouse</option>${optionMarkup(workflowState.warehouses, 'warehouse_id', warehouse => `${warehouse.warehouse_code} · ${warehouse.warehouse_name}`)}</select></label><label>Challan number<input name="challan_number"></label></div><div id="grnLines" class="line-editor"></div><p id="grnFormMessage" class="form-message" role="alert"></p><button class="primary-btn" type="submit">Create pending GRN</button></form>`);
  const form = document.getElementById('grnForm'); const poSelect = document.getElementById('grnPo'); poSelect.value = poId || ''; document.querySelector('[data-close-workflow]').onclick = renderProcurementHome;
  const renderLines = () => { const po = workflowState.purchaseOrders.find(record => String(record.purchase_order_id) === poSelect.value); document.getElementById('grnLines').innerHTML = po ? `<div class="section-head"><h4>Receipt lines</h4><small>${escapeHtml(po.vendor.vendor_name)}</small></div>${po.purchase_order_item.map((item, index) => `<div class="line-editor-row grn-line" data-line="${index}" data-po-item="${item.purchase_order_item_id}"><div><strong>${escapeHtml(item.inventory_item.item_name)}</strong><small>Ordered ${escapeHtml(item.ordered_quantity)} ${escapeHtml(item.uom)}</small></div><label>Received<input data-field="received_quantity" required min="0.001" max="${escapeHtml(item.ordered_quantity)}" step="0.001" type="number"></label><label>UOM<input data-field="uom" required value="${escapeHtml(item.uom)}"></label><label>Lot / heat<input data-field="heat_number" placeholder="Optional"></label></div>`).join('')}` : '<p class="empty-copy">Select a purchase order to load its lines.</p>'; };
  poSelect.onchange = renderLines; renderLines();
  form.onsubmit = async event => { event.preventDefault(); const message = document.getElementById('grnFormMessage'); const data = new FormData(form); const po = workflowState.purchaseOrders.find(record => String(record.purchase_order_id) === poSelect.value); const lines = [...document.querySelectorAll('.grn-line')].map(row => ({ purchase_order_item_id: row.dataset.poItem, inventory_item_id: po.purchase_order_item.find(item => String(item.purchase_order_item_id) === row.dataset.poItem).inventory_item_id, received_quantity: Number(row.querySelector('[data-field="received_quantity"]').value), uom: row.querySelector('[data-field="uom"]').value, heat_number: row.querySelector('[data-field="heat_number"]').value || undefined })); if (!po || lines.some(line => !line.received_quantity || line.received_quantity <= 0 || !line.uom)) { message.textContent = 'Select a purchase order and enter a received quantity and UOM for every line.'; return; } event.submitter.disabled = true; message.textContent = 'Creating pending GRN…'; try { const response = await workflowApi('/procurement/grns', { method: 'POST', body: JSON.stringify({ grn_number: data.get('grn_number'), purchase_order_id: po.purchase_order_id, vendor_id: po.vendor_id, warehouse_id: data.get('warehouse_id'), challan_number: data.get('challan_number') || undefined, items: lines }) }); showToast(`GRN ${response.data.grn_number} is pending inspection`); await refreshProcurement(); await openGrn(response.data.grn_id); } catch (error) { message.textContent = workflowError(error); event.submitter.disabled = false; } };
}

async function openGrn(id) {
  const pane = showWorkflowPane('<p class="empty-copy">Loading GRN…</p>');
  try {
    const response = await workflowApi(`/procurement/grns/${id}`);
    const grn = response.data;
    pane.innerHTML = `<div class="detail-head"><div><h3>${escapeHtml(grn.grn_number)}</h3><small>${escapeHtml(grn.vendor.vendor_name)} · ${escapeHtml(grn.warehouse.warehouse_name)} · ${escapeHtml(grn.purchase_order?.po_number || 'No PO')}</small></div><span class="status-pill warn">${escapeHtml(grn.inspection_status)}</span></div><form id="grnInspectionForm" class="workflow-form"><div class="workflow-list">${grn.grn_item.map(item => `<div class="inspection-row" data-grn-item="${item.grn_item_id}"><div><strong>${escapeHtml(item.inventory_item.item_name)}</strong><small>Received ${escapeHtml(item.received_quantity)} ${escapeHtml(item.uom)}${item.heat_number ? ` · Heat ${escapeHtml(item.heat_number)}` : ''}</small></div><label>Accepted<input data-field="accepted_quantity" required min="0" max="${escapeHtml(item.received_quantity)}" step="0.001" type="number" value="${escapeHtml(item.accepted_quantity || item.received_quantity)}"></label><label>Rejected<input data-field="rejected_quantity" required min="0" max="${escapeHtml(item.received_quantity)}" step="0.001" type="number" value="${escapeHtml(item.rejected_quantity || 0)}"></label><label>Reason<input data-field="rejection_reason" value="${escapeHtml(item.rejection_reason || '')}"></label></div>`).join('')}</div><div class="field-grid"><label>Inspection result<select name="inspection_status" required><option value="PASSED">Passed</option><option value="PARTIAL">Partial</option><option value="FAILED">Failed</option></select></label></div><p id="grnInspectionMessage" class="form-message" role="alert"></p><button class="primary-btn" type="submit">Post inspection to inventory</button></form>`;
    const form = document.getElementById('grnInspectionForm');
    form.onsubmit = async event => {
      event.preventDefault();
      const message = document.getElementById('grnInspectionMessage');
      const items = [...document.querySelectorAll('.inspection-row')].map(row => ({ grn_item_id: row.dataset.grnItem, accepted_quantity: Number(row.querySelector('[data-field="accepted_quantity"]').value), rejected_quantity: Number(row.querySelector('[data-field="rejected_quantity"]').value), rejection_reason: row.querySelector('[data-field="rejection_reason"]').value || undefined }));
      const invalid = items.some((item, index) => item.accepted_quantity < 0 || item.rejected_quantity < 0 || item.accepted_quantity + item.rejected_quantity !== Number(grn.grn_item[index].received_quantity));
      if (invalid) { message.textContent = 'Accepted plus rejected quantity must equal received quantity on every line.'; return; }
      event.submitter.disabled = true;
      message.textContent = 'Posting inspection…';
      try { await workflowApi(`/procurement/grns/${grn.grn_id}/post`, { method: 'POST', body: JSON.stringify({ inspection_status: form.elements.inspection_status.value, items }) }); showToast('GRN posted and inventory refreshed'); await refreshProcurement(); renderInventory(); } catch (error) { message.textContent = workflowError(error); event.submitter.disabled = false; }
    };
  } catch (error) { pane.innerHTML = `<p class="empty-copy">${escapeHtml(workflowError(error))}</p>`; }
}

function renderInventory() { renderProcurementLoading('Loading inventory…'); Promise.all([workflowApi('/inventory/stocks?pageSize=100'), workflowApi('/inventory/items?pageSize=100'), workflowApi('/inventory/warehouses?pageSize=100'), workflowApi('/inventory/movements?pageSize=100&search=PURCHASE_RECEIPT')]).then(([stocks, items, warehouses, movements]) => { moduleStack.innerHTML = `<div class="workflow-view"><div class="workflow-title"><div><p class="eyebrow">Inventory control</p><h3>Stock balances and receipts</h3><small>Accepted GRN quantities become stock and PURCHASE_RECEIPT movements.</small></div><span class="status-pill good">Live API</span></div><section class="panel workflow-panel"><div class="workflow-filters"><input id="inventorySearch" placeholder="Search item or warehouse" aria-label="Search inventory"><select id="inventoryItemFilter" aria-label="Filter by item"><option value="">All items</option>${optionMarkup(items.data, 'inventory_item_id', item => `${item.item_code} · ${item.item_name}`)}</select><select id="inventoryWarehouseFilter" aria-label="Filter by warehouse"><option value="">All warehouses</option>${optionMarkup(warehouses.data, 'warehouse_id', warehouse => `${warehouse.warehouse_code} · ${warehouse.warehouse_name}`)}</select></div><div id="stockList" class="workflow-list"></div></section><section class="panel workflow-panel"><div class="section-head"><h3>Purchase receipts</h3><span class="status-pill good">${movements.meta.total}</span></div><div class="workflow-list">${movements.data.length ? movements.data.map(movement => `<div class="workflow-row"><div><strong>${escapeHtml(movement.inventory_item?.item_name || 'Item')}</strong><small>${escapeHtml(movement.warehouse?.warehouse_name || 'Warehouse')} · ${escapeHtml(movement.reference_type || '')} ${escapeHtml(movement.reference_id || '')} · ${new Date(movement.movement_date).toLocaleString()}</small></div><span class="amount">+${escapeHtml(movement.quantity)} ${escapeHtml(movement.inventory_item?.base_uom || '')}</span></div>`).join('') : '<p class="empty-copy">No PURCHASE_RECEIPT movements found yet.</p>'}</div></section></div>`; const renderStocks = () => { const search = document.getElementById('inventorySearch').value.trim().toLowerCase(); const item = document.getElementById('inventoryItemFilter').value; const warehouse = document.getElementById('inventoryWarehouseFilter').value; const filtered = stocks.data.filter(stock => (!search || `${stock.inventory_item.item_code} ${stock.inventory_item.item_name} ${stock.warehouse.warehouse_name}`.toLowerCase().includes(search)) && (!item || String(stock.inventory_item_id) === item) && (!warehouse || String(stock.warehouse_id) === warehouse)); document.getElementById('stockList').innerHTML = filtered.length ? filtered.map(stock => `<div class="workflow-row"><div><strong>${escapeHtml(stock.inventory_item.item_name)}</strong><small>${escapeHtml(stock.inventory_item.item_code)} · ${escapeHtml(stock.warehouse.warehouse_name)}${stock.inventory_lot ? ` · Lot ${escapeHtml(stock.inventory_lot.lot_number)}` : ''}</small></div><span class="amount">${escapeHtml(stock.quantity)} ${escapeHtml(stock.inventory_item.base_uom)}</span></div>`).join('') : '<p class="empty-copy">No stock balances match these filters.</p>'; }; renderStocks(); ['inventorySearch', 'inventoryItemFilter', 'inventoryWarehouseFilter'].forEach(id => document.getElementById(id).oninput = renderStocks); }).catch(error => renderProcurementLoading(workflowError(error))); }

function salesShell(content) { moduleStack.innerHTML = `<div class="workflow-view"><div class="workflow-title"><div><p class="eyebrow">Sales control</p><h3>Customer order to inventory sale issue</h3><small>Create orders, prepare deliveries, dispatch stock, and trace every movement.</small></div><span class="status-pill good">Live API</span></div>${content}</div>`; }
function renderSalesLoading(message = 'Loading sales data…') { salesShell(`<p class="empty-copy workflow-message">${escapeHtml(message)}</p>`); }
async function loadSalesData() { const [customers, items, warehouses, orders, invoices, deliveries, lots] = await Promise.all([workflowApi('/master/customers?pageSize=100'), workflowApi('/inventory/items?pageSize=100'), workflowApi('/inventory/warehouses?pageSize=100'), workflowApi('/sales/orders?pageSize=100'), workflowApi('/sales/invoices?pageSize=100'), workflowApi('/sales/deliveries?pageSize=100'), workflowApi('/inventory/lots?pageSize=100&status=ACTIVE')]); Object.assign(workflowState, { customers: customers.data, items: items.data, warehouses: warehouses.data, orders: orders.data, invoices: invoices.data, deliveries: deliveries.data, lots: lots.data }); }
function salesStatusClass(status) { return ['DISPATCHED', 'DELIVERED', 'OPEN'].includes(status) ? 'good' : 'warn'; }
function salesPane(html) { const pane = document.getElementById('salesWorkflowPane'); pane.hidden = false; pane.innerHTML = html; pane.scrollIntoView({ behavior: 'smooth', block: 'start' }); return pane; }
function renderSales() { renderSalesLoading(); loadSalesData().then(renderSalesHome).catch(error => renderSalesLoading(workflowError(error))); }
function renderSalesHome() { const orders = workflowState.orders.map(order => `<article class="workflow-row"><div><strong>${escapeHtml(order.order_number)}</strong><small>${escapeHtml(order.customer?.customer_name || 'Customer')} · ${order.customer_order_item.length} line(s)</small></div><div class="workflow-row-actions"><span class="status-pill ${salesStatusClass(order.status)}">${escapeHtml(order.status)}</span><button class="mini-btn" type="button" data-sales-order="${order.customer_order_id}">Open</button></div></article>`).join('') || '<p class="empty-copy">No customer orders found.</p>'; const deliveries = workflowState.deliveries.map(delivery => `<article class="workflow-row"><div><strong>${escapeHtml(delivery.delivery_number)}</strong><small>${escapeHtml(delivery.customer?.customer_name || 'Customer')} · ${escapeHtml(delivery.warehouse?.warehouse_name || 'Warehouse')} · ${escapeHtml(delivery.customer_order?.order_number || delivery.sales_invoice?.invoice_number || 'Unlinked')}</small></div><div class="workflow-row-actions"><span class="status-pill ${salesStatusClass(delivery.status)}">${escapeHtml(delivery.status)}</span><button class="mini-btn" type="button" data-sales-delivery="${delivery.delivery_id}">Open</button></div></article>`).join('') || '<p class="empty-copy">No deliveries found.</p>'; salesShell(`<div class="workflow-actions"><button class="primary-btn small workflow-button" type="button" data-sales-action="order">Create customer order</button><button class="mini-btn" type="button" data-sales-action="delivery">Create delivery</button></div><section class="panel workflow-panel"><div class="section-head"><h3>Customer orders</h3><span class="status-pill">${workflowState.orders.length}</span></div><div class="workflow-filters"><input id="salesOrderSearch" placeholder="Search order or customer" aria-label="Search customer orders"><select id="salesOrderStatus" aria-label="Customer order status"><option value="">All statuses</option><option>OPEN</option><option>PARTIALLY_DELIVERED</option><option>DELIVERED</option><option>CANCELLED</option></select></div><div id="salesOrderList" class="workflow-list">${orders}</div></section><section class="panel workflow-panel"><div class="section-head"><h3>Deliveries</h3><span class="status-pill">${workflowState.deliveries.length}</span></div><div class="workflow-filters"><input id="salesDeliverySearch" placeholder="Search delivery or customer" aria-label="Search deliveries"><select id="salesDeliveryStatus" aria-label="Delivery status"><option value="">All statuses</option><option>DRAFT</option><option>READY</option><option>DISPATCHED</option><option>DELIVERED</option></select></div><div id="salesDeliveryList" class="workflow-list">${deliveries}</div></section><section id="salesWorkflowPane" class="workflow-pane" hidden></section>`); document.querySelector('[data-sales-action="order"]').onclick = renderCustomerOrderForm; document.querySelector('[data-sales-action="delivery"]').onclick = () => renderDeliveryForm(); document.querySelectorAll('[data-sales-order]').forEach(button => button.onclick = () => openCustomerOrder(button.dataset.salesOrder)); document.querySelectorAll('[data-sales-delivery]').forEach(button => button.onclick = () => openDelivery(button.dataset.salesDelivery)); const filter = (list, search, status) => { const text = document.getElementById(search).value.toLowerCase(); const value = document.getElementById(status).value; document.querySelectorAll(`#${list} .workflow-row`).forEach(row => { row.hidden = Boolean((text && !row.textContent.toLowerCase().includes(text)) || (value && !row.textContent.includes(value))); }); }; document.getElementById('salesOrderSearch').oninput = () => filter('salesOrderList', 'salesOrderSearch', 'salesOrderStatus'); document.getElementById('salesOrderStatus').onchange = () => filter('salesOrderList', 'salesOrderSearch', 'salesOrderStatus'); document.getElementById('salesDeliverySearch').oninput = () => filter('salesDeliveryList', 'salesDeliverySearch', 'salesDeliveryStatus'); document.getElementById('salesDeliveryStatus').onchange = () => filter('salesDeliveryList', 'salesDeliverySearch', 'salesDeliveryStatus'); }
function lineEditorRows(rows) { return rows.map((line, index) => `<div class="line-editor-row" data-line="${index}"><label>Item<select data-field="inventory_item_id" required><option value="">Select item</option>${optionMarkup(workflowState.items, 'inventory_item_id', item => `${item.item_code} · ${item.item_name}`)}</select></label><label>UOM<input data-field="uom" required value="${escapeHtml(line.uom)}" placeholder="EA"></label><label>Quantity<input data-field="ordered_quantity" required min="0.001" step="0.001" type="number" value="${escapeHtml(line.ordered_quantity)}"></label><label>Unit rate<input data-field="unit_rate" min="0" step="0.01" type="number" value="${escapeHtml(line.unit_rate)}"></label><label>Notes<input data-field="description" value="${escapeHtml(line.description)}"></label><button class="icon-btn" type="button" data-remove-line="${index}" aria-label="Remove line">×</button></div>`).join(''); }
function renderCustomerOrderForm() { const rows = [{ inventory_item_id: '', uom: '', ordered_quantity: '', unit_rate: '', description: '' }]; salesPane(`<div class="detail-head"><h3>Create customer order</h3><button class="mini-btn" type="button" data-close-sales>Close</button></div><form id="customerOrderForm" class="workflow-form"><div class="field-grid"><label>Order number<input name="order_number" required placeholder="SO-1001"></label><label>Customer<select name="customer_id" required><option value="">Select customer</option>${optionMarkup(workflowState.customers, 'customer_id', customer => `${customer.customer_code} · ${customer.customer_name}`)}</select></label><label>Order date<input name="order_date" type="date"></label><label>Payment terms<input name="payment_terms" placeholder="Net 30"></label><label class="wide">Notes<textarea name="remarks" rows="2"></textarea></label></div><div class="line-editor"><div class="section-head"><h4>Order lines</h4><button class="mini-btn" type="button" id="addSalesLine">Add line</button></div><div id="salesLines"></div></div><p id="customerOrderMessage" class="form-message" role="alert"></p><button class="primary-btn" type="submit">Create customer order</button></form>`); const form = document.getElementById('customerOrderForm'); const lines = document.getElementById('salesLines'); const paint = () => { lines.innerHTML = lineEditorRows(rows); rows.forEach((line, index) => { const row = lines.querySelector(`[data-line="${index}"]`); Object.entries(line).forEach(([key, value]) => { const input = row.querySelector(`[data-field="${key}"]`); if (input) input.value = value; }); }); lines.querySelectorAll('[data-field]').forEach(input => input.oninput = () => { rows[Number(input.closest('[data-line]').dataset.line)][input.dataset.field] = input.value; }); lines.querySelectorAll('[data-remove-line]').forEach(button => button.onclick = () => { if (rows.length > 1) { rows.splice(Number(button.dataset.removeLine), 1); paint(); } }); }; paint(); document.getElementById('addSalesLine').onclick = () => { rows.push({ inventory_item_id: '', uom: '', ordered_quantity: '', unit_rate: '', description: '' }); paint(); }; document.querySelector('[data-close-sales]').onclick = renderSalesHome; form.onsubmit = async event => { event.preventDefault(); const message = document.getElementById('customerOrderMessage'); const data = new FormData(form); const items = rows.map(line => ({ inventory_item_id: line.inventory_item_id, uom: line.uom, ordered_quantity: Number(line.ordered_quantity), unit_rate: line.unit_rate === '' ? undefined : Number(line.unit_rate), description: line.description || undefined })); if (!data.get('customer_id') || items.some(item => !item.inventory_item_id || !item.uom || item.ordered_quantity <= 0)) { message.textContent = 'Select a customer and complete every order line with an item, UOM, and positive quantity.'; return; } event.submitter.disabled = true; message.textContent = 'Creating customer order…'; try { const response = await workflowApi('/sales/orders', { method: 'POST', body: JSON.stringify({ order_number: data.get('order_number'), customer_id: data.get('customer_id'), order_date: data.get('order_date') || undefined, payment_terms: data.get('payment_terms') || undefined, remarks: data.get('remarks') || undefined, items }) }); showToast(`Customer order ${response.data.order_number} created`); await loadSalesData(); renderSalesHome(); } catch (error) { message.textContent = workflowError(error); event.submitter.disabled = false; } }; }
async function openCustomerOrder(id) { const pane = salesPane('<p class="empty-copy">Loading customer order…</p>'); try { const order = (await workflowApi(`/sales/orders/${id}`)).data; pane.innerHTML = `<div class="detail-head"><div><h3>${escapeHtml(order.order_number)}</h3><small>${escapeHtml(order.customer.customer_name)} · ${escapeHtml(order.status)}</small></div><button class="mini-btn" type="button" data-close-sales>Close</button></div><div class="workflow-list">${order.customer_order_item.map(item => `<div class="workflow-row"><div><strong>${escapeHtml(item.inventory_item.item_name)}</strong><small>${escapeHtml(item.description || '')}</small></div><span>${escapeHtml(item.ordered_quantity)} ${escapeHtml(item.uom)} · ${currency(item.unit_rate)}</span></div>`).join('')}</div><button class="primary-btn small workflow-button" type="button" data-create-delivery-order="${order.customer_order_id}">Create delivery</button>`; pane.querySelector('[data-close-sales]').onclick = renderSalesHome; pane.querySelector('[data-create-delivery-order]').onclick = () => renderDeliveryForm(order.customer_order_id, 'order'); } catch (error) { pane.innerHTML = `<p class="empty-copy">${escapeHtml(workflowError(error))}</p>`; } }
function sourceLines(source, type) { const records = type === 'order' ? source.customer_order_item : source.sales_invoice_item; return records.map(item => { const sent = (item.delivery_item || []).filter(line => ['DISPATCHED', 'DELIVERED'].includes(line.delivery?.status)).reduce((sum, line) => sum + Number(line.delivered_quantity), 0); const total = Number(type === 'order' ? item.ordered_quantity : item.quantity); return { sourceItemId: item[type === 'order' ? 'customer_order_item_id' : 'sales_invoice_item_id'], inventory_item_id: item.inventory_item_id, item: item.inventory_item, uom: item.uom, remaining: Math.max(0, total - sent) }; }).filter(line => line.remaining > 0); }
function renderDeliveryForm(sourceId = '', sourceType = 'order') { salesPane(`<div class="detail-head"><h3>Create draft delivery</h3><button class="mini-btn" type="button" data-close-sales>Close</button></div><form id="deliveryForm" class="workflow-form"><div class="field-grid"><label>Delivery number<input name="delivery_number" required placeholder="DEL-1001"></label><label>Source<select id="deliverySourceType"><option value="order">Customer order</option><option value="invoice">Sales invoice</option></select></label><label>Linked record<select id="deliverySource" required><option value="">Select source</option></select></label><label>Customer<input id="deliveryCustomer" readonly><small>Verified from the linked order or invoice.</small></label><label>Warehouse<select name="warehouse_id" required><option value="">Select warehouse</option>${optionMarkup(workflowState.warehouses, 'warehouse_id', warehouse => `${warehouse.warehouse_code} · ${warehouse.warehouse_name}`)}</select></label><label>Delivery date<input name="delivery_date" type="date"></label><label class="wide">Remarks<textarea name="remarks" rows="2"></textarea></label></div><div id="deliveryLines" class="line-editor"><p class="empty-copy">Select a linked record to load eligible lines.</p></div><p id="deliveryMessage" class="form-message" role="alert"></p><button class="primary-btn" type="submit">Create draft delivery</button></form>`); const form = document.getElementById('deliveryForm'); const type = document.getElementById('deliverySourceType'); const select = document.getElementById('deliverySource'); const lines = document.getElementById('deliveryLines'); const customer = document.getElementById('deliveryCustomer'); type.value = sourceType; const records = () => type.value === 'order' ? workflowState.orders : workflowState.invoices; const paintSources = () => { const key = type.value === 'order' ? 'customer_order_id' : 'sales_invoice_id'; select.innerHTML = `<option value="">Select source</option>${optionMarkup(records(), key, record => `${type.value === 'order' ? record.order_number : record.invoice_number} · ${record.customer?.customer_name || ''}`)}`; select.value = sourceId || ''; paintLines(); }; const paintLines = () => { const source = records().find(record => String(record[type.value === 'order' ? 'customer_order_id' : 'sales_invoice_id']) === select.value); if (!source) { customer.value = ''; lines.innerHTML = '<p class="empty-copy">Select a linked record to load eligible lines.</p>'; return; } customer.value = source.customer.customer_name; const eligible = sourceLines(source, type.value); lines.innerHTML = eligible.length ? `<div class="section-head"><h4>Eligible delivery lines</h4><small>Only undispatched quantities are available.</small></div>${eligible.map((line, index) => { const lots = workflowState.lots.filter(lot => String(lot.inventory_item_id) === String(line.inventory_item_id)); return `<div class="line-editor-row delivery-line" data-line="${index}" data-source-item="${line.sourceItemId}" data-item="${line.inventory_item_id}" data-lot-tracked="${line.item.is_lot_tracked ? 'true' : 'false'}"><div><strong>${escapeHtml(line.item.item_name)}</strong><small>Remaining ${escapeHtml(line.remaining)} ${escapeHtml(line.uom)}</small></div><label>UOM<input data-field="uom" value="${escapeHtml(line.uom)}" readonly></label><label>Quantity<input data-field="delivered_quantity" required min="0.001" max="${escapeHtml(line.remaining)}" step="0.001" type="number"></label><label>Lot${line.item.is_lot_tracked ? `<select data-field="lot_id" required><option value="">Select lot</option>${lots.map(lot => `<option value="${lot.lot_id}">${escapeHtml(lot.lot_number)}</option>`).join('')}</select>` : '<input data-field="lot_id" disabled value="">'}</label></div>`; }).join('')}` : '<p class="empty-copy">This source has no undispatched lines.</p>'; }; type.onchange = () => { sourceId = ''; paintSources(); }; select.onchange = paintLines; paintSources(); document.querySelector('[data-close-sales]').onclick = renderSalesHome; form.onsubmit = async event => { event.preventDefault(); const message = document.getElementById('deliveryMessage'); const source = records().find(record => String(record[type.value === 'order' ? 'customer_order_id' : 'sales_invoice_id']) === select.value); const deliveryItems = [...document.querySelectorAll('.delivery-line')].map(row => ({ inventory_item_id: row.dataset.item, [type.value === 'order' ? 'customer_order_item_id' : 'sales_invoice_item_id']: row.dataset.sourceItem, uom: row.querySelector('[data-field="uom"]').value, delivered_quantity: Number(row.querySelector('[data-field="delivered_quantity"]').value), lot_id: row.querySelector('[data-field="lot_id"]').value || undefined })); if (!source || !new FormData(form).get('warehouse_id') || !deliveryItems.length || deliveryItems.some(item => item.delivered_quantity <= 0) || [...document.querySelectorAll('.delivery-line[data-lot-tracked="true"]')].some(row => !row.querySelector('[data-field="lot_id"]').value)) { message.textContent = 'Select a linked record and warehouse, enter positive quantities, and choose every required lot.'; return; } event.submitter.disabled = true; message.textContent = 'Creating draft delivery…'; try { const data = new FormData(form); const response = await workflowApi('/sales/deliveries', { method: 'POST', body: JSON.stringify({ delivery_number: data.get('delivery_number'), customer_id: source.customer_id, [type.value === 'order' ? 'customer_order_id' : 'sales_invoice_id']: source[type.value === 'order' ? 'customer_order_id' : 'sales_invoice_id'], warehouse_id: data.get('warehouse_id'), delivery_date: data.get('delivery_date') || undefined, remarks: data.get('remarks') || undefined, items: deliveryItems }) }); showToast(`Draft delivery ${response.data.delivery_number} created`); await loadSalesData(); await openDelivery(response.data.delivery_id); } catch (error) { message.textContent = workflowError(error); event.submitter.disabled = false; } }; }
async function openDelivery(id) { const pane = salesPane('<p class="empty-copy">Loading delivery…</p>'); try { const delivery = (await workflowApi(`/sales/deliveries/${id}`)).data; const dispatchable = ['DRAFT', 'READY'].includes(delivery.status); pane.innerHTML = `<div class="detail-head"><div><h3>${escapeHtml(delivery.delivery_number)}</h3><small>${escapeHtml(delivery.customer.customer_name)} · ${escapeHtml(delivery.warehouse?.warehouse_name || 'Warehouse not selected')} · ${escapeHtml(delivery.customer_order?.order_number || delivery.sales_invoice?.invoice_number || 'Unlinked')}</small></div><span class="status-pill ${salesStatusClass(delivery.status)}">${escapeHtml(delivery.status)}</span></div><div class="workflow-list">${delivery.delivery_item.map(line => `<div class="workflow-row"><div><strong>${escapeHtml(line.inventory_item.item_name)}</strong><small>${escapeHtml(line.uom)} · ${line.inventory_lot ? `Lot ${escapeHtml(line.inventory_lot.lot_number)}` : 'No lot'} · Delivery line ${escapeHtml(line.delivery_item_id)}</small></div><span>${escapeHtml(line.delivered_quantity)} ${escapeHtml(line.uom)}</span></div>`).join('')}</div><p id="dispatchMessage" class="form-message" role="alert"></p>${dispatchable ? '<button id="dispatchDelivery" class="primary-btn" type="button">Dispatch delivery</button>' : `<p class="empty-copy">This delivery is already ${escapeHtml(delivery.status.toLowerCase())} and cannot be dispatched again.</p>`}`; const dispatchButton = document.getElementById('dispatchDelivery'); if (dispatchButton) dispatchButton.onclick = async () => { dispatchButton.disabled = true; document.getElementById('dispatchMessage').textContent = 'Dispatching and checking stock…'; try { await workflowApi(`/sales/deliveries/${delivery.delivery_id}/dispatch`, { method: 'POST', body: JSON.stringify({}) }); showToast('Delivery dispatched and inventory refreshed'); await loadSalesData(); renderSalesHome(); renderInventory(); } catch (error) { document.getElementById('dispatchMessage').textContent = workflowError(error); dispatchButton.disabled = false; } }; } catch (error) { pane.innerHTML = `<p class="empty-copy">${escapeHtml(workflowError(error))}</p>`; } }
function renderInventory() { renderProcurementLoading('Loading inventory…'); Promise.all([workflowApi('/inventory/stocks?pageSize=100'), workflowApi('/inventory/items?pageSize=100'), workflowApi('/inventory/warehouses?pageSize=100'), workflowApi('/inventory/movements?pageSize=100')]).then(([stocks, items, warehouses, movements]) => { const types = ['PURCHASE_RECEIPT', 'SALE_ISSUE', 'PRODUCTION_CONSUMPTION', 'PRODUCTION_OUTPUT']; moduleStack.innerHTML = `<div class="workflow-view"><div class="workflow-title"><div><p class="eyebrow">Inventory control</p><h3>Balances and stock movements</h3><small>Receipts, sale issues, and production movements are live from the ERP API.</small></div><span class="status-pill good">Live API</span></div><section class="panel workflow-panel"><div class="workflow-filters"><input id="inventorySearch" placeholder="Search item or warehouse" aria-label="Search inventory"><select id="inventoryItemFilter" aria-label="Filter by item"><option value="">All items</option>${optionMarkup(items.data, 'inventory_item_id', item => `${item.item_code} · ${item.item_name}`)}</select><select id="inventoryWarehouseFilter" aria-label="Filter by warehouse"><option value="">All warehouses</option>${optionMarkup(warehouses.data, 'warehouse_id', warehouse => `${warehouse.warehouse_code} · ${warehouse.warehouse_name}`)}</select></div><div id="stockList" class="workflow-list"></div></section><section class="panel workflow-panel"><div class="section-head"><h3>Movement history</h3><span id="movementCount" class="status-pill good"></span></div><div class="workflow-filters"><select id="movementTypeFilter" aria-label="Filter movement type"><option value="">All movement types</option>${types.map(type => `<option>${type}</option>`).join('')}</select></div><div id="movementList" class="workflow-list"></div></section></div>`; const renderStocks = () => { const search = document.getElementById('inventorySearch').value.toLowerCase(); const item = document.getElementById('inventoryItemFilter').value; const warehouse = document.getElementById('inventoryWarehouseFilter').value; const rows = stocks.data.filter(stock => (!item || String(stock.inventory_item_id) === item) && (!warehouse || String(stock.warehouse_id) === warehouse) && (!search || `${stock.inventory_item?.item_name} ${stock.inventory_item?.item_code} ${stock.warehouse?.warehouse_name}`.toLowerCase().includes(search))); document.getElementById('stockList').innerHTML = rows.length ? rows.map(stock => `<div class="workflow-row"><div><strong>${escapeHtml(stock.inventory_item?.item_name || 'Item')}</strong><small>${escapeHtml(stock.inventory_item?.item_code || '')} · ${escapeHtml(stock.warehouse?.warehouse_name || 'Warehouse')}${stock.inventory_lot ? ` · Lot ${escapeHtml(stock.inventory_lot.lot_number)}` : ''}</small></div><span class="amount">${escapeHtml(stock.quantity)} ${escapeHtml(stock.inventory_item?.base_uom || '')}</span></div>`).join('') : '<p class="empty-copy">No stock balances match these filters.</p>'; }; const renderMovements = () => { const type = document.getElementById('movementTypeFilter').value; const rows = movements.data.filter(movement => !type || movement.movement_type === type); document.getElementById('movementCount').textContent = `${rows.length} shown`; document.getElementById('movementList').innerHTML = rows.length ? rows.map(movement => { const outgoing = ['SALE_ISSUE', 'PRODUCTION_CONSUMPTION'].includes(movement.movement_type); return `<div class="workflow-row"><div><strong>${escapeHtml(movement.movement_type)}</strong><small>${escapeHtml(movement.inventory_item?.item_name || 'Item')} · ${escapeHtml(movement.warehouse?.warehouse_name || 'Warehouse')}${movement.inventory_lot ? ` · Lot ${escapeHtml(movement.inventory_lot.lot_number)}` : ''} · ${escapeHtml(movement.reference_type || '')} ${escapeHtml(movement.reference_id || '')} · ${new Date(movement.movement_date).toLocaleString()}</small></div><span class="amount">${outgoing ? '-' : '+'}${escapeHtml(movement.quantity)} ${escapeHtml(movement.inventory_item?.base_uom || '')}</span></div>`; }).join('') : '<p class="empty-copy">No movements match this filter.</p>'; }; ['inventorySearch', 'inventoryItemFilter', 'inventoryWarehouseFilter'].forEach(id => document.getElementById(id).oninput = renderStocks); document.getElementById('movementTypeFilter').onchange = renderMovements; renderStocks(); renderMovements(); }).catch(error => renderProcurementLoading(workflowError(error))); }

document.querySelectorAll("[data-action='enter-app']").forEach(button => {
  button.addEventListener("click", enterApp);
});

document.querySelectorAll("[data-auth]").forEach(button => {
  button.addEventListener("click", () => showAuth(button.dataset.auth));
});

document.querySelectorAll("[data-route]").forEach(button => {
  button.addEventListener("click", () => routeTo(button.dataset.route));
});

document.querySelectorAll("[data-module]").forEach(button => {
  button.addEventListener("click", () => {
    document.querySelectorAll("[data-module]").forEach(item => item.classList.remove("active"));
    button.classList.add("active");
    renderModule(button.dataset.module);
  });
});

document.querySelectorAll("[data-toast]").forEach(button => {
  button.addEventListener("click", () => showToast(button.dataset.toast));
});

document.querySelectorAll("[data-filter]").forEach(button => {
  button.addEventListener("click", () => showToast("Filters opened: status, date, plant, role"));
});

fab.addEventListener("click", () => {
  const labels = {
    dashboard: "Quick create menu opened",
    operations: `Add ${moduleData[appState.activeModule].title} record`,
    documents: "Upload PDF or scan document",
    analytics: "Create scheduled KPI report"
  };
  showToast(labels[appState.activeView] || "Add record");
});

renderModule("customers");

const documentUi = {
  list: document.getElementById('documentList'), detail: document.getElementById('documentDetail'), count: document.getElementById('documentCount'), search: document.getElementById('documentSearch'), status: document.getElementById('documentStatus'), file: document.getElementById('documentFileInput'), upload: document.getElementById('documentUploadButton'), auth: document.getElementById('documentAuth')
};

function authToken() { return localStorage.getItem('erpAuthToken') || window.ERP_AUTH_TOKEN || ''; }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]); }
function currency(value) { return value === null || value === undefined ? '—' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(value)); }
function normalizeExtractionFields(rawFields = {}) {
  const source = rawFields || {};
  const amounts = source.amounts || {};
  const vendor = source.vendor || {};
  const items = Array.isArray(source.items) ? source.items : [];
  const invoiceNumber = source.invoiceNumber ?? source.invoice_number ?? null;
  const invoiceDate = source.invoiceDate ?? source.invoice_date ?? null;
  const vendorName = vendor.name ?? source.vendor_name ?? source.vendorName ?? null;
  const vendorGstin = vendor.gstin ?? source.vendor_gstin ?? source.vendorGstin ?? null;
  const total = amounts.total ?? source.total ?? null;
  const taxableAmount = amounts.taxableAmount ?? amounts.subtotal ?? source.taxable_amount ?? source.subtotal ?? null;
  const subtotal = amounts.subtotal ?? source.subtotal ?? taxableAmount ?? null;
  const cgst = amounts.cgst ?? source.cgst ?? null;
  const sgst = amounts.sgst ?? source.sgst ?? null;
  const igst = amounts.igst ?? source.igst ?? null;
  const discount = amounts.discount ?? source.discount ?? 0;
  const roundOff = amounts.roundOff ?? source.round_off ?? 0;
  return {
    invoiceNumber,
    invoice_number: invoiceNumber,
    invoiceDate,
    invoice_date: invoiceDate,
    vendor: { ...vendor, name: vendorName, gstin: vendorGstin },
    vendor_name: vendorName,
    vendorGstin: vendorGstin,
    vendor_gstin: vendorGstin,
    amounts: {
      ...amounts,
      subtotal,
      taxableAmount,
      cgst,
      sgst,
      igst,
      discount,
      roundOff,
      total
    },
    items: items.map((item) => ({
      ...item,
      description: item.description || item.name || 'Line item',
      quantity: item.quantity ?? item.qty ?? null,
      unitPrice: item.unitPrice ?? item.unit_price ?? null,
      unit_price: item.unitPrice ?? item.unit_price ?? null,
      lineTotal: item.lineTotal ?? item.line_total ?? null,
      line_total: item.lineTotal ?? item.line_total ?? null,
      taxableAmount: item.taxableAmount ?? item.taxable_amount ?? item.unitPrice ?? item.unit_price ?? null,
      taxable_amount: item.taxableAmount ?? item.taxable_amount ?? item.unitPrice ?? item.unit_price ?? null,
      gstRate: item.gstRate ?? item.gst_rate ?? null,
      gst_rate: item.gstRate ?? item.gst_rate ?? null
    }))
  };
}
function documentApi(path, options = {}) {
  const token = authToken();
  return fetch(`/api/documents${path}`, { ...options, headers: { ...(options.headers || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) } }).then(async response => {
    const body = response.headers.get('content-type')?.includes('application/json') ? await response.json() : await response.blob();
    if (!response.ok) throw new Error(body?.error?.message || 'Document request failed');
    return body;
  });
}
function showDocumentAuth() {
  documentUi.auth.hidden = false;
  documentUi.auth.innerHTML = '<strong>Connect your ERP session</strong><small>Paste the bearer token issued by the existing ERP login. It stays only in this browser.</small><div><input id="erpTokenInput" type="password" placeholder="Bearer token"><button id="saveErpToken" class="mini-btn" type="button">Connect</button></div>';
  document.getElementById('saveErpToken').onclick = () => { localStorage.setItem('erpAuthToken', document.getElementById('erpTokenInput').value.trim().replace(/^Bearer\s+/i, '')); documentUi.auth.hidden = true; loadDocuments(); };
}
function documentSummary(document) {
  const review = document.invoice_extraction_review || {};
  const fields = normalizeExtractionFields(review.extracted_fields || {});
  const status = review.extraction_status || 'PENDING';
  const confidence = review.confidence_score === null || review.confidence_score === undefined ? '—' : `${Math.round(Number(review.confidence_score) * 100)}%`;
  const invoiceNumber = fields.invoiceNumber || document.metadata?.originalFileName || 'Unnumbered document';
  const vendorName = fields.vendor?.name || 'Vendor needs review';
  const total = fields.amounts?.total ?? null;
  return `<button class="document-row" type="button" data-document-id="${document.document_id}"><span class="doc-badge">${escapeHtml(document.document_type.slice(0, 3))}</span><span><strong>${escapeHtml(invoiceNumber)}</strong><small>${escapeHtml(vendorName)} · ${currency(total)}</small></span><span class="document-status ${status.toLowerCase()}">${escapeHtml(status.replace('_', ' '))}<small>${confidence}</small></span></button>`;
}
function renderDocumentValue(value, emptyText = 'Not detected') {
  if (value === null || value === undefined || value === '') return emptyText;
  return value;
}
function renderInvoiceLineItems(items) {
  if (!Array.isArray(items) || items.length === 0) return '<p class="empty-copy">No extracted line items are available yet.</p>';
  return `
    <table class="line-items-table">
      <thead><tr><th>Item</th><th>Qty</th><th>Unit</th><th>Taxable</th><th>Total</th></tr></thead>
      <tbody>
        ${items.map(item => `<tr><td>${escapeHtml(item.description || 'Item')}</td><td>${escapeHtml(item.quantity ?? '—')}</td><td>${escapeHtml(item.unit || '—')}</td><td>${currency(item.taxableAmount ?? item.taxable_amount ?? null)}</td><td>${currency(item.lineTotal ?? item.line_total ?? null)}</td></tr>`).join('')}
      </tbody>
    </table>
  `;
}
async function loadDocuments() {
  if (!authToken()) { showDocumentAuth(); return; }
  documentUi.auth.hidden = true;
  documentUi.list.innerHTML = '<p class="empty-copy">Loading documents…</p>';
  const query = new URLSearchParams();
  if (documentUi.search.value.trim()) query.set('search', documentUi.search.value.trim());
  if (documentUi.status.value) query.set('status', documentUi.status.value);
  try {
    const response = await documentApi(`/?${query}`);
    documentUi.count.textContent = response.pagination.total;
    documentUi.list.innerHTML = response.data.length ? response.data.map(documentSummary).join('') : '<p class="empty-copy">No documents match these filters.</p>';
    documentUi.list.querySelectorAll('[data-document-id]').forEach(button => button.onclick = () => openDocument(button.dataset.documentId));
  } catch (error) { documentUi.list.innerHTML = `<p class="empty-copy">${escapeHtml(error.message)}</p>`; if (error.message.includes('Authentication')) showDocumentAuth(); }
}
async function openDocument(id) {
  documentUi.detail.hidden = false;
  documentUi.detail.innerHTML = '<p class="empty-copy">Loading document…</p>';
  try {
    const response = await documentApi(`/${id}`);
    const documentRecord = response.data;
    const review = documentRecord.invoice_extraction_review || {};
    const fields = normalizeExtractionFields(review.extracted_fields || { vendor: {}, amounts: {}, items: [] });
    const validation = Array.isArray(review.validation_errors) ? review.validation_errors : [];
    const preview = await documentApi(`/${id}/file`);
    const previewUrl = URL.createObjectURL(preview);
    const previewMarkup = documentRecord.mime_type === 'application/pdf' ? `<embed src="${previewUrl}" type="application/pdf" class="document-preview">` : `<img src="${previewUrl}" class="document-preview" alt="Original uploaded document">`;
    const confidence = review.confidence_score === null || review.confidence_score === undefined ? '—' : `${Math.round(Number(review.confidence_score) * 100)}%`;
    const lineItems = renderInvoiceLineItems(fields.items);
    documentUi.detail.innerHTML = `
      <div class="detail-head">
        <h3>Original & extraction</h3>
        <a class="mini-btn" href="/api/documents/${id}/file" target="_blank" rel="noopener">Open file</a>
        <button id="closeDocumentDetail" class="mini-btn" type="button">Close</button>
      </div>
      <div class="document-split">
        <div>${previewMarkup}</div>
        <form id="documentReviewForm" class="document-form">
          <div class="status-row">
            <p class="eyebrow">${escapeHtml(review.extraction_status || 'PENDING')}</p>
            <span class="confidence-pill">Confidence: ${escapeHtml(confidence)}</span>
          </div>
          ${validation.length ? `<div class="validation-warning"><strong>Needs attention</strong><ul>${validation.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul></div>` : ''}
          <div class="field-grid">
            <label>Invoice number<input name="invoiceNumber" value="${escapeHtml(fields.invoiceNumber || '')}"></label>
            <label>Invoice date<input name="invoiceDate" type="date" value="${escapeHtml(fields.invoiceDate || '')}"></label>
            <label>Vendor<input name="vendorName" value="${escapeHtml(fields.vendor?.name || '')}"></label>
            <label>GSTIN<input name="vendorGstin" value="${escapeHtml(fields.vendor?.gstin || '')}"></label>
            <label>Taxable amount<input name="subtotal" type="number" step="0.01" value="${escapeHtml(fields.amounts?.subtotal ?? '')}"></label>
            <label>CGST<input name="cgst" type="number" step="0.01" value="${escapeHtml(fields.amounts?.cgst ?? '')}"></label>
            <label>SGST<input name="sgst" type="number" step="0.01" value="${escapeHtml(fields.amounts?.sgst ?? '')}"></label>
            <label>IGST<input name="igst" type="number" step="0.01" value="${escapeHtml(fields.amounts?.igst ?? '')}"></label>
            <label>Total<input name="total" type="number" step="0.01" value="${escapeHtml(fields.amounts?.total ?? '')}"></label>
          </div>
          <div class="line-items-panel">${lineItems}</div>
          <label>Review notes<textarea name="notes">${escapeHtml(review.review_notes || '')}</textarea></label>
          <div class="review-actions"><button class="mini-btn" name="action" value="SAVE" type="submit">Save edits</button><button class="mini-btn approve" name="action" value="APPROVED" type="submit">Approve</button><button class="mini-btn reject" name="action" value="REJECTED" type="submit">Reject</button></div>
        </form>
      </div>`;
    document.getElementById('closeDocumentDetail').onclick = () => { URL.revokeObjectURL(previewUrl); documentUi.detail.hidden = true; };
    document.getElementById('documentReviewForm').onsubmit = event => saveDocumentReview(event, review.invoice_extraction_review_id, fields);
  } catch (error) { documentUi.detail.innerHTML = `<p class="empty-copy">${escapeHtml(error.message)}</p>`; }
}
async function saveDocumentReview(event, reviewId, existingFields) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const action = event.submitter.value;
  const amount = field => form.get(field) === '' ? null : Number(form.get(field));
  const extracted_fields = { ...existingFields, invoiceNumber: form.get('invoiceNumber') || null, invoiceDate: form.get('invoiceDate') || null, vendor: { ...(existingFields.vendor || {}), name: form.get('vendorName') || null, gstin: form.get('vendorGstin') || null }, amounts: { ...(existingFields.amounts || {}), subtotal: amount('subtotal'), taxableAmount: amount('subtotal'), cgst: amount('cgst'), sgst: amount('sgst'), igst: amount('igst'), total: amount('total') } };
  try { await documentApi(`/reviews/${reviewId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ extracted_fields, reviewer_decision: action === 'SAVE' ? undefined : action, review_notes: form.get('notes') }) }); showToast(action === 'SAVE' ? 'Corrections saved' : `Document ${action.toLowerCase()}`); loadDocuments(); documentUi.detail.hidden = true; } catch (error) { showToast(error.message); }
}
documentUi.upload.onclick = () => documentUi.file.click();
documentUi.file.onchange = async () => {
  const file = documentUi.file.files[0]; if (!file) return;
  if (!authToken()) { showDocumentAuth(); return; }
  documentUi.upload.disabled = true; documentUi.upload.textContent = 'Processing OCR…';
  try { const data = new FormData(); data.append('file', file); data.append('document_type', 'PURCHASE_INVOICE'); const response = await documentApi('/upload', { method: 'POST', body: data }); showToast(`Document saved: ${response.data.invoice_extraction_review.extraction_status}`); await loadDocuments(); await openDocument(response.data.document_id); } catch (error) { showToast(error.message); } finally { documentUi.upload.disabled = false; documentUi.upload.textContent = 'Scan / Upload'; documentUi.file.value = ''; }
};
let documentSearchTimer;
documentUi.search.oninput = () => { clearTimeout(documentSearchTimer); documentSearchTimer = setTimeout(loadDocuments, 250); };
documentUi.status.onchange = loadDocuments;
