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
