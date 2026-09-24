/* Existing bearer session supplied by the host login; dev fallback is explicitly gated. */
const docs = {
  list: document.getElementById('documentList'), detail: document.getElementById('documentDetail'),
  upload: document.getElementById('documentUploadButton'), file: document.getElementById('documentFileInput'),
  search: document.getElementById('documentSearch'), status: document.getElementById('documentStatus'),
  auth: document.getElementById('documentAuth'), count: document.getElementById('documentCount'), preview: null, sequence: 0
};
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const token = () => window.ERP_AUTH_TOKEN || sessionStorage.getItem('erpAuthToken') || localStorage.getItem('erpAuthToken') || '';
const display = value => value == null || value === '' ? 'Not detected' : escapeHtml(value);
const money = value => value == null || value === '' ? 'Not detected' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(value);
const confidenceLabel = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Math.round(Math.max(0, Math.min(1, Number(value))) * 100) + '%' : 'Not detected';
const evidenceBadge = evidence => evidence ? `<small class="field-evidence">${confidenceLabel(evidence.confidence)} · page ${escapeHtml(evidence.page || '?')} · ${escapeHtml(evidence.source || 'unknown source')}</small>` : '<small class="field-evidence uncertain">Manual verification required</small>';
const progress = document.createElement('p'); progress.className = 'ocr-progress'; progress.setAttribute('role', 'status'); docs.upload.parentElement.after(progress);
const filters = document.createElement('div'); filters.className = 'document-filters';
filters.innerHTML = '<label>Type <select id="docType"><option value="">All</option><option>PURCHASE_INVOICE</option><option>SALES_INVOICE</option></select></label><label>From <input type="date" id="docFrom"></label><label>To <input type="date" id="docTo"></label>';
docs.list.parentElement.before(filters);
async function api(path, options = {}) {
  const response = await fetch(`/api/documents${path}`, { ...options, headers: { ...(token() ? { Authorization: `Bearer ${token()}` } : {}), ...options.headers } });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const error = new Error(body.error?.message || 'Document request failed'); error.status = response.status; error.details = body.error?.details; throw error;
  }
  return options.blob ? response.blob() : response.json();
}
async function showSessionHelp() {
  const config = await fetch('/api/session-config').then(response => response.json()).catch(() => ({}));
  docs.auth.hidden = false;
  docs.auth.textContent = 'Your ERP session is missing or expired. Sign in through your ERP login.';
  if (!config.developmentTokenFallback) return;
  docs.auth.innerHTML = '<strong>Development only: connect a seeded user</strong><small>This prototype has no real login. Paste a token generated with the backend’s existing authentication helper.</small><input id="devToken" type="password" autocomplete="off"><button id="connectDev" type="button">Connect</button>';
  document.getElementById('connectDev').onclick = () => { sessionStorage.setItem('erpAuthToken', document.getElementById('devToken').value.trim().replace(/^Bearer\s+/i, '')); loadDocuments(); };
}
async function loadDocuments() {
  const sequence = ++docs.sequence;
  docs.auth.hidden = true;
  docs.list.textContent = 'Loading documents…';
  const params = new URLSearchParams({ search: docs.search.value, status: docs.status.value, pageSize: '100', documentType: document.getElementById('docType').value, from: document.getElementById('docFrom').value, to: document.getElementById('docTo').value });
  try {
    const response = await api(`?${params}`);
    if (sequence !== docs.sequence) return;
    docs.count.textContent = response.pagination.total;
    docs.list.innerHTML = response.data.map(item => {
      const review = item.invoice_extraction_review || {}, fields = review.extracted_fields || {};
      return `<button type="button" class="document-row" data-id="${item.document_id}"><span class="doc-badge">DOC</span><span><strong>${display(fields.invoiceNumber)}</strong><small>${display(fields.vendor?.name)} · ${money(fields.amounts?.total)}</small><small>${display(fields.invoiceDate)} · ${display(item.document_type)} · uploaded ${new Date(item.uploaded_at).toLocaleString()}</small></span><span class="document-status ${String(review.extraction_status).toLowerCase()}">${display(review.extraction_status)}<small>${review.confidence_score == null ? 'Not detected' : confidenceLabel(review.confidence_score)}</small></span></button>`;
    }).join('') || '<p>No documents match these filters.</p>';
    docs.list.querySelectorAll('[data-id]').forEach(button => button.onclick = () => openDocument(button.dataset.id));
  } catch (error) { docs.list.textContent = error.message; if (error.status === 401) await showSessionHelp(); }
}
function closeDocument() { if (docs.preview) URL.revokeObjectURL(docs.preview); docs.preview = null; docs.detail.hidden = true; }
async function openDocument(id) {
  closeDocument(); docs.detail.hidden = false; docs.detail.textContent = 'Loading saved document…';
  try {
    const { data: record } = await api(`/${id}`);
    const review = record.invoice_extraction_review || {}, fields = review.extracted_fields || {}, amounts = fields.amounts || {};
    const evidence = fields.fieldEvidence || fields.canonical?.field_evidence || {};
    const inputs = [['invoiceNumber', 'Invoice number', fields.invoiceNumber, 'invoice.number'], ['invoiceDate', 'Invoice date', fields.invoiceDate, 'invoice.date'], ['vendorName', 'Vendor', fields.vendor?.name, 'supplier.name'], ['gstin', 'Vendor GSTIN', fields.vendor?.gstin, 'supplier.gstin'], ['pan', 'Vendor PAN', fields.vendor?.pan, 'supplier.pan'], ['buyerGstin', 'Buyer GSTIN', fields.buyer?.gstin, 'buyer.gstin'], ...[['subtotal','totals.subtotal'],['taxableAmount','totals.taxable_amount'],['cgst','taxes.cgst'],['sgst','taxes.sgst'],['igst','taxes.igst'],['discount','totals.discount'],['roundOff','totals.round_off'],['total','totals.grand_total']].map(([key,path]) => [key, key, amounts[key], path])];
      const pageTypes = (fields.canonical?.pages || []).map(page => `Page ${page.pageNumber}: ${page.type} (${Math.round(Number(page.confidence || 0) * 100)}%)`).join(' · ');
    docs.detail.innerHTML = `<div class="detail-head"><h3>Invoice review</h3><button id="closeDoc" type="button">Close</button></div><p>${display(review.extraction_status)} · Confidence ${review.confidence_score == null ? 'Not detected' : confidenceLabel(review.confidence_score)} · ${display(review.extraction_engine)}</p>${pageTypes ? `<p class="page-types">${escapeHtml(pageTypes)}</p>` : ''}<div class="document-split"><div id="originalPreview">Loading original…</div><form class="document-form" id="reviewForm"><div class="validation-warning"><ul>${(review.validation_errors || []).map(error => `<li>${escapeHtml(error)}</li>`).join('') || '<li>No validation issues detected. Verify against the original before approval.</li>'}</ul></div>${inputs.map(([key,label,value,path]) => `<label>${label}${evidenceBadge(evidence[path])}<input name="${key}" value="${escapeHtml(value)}" placeholder="Not detected"></label>`).join('')}<label class="wide">Review notes<textarea name="notes">${escapeHtml(review.review_notes)}</textarea></label><div class="review-actions"><button value="SAVE">Save edits</button><button value="APPROVED">Approve</button><button value="REJECTED">Reject</button>${['FAILED','NEEDS_REVIEW'].includes(review.extraction_status) && !review.reviewed_at ? '<button type="button" id="retryDoc">Retry extraction</button>' : ''}</div><p id="reviewMessage" class="wide" role="status"></p></form></div><details><summary>Field provenance</summary><pre class="raw-text">${escapeHtml(JSON.stringify(evidence, null, 2))}</pre></details><details><summary>Raw extracted text</summary><pre class="raw-text">${display(review.raw_ocr_output?.text)}</pre></details>`;
    document.getElementById('closeDoc').onclick = closeDocument;
    document.getElementById('retryDoc')?.addEventListener('click', async event => { event.target.disabled = true; progress.textContent = 'Extracting invoice details…'; try { await api(`/${id}/retry`, { method: 'POST' }); await openDocument(id); await loadDocuments(); progress.textContent = 'Extraction complete'; } catch (error) { progress.textContent = error.message; event.target.disabled = false; } });
    document.getElementById('reviewForm').onsubmit = async event => {
      event.preventDefault(); const form = new FormData(event.currentTarget), decision = event.submitter.value;
      try {
        const corrected = { ...fields, invoiceNumber: form.get('invoiceNumber'), invoiceDate: form.get('invoiceDate'), vendor: { ...fields.vendor, name: form.get('vendorName'), gstin: form.get('gstin'), pan: form.get('pan') }, buyer: { ...fields.buyer, gstin: form.get('buyerGstin') }, amounts: { ...amounts } };
        for (const key of ['subtotal','taxableAmount','cgst','sgst','igst','discount','roundOff','total']) { const value = form.get(key).trim(); if (value && !Number.isFinite(Number(value))) throw new Error(`${key} must be numeric.`); corrected.amounts[key] = value ? Number(value) : null; }
        await api(`/reviews/${review.invoice_extraction_review_id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ extracted_fields: corrected, reviewer_decision: decision === 'SAVE' ? 'NEEDS_CORRECTION' : decision, review_notes: form.get('notes') }) });
        await openDocument(id); await loadDocuments();
      } catch (error) {
        const validationErrors = error.details?.validationErrors;
        document.getElementById('reviewMessage').textContent = validationErrors?.length ? `${error.message} ${validationErrors.join(' ')}` : error.message;
      }
    };
    try {
      const blob = await api(`/${id}/file`, { blob: true }); docs.preview = URL.createObjectURL(blob);
      document.getElementById('originalPreview').innerHTML = record.mime_type === 'application/pdf' ? `<iframe class="document-preview" src="${docs.preview}" title="Original PDF"></iframe>` : `<img class="document-preview" src="${docs.preview}" alt="Original invoice">`;
    } catch (error) { document.getElementById('originalPreview').textContent = error.message; }
  } catch (error) { docs.detail.textContent = error.message; }
}
docs.upload.onclick = () => docs.file.click();
docs.file.onchange = async () => {
  const file = docs.file.files[0]; if (!file) return;
  docs.upload.disabled = true; progress.textContent = 'Uploading…';
  try {
    const response = await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest(); xhr.open('POST', '/api/documents/upload'); if (token()) xhr.setRequestHeader('Authorization', `Bearer ${token()}`);
      xhr.upload.onprogress = event => { progress.textContent = event.lengthComputable ? `Uploading ${Math.round(event.loaded / event.total * 100)}%` : 'Uploading…'; };
      xhr.upload.onload = () => { progress.textContent = 'Extracting invoice details…'; };
      xhr.onload = () => { try { const result = JSON.parse(xhr.responseText); if (xhr.status >= 400) { const error = new Error(result.error?.message || 'Upload failed'); error.status = xhr.status; reject(error); } else resolve(result); } catch { reject(new Error('Invalid server response')); } };
      xhr.onerror = () => reject(new Error('Connection interrupted. Refresh Documents to check whether the upload was saved.'));
      const data = new FormData(); data.append('file', file); data.append('document_type', 'PURCHASE_INVOICE'); xhr.send(data);
    });
    progress.textContent = `Saved — ${response.data.invoice_extraction_review.extraction_status}`;
    await loadDocuments(); await openDocument(response.data.document_id); docs.detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) { progress.textContent = error.message; if (error.status === 401) await showSessionHelp(); }
  finally { docs.upload.disabled = false; docs.file.value = ''; }
};
let searchTimer;
docs.search.oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(loadDocuments, 250); };
docs.status.onchange = loadDocuments;
filters.querySelectorAll('input,select').forEach(input => input.onchange = loadDocuments);
