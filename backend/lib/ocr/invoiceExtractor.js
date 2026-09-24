const { aliasesFor, normalizeLabel } = require('./semanticVocabulary');
const { classifyDocument } = require('./documentClassifier');

const GSTIN_PATTERN = /\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/i;
const PAN_PATTERN = /\b[A-Z]{5}\d{4}[A-Z]\b/i;
const NUMBER_PATTERN = /[A-Z0-9][A-Z0-9/._-]{2,}/i;

function cleanAmount(value) {
  if (value === null || value === undefined || value === '') return null;
  const normalized = String(value).replace(/\s/g, '').replace(/,/g, '').replace(/[^\d().-]/g, '').replace(/^\((.*)\)$/, '-$1');
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function dateValue(value) {
  if (!value) return null;
  const source = String(value).replace(/,/g, ' ');
  const named = source.match(/\b(\d{1,2})[- /.]([a-z]{3,9})[- /.](\d{2,4})\b/i);
  if (named) {
    const month = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(named[2].slice(0, 3).toLowerCase()) + 1;
    if (month) return normalizeDate(named[3], month, named[1]);
  }
  const dmy = source.match(/\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})\b/);
  if (dmy) return normalizeDate(dmy[3], dmy[2], dmy[1]);
  const ymd = source.match(/\b(\d{4})[/.\-](\d{1,2})[/.\-](\d{1,2})\b/);
  return ymd ? normalizeDate(ymd[1], ymd[2], ymd[3]) : null;
}

function normalizeDate(year, month, day) {
  const fullYear = String(year).length === 2 ? `20${year}` : String(year);
  const iso = `${fullYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) && !Number.isNaN(Date.parse(`${iso}T00:00:00Z`)) && new Date(`${iso}T00:00:00Z`).toISOString().slice(0, 10) === iso ? iso : null;
}

function coerceOcr(input) {
  if (input && typeof input === 'object' && Array.isArray(input.pages)) return input;
  const text = String(input || '').replace(/\r/g, '').replace(/\u00a0/g, ' ');
  return { text, confidence: 100, pages: [{ pageNumber: 1, width: 0, height: 0, text, confidence: 1, source: 'plain_text', lines: text.split('\n').map(line => ({ text: line.trim(), confidence: 1, bbox: null, words: [] })).filter(line => line.text) }] };
}

function contextFor(input) {
  const ocr = coerceOcr(input);
  const classification = classifyDocument(ocr);
  const pageTypes = new Map(classification.pages.map(page => [page.pageNumber, page.type]));
  const lines = [];
  for (const page of ocr.pages) {
    const sourceLines = page.lines?.length ? page.lines : String(page.text || '').split(/\r?\n/).map(text => ({ text, confidence: page.confidence ?? 1, bbox: null, words: [] }));
    for (const [index, line] of sourceLines.entries()) if (String(line.text || '').trim()) lines.push({ ...line, index, page: page.pageNumber, pageType: pageTypes.get(page.pageNumber) || 'UNKNOWN', confidence: Number(line.confidence ?? page.confidence ?? 0), words: line.words || [] });
  }
  return { ocr, classification, lines };
}

const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function labelRegex(alias) {
  return new RegExp(`\\b${alias.split(' ').map(token => token === 'no' ? 'n[o0]' : escapeRegex(token)).join('[\\s./#:_-]*')}\\b`, 'i');
}

function sourceEvidence(line, matchedLabel, source = 'semantic_label') {
  return { source, matchedLabel, page: line.page, bbox: line.bbox || null, ocrConfidence: Math.max(0, Math.min(1, Number(line.confidence || 0))) };
}

function parseNumber(value) {
  const match = String(value || '').toUpperCase().match(NUMBER_PATTERN);
  const candidate = match?.[0]?.replace(/[.,;:]$/, '') || null;
  return candidate && /\d/.test(candidate) ? candidate : null;
}

function parseInvoiceNumber(value) {
  const candidate = parseNumber(value)?.replace(/[.,;:]$/, '') || null;
  if (!candidate || candidate.length > 40 || !/\d/.test(candidate)) return null;
  if (/^\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}$/.test(candidate)) return null;
  if (GSTIN_PATTERN.test(candidate) || PAN_PATTERN.test(candidate) || /^[0-9a-f]{32,}$/i.test(candidate)) return null;
  if (!/^[A-Z0-9][A-Z0-9/._-]*$/i.test(candidate)) return null;
  return candidate;
}

function parseVehicleNumber(value) {
  const compact = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const candidate = compact.match(/(?:[A-Z]{2}\d{1,2}[A-Z]{1,3}\d{3,4}|\d{2}BH\d{4}[A-Z]{1,2})/)?.[0] || null;
  const stateCodes = new Set(['AN','AP','AR','AS','BR','CG','CH','DD','DL','DN','GA','GJ','HP','HR','JH','JK','KA','KL','LA','LD','MH','ML','MN','MP','MZ','NL','OD','PB','PY','RJ','SK','TN','TR','TS','UK','UP','WB']);
  return candidate && (/^\d{2}BH/.test(candidate) || stateCodes.has(candidate.slice(0, 2))) ? candidate : null;
}

function parseEwayNumber(value) {
  return String(value || '').replace(/\D/g, '').match(/\d{11,12}/)?.[0] || null;
}

function parseParty(value) {
  const cleaned = String(value || '').replace(/\b(?:GSTIN|GST\s*(?:NO|NUMBER)|PAN)\b.*$/i, '').replace(/^[\s:#-]+/, '').trim();
  if (!cleaned || !/[A-Z]/i.test(cleaned) || /^(?:and|to|from|supplier|buyer|recipient|purchaser|ship to|bill to|date|dated|name|address|invoice|document|place of supply|maharashtra|s ref|s ref no|s order no)$/i.test(normalizeLabel(cleaned)) || /(?:duplicate|triplicate|extra) for|\b[3G]STI?N\b/i.test(cleaned) || (cleaned.match(/\d/g) || []).length > 6) return null;
  return cleaned.slice(0, 180);
}

function aliasBox(line, alias) {
  const tokens = alias.split(' ');
  for (let start = 0; start < (line.words || []).length; start++) {
    for (let length = Math.min(tokens.length + 1, line.words.length - start); length >= Math.max(1, tokens.length - 1); length--) {
      const words = line.words.slice(start, start + length);
      if (normalizeLabel(words.map(word => word.text).join(' ')) !== alias || !words.every(word => word.bbox)) continue;
      return { x0: Math.min(...words.map(word => word.bbox.x0)), y0: Math.min(...words.map(word => word.bbox.y0)), x1: Math.max(...words.map(word => word.bbox.x1)), y1: Math.max(...words.map(word => word.bbox.y1)) };
    }
  }
  return line.bbox;
}

function spatialRaw(ctx, line, alias, parser) {
  const label = aliasBox(line, alias);
  if (!label) return [];
  const height = Math.max(8, label.y1 - label.y0);
  const candidates = ctx.lines.filter(candidate => candidate !== line && candidate.page === line.page && candidate.bbox).map(candidate => {
    const valueWords = (candidate.words || []).filter(word => word.bbox && parser(word.text, candidate) !== null);
    const boxes = valueWords.length ? valueWords.map(word => word.bbox) : [candidate.bbox];
    const candidateBox = { x0: Math.min(...boxes.map(box => box.x0)), y0: Math.min(...boxes.map(box => box.y0)), x1: Math.max(...boxes.map(box => box.x1)), y1: Math.max(...boxes.map(box => box.y1)) };
    const sameRow = candidateBox.y0 <= label.y1 + height && candidateBox.y1 >= label.y0 - height;
    const toRight = sameRow && candidateBox.x0 >= label.x1 - 5;
    const below = candidateBox.y0 >= label.y1 - 5 && candidateBox.y0 <= label.y1 + Math.max(120, height * 6) && candidateBox.x1 >= label.x0 - 20 && candidateBox.x0 <= label.x0 + Math.max(320, (label.x1 - label.x0) * 5);
    if (!toRight && !below) return null;
    const distance = toRight ? candidateBox.x0 - label.x1 : (candidateBox.y0 - label.y1) * 2 + Math.abs(candidateBox.x0 - label.x0) * 0.2;
    const valueConfidence = valueWords.length ? valueWords.reduce((sum, word) => sum + Number(word.confidence ?? candidate.confidence ?? 0), 0) / valueWords.length : Number(candidate.confidence ?? 0);
    return { raw: valueWords.length ? valueWords.map(word => word.text).join(' ') : candidate.text, confidence: valueConfidence, relationship: toRight ? 'spatial_right' : 'spatial_below', distance };
  }).filter(Boolean).sort((a, b) => a.distance - b.distance);
  return candidates;
}

function parseAmount(value) {
  const values = [...String(value || '').replace(/\d+(?:\.\d+)?\s*%/g, '').matchAll(/-?\(?\d[\d,]*(?:\.\d{1,3})?\)?/g)].map(match => cleanAmount(match[0])).filter(value => value !== null);
  return values.length ? values[values.length - 1] : null;
}

function parseGstin(value) {
  return String(value || '').toUpperCase().match(GSTIN_PATTERN)?.[0] || null;
}

function candidateValues(ctx, field, parser, options = {}) {
  const aliases = (options.aliases || aliasesFor(field)).sort((a, b) => b.length - a.length);
  const candidates = [];
  for (const [linePosition, line] of ctx.lines.entries()) {
    if (options.pageTypes && !options.pageTypes.includes(line.pageType)) continue;
    const normalized = normalizeLabel(line.text);
    if (options.exclude?.some(pattern => pattern.test(normalized))) continue;
    for (const alias of aliases) {
      if (field === 'invoice.number' && !['invoice number', 'invoice no', 'tax invoice number', 'tax invoice no', 'invoice #', 'invoice', 'inv number', 'inv no', 'inv #', 'inv', 'bill number', 'bill no', 'document number', 'document no'].includes(alias)) continue;
      if (field === 'invoice.number' && ['invoice', 'inv'].includes(alias) && !new RegExp(`\\b${alias}\\s*#`, 'i').test(line.text)) continue;
      if (field === 'invoice.number' && ['document number', 'document no'].includes(alias) && line.pageType !== 'E_INVOICE_REPORT') continue;
      if (field === 'invoice.number' && ['bill number', 'bill no'].includes(alias) && line.pageType !== 'TAX_INVOICE') continue;
      if (field === 'supplier.name' && alias === 'from' && !/^from\b/.test(normalized)) continue;
      const regex = labelRegex(alias);
      const match = String(line.text).match(regex);
      if (!match) continue;
      let raw = String(line.text).slice((match.index || 0) + match[0].length).replace(/^[\s:#=.-]+/, '');
      let relationship = 'same_line';
      let valueLineConfidence = line.confidence;
      if (!raw.trim()) {
        const next = ctx.lines[linePosition + 1];
        if (next && next.page === line.page) { raw = next.text; relationship = 'next_line'; valueLineConfidence = next.confidence; }
      }
      let value = null;
      if (options.singleWord) {
        const label = aliasBox(line, alias);
        const wordCandidate = label && (line.words || []).filter(word => word.bbox && word.bbox.x0 >= label.x1 - 5 && word.bbox.y0 <= label.y1 + 8 && word.bbox.y1 >= label.y0 - 8).sort((a, b) => a.bbox.x0 - b.bbox.x0).find(word => parser(word.text, line) !== null);
        if (wordCandidate) { raw = wordCandidate.text; relationship = 'same_line_word'; value = parser(raw, line); }
      }
      if (value === null || value === undefined || value === '') value = parser(raw, line);
      if (value === null || value === undefined || value === '') {
        for (const spatial of options.allowSpatial === false ? [] : spatialRaw(ctx, line, alias, parser)) {
          const parsed = parser(spatial.raw, line);
          if (parsed !== null && parsed !== undefined && parsed !== '') { raw = spatial.raw; relationship = spatial.relationship; value = parsed; valueLineConfidence = spatial.confidence; break; }
        }
      }
      if (value === null || value === undefined || value === '') continue;
      const explicitHashLabel = ['invoice', 'inv'].includes(alias) && new RegExp(`\\b${alias}\\s*#`, 'i').test(line.text);
      const labelStrength = options.labelStrength?.[alias] ?? (explicitHashLabel || alias.split(' ').length > 1 ? 1 : 0.65);
      const proximity = relationship === 'same_line' || relationship === 'same_line_word' || relationship === 'spatial_right' ? 1 : 0.75;
      const pageType = line.pageType === 'TAX_INVOICE' ? 1 : line.pageType === 'E_INVOICE_REPORT' ? 0.78 : 0.62;
      const compactValue = String(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
      const valueWord = (line.words || []).find(word => String(word.text || '').toUpperCase().replace(/[^A-Z0-9]/g, '') === compactValue);
      const ocrConfidence = Math.max(0, Math.min(1, Number(valueWord?.confidence ?? valueLineConfidence) || 0));
      const score = Math.max(0, Math.min(0.99, 0.12 + 0.29 * labelStrength + 0.16 * proximity + 0.17 * pageType + 0.26 * ocrConfidence));
      candidates.push({ value, confidence: score, labelStrength, ...sourceEvidence(line, match[0]), ocrConfidence, relationship, raw: raw.slice(0, 160) });
      break;
    }
  }
  return candidates.sort((a, b) => b.confidence - a.confidence);
}

function selectCandidate(candidates, field, canonical) {
  if (!candidates.length) return null;
  const selected = candidates[0];
  const normalizedSelected = normalizeLabel(String(selected.value), false);
  const competingThreshold = field === 'invoice.number' ? 0.80 : 0.85;
  const competingMargin = field === 'invoice.number' ? 0.15 : 0.04;
  const conflict = candidates.find(candidate => candidate.confidence >= competingThreshold && normalizeLabel(String(candidate.value), false) !== normalizedSelected && selected.confidence - candidate.confidence <= competingMargin);
  canonical.field_evidence[field] = { value: selected.value, confidence: selected.confidence, ocrConfidence: selected.ocrConfidence, relationship: selected.relationship, source: selected.source, matchedLabel: selected.matchedLabel, page: selected.page, bbox: selected.bbox, candidates: candidates.slice(0, 5) };
  if (conflict) canonical.conflicts.push({ field, values: [selected.value, conflict.value], pages: [selected.page, conflict.page] });
  return selected.value;
}

function extractParties(ctx, canonical) {
  const supplierNames = candidateValues(ctx, 'supplier.name', parseParty, { preferredPageTypes: ['TAX_INVOICE', 'E_INVOICE_REPORT'], exclude: [/suppliers? ref|supplier gstin|gstin of supplier/] });
  const buyerNames = candidateValues(ctx, 'buyer.name', parseParty, { preferredPageTypes: ['TAX_INVOICE', 'E_INVOICE_REPORT'], exclude: [/buyers? order|buyer gstin|gstin of recipient|gstin of buyer|name address of buyer/] });
  for (const line of ctx.lines.filter(line => line.pageType === 'TAX_INVOICE' && line.bbox && line.bbox.y0 < 700)) {
    if (/\b(?:LTD|LIMITED|PRIVATE|PVT|INDUSTR|FORGING|STEEL|ALLOY|WORKS)\b/i.test(line.text) && !/buyer|recipient|invoice|gstin/i.test(line.text)) supplierNames.push({ value: line.text.trim(), confidence: 0.78, ...sourceEvidence(line, 'invoice header', 'header_party') });
  }
  const plausible = candidate => {
    const normalized = normalizeLabel(candidate.value);
    const businessMarkers = normalized.match(/\b(?:ltd|limited|private|pvt|industries|forging|steel|alloys?|ingots?|works|enterprise|petrocoal)\b/g) || [];
    const suffixes = normalized.match(/\b(?:ltd|limited)\b/g) || [];
    return normalized.replace(/\s/g, '').length >= 4 && businessMarkers.length > 0 && suffixes.length <= 1 && !/\b(?:located in same state|recipient located|transportation|dispatch|transporter details|place of supply|details of consignee|ref no|order no|bill to)\b/.test(normalized);
  };
  const gstinCandidates = { supplier: candidateValues(ctx, 'supplier.gstin', parseGstin), buyer: candidateValues(ctx, 'buyer.gstin', parseGstin) };
  let role = null;
  let roleAge = 99;
  for (const line of ctx.lines) {
    const normalized = normalizeLabel(line.text);
    if (/\b(supplier|seller|vendor|details of supplier|from)\b/.test(normalized) && !/\bbuyer|recipient|ship to\b/.test(normalized)) { role = 'supplier'; roleAge = 0; }
    if (/\b(buyer|recipient|bill to|billed to|consignee|details of recipient)\b/.test(normalized)) { role = 'buyer'; roleAge = 0; }
    const gstins = [...String(line.text).toUpperCase().matchAll(new RegExp(GSTIN_PATTERN.source, 'g'))];
    for (const match of gstins) {
      const explicitRole = /buyer|recipient|consignee/.test(normalized) ? 'buyer' : /supplier|seller|vendor/.test(normalized) ? 'supplier' : roleAge <= 5 ? role : null;
      if (explicitRole) {
        gstinCandidates[explicitRole].push({ value: match[0], confidence: explicitRole === role ? 0.86 : 0.92, ...sourceEvidence(line, explicitRole === 'supplier' ? 'Supplier GSTIN' : 'Buyer GSTIN', 'contextual_gstin') });
        const nearbyName = parseParty(String(line.text).replace(match[0], '').replace(/\b(?:GSTIN|GST\s*(?:NO|NUMBER)|OF\s+(?:SUPPLIER|RECIPIENT))\b/gi, ''));
        if (nearbyName && /\b(?:LTD|LIMITED|PRIVATE|PVT|INDUSTR|FORGING|STEEL|ALLOY|WORKS)\b/i.test(nearbyName)) (explicitRole === 'supplier' ? supplierNames : buyerNames).push({ value: nearbyName, confidence: 0.9, ...sourceEvidence(line, explicitRole === 'supplier' ? 'Supplier GSTIN context' : 'Buyer GSTIN context', 'gstin_nearby_name') });
      }
    }
    roleAge++;
  }
  canonical.supplier.name = selectCandidate(supplierNames.filter(plausible).sort((a, b) => b.confidence - a.confidence), 'supplier.name', canonical);
  canonical.buyer.name = selectCandidate(buyerNames.filter(plausible).sort((a, b) => b.confidence - a.confidence), 'buyer.name', canonical);
  canonical.supplier.gstin = selectCandidate(gstinCandidates.supplier.sort((a, b) => b.confidence - a.confidence), 'supplier.gstin', canonical);
  canonical.buyer.gstin = selectCandidate(gstinCandidates.buyer.sort((a, b) => b.confidence - a.confidence), 'buyer.gstin', canonical);
  canonical.supplier.pan = canonical.supplier.gstin?.slice(2, 12) || null;
  canonical.buyer.pan = canonical.buyer.gstin?.slice(2, 12) || null;
}

function relatedDocuments(ctx, canonical) {
  const related = [];
  for (const pageInfo of ctx.classification.pages) {
    const page = ctx.ocr.pages.find(item => item.pageNumber === pageInfo.pageNumber);
    const pageCtx = contextFor({ text: page?.text || '', confidence: (page?.confidence || 0) * 100, pages: [page] });
    if (pageInfo.type === 'E_WAY_BILL') {
      const labeledEway = selectCandidate(candidateValues(pageCtx, 'logistics.eway_bill_number', parseEwayNumber, { singleWord: true }), `related.${pageInfo.pageNumber}.eway_bill_number`, canonical);
      const exactTwelveDigit = String(page?.text || '').match(/\b\d{12}\b/)?.[0] || null;
      related.push({ type: pageInfo.type, page: pageInfo.pageNumber, eway_bill_number: labeledEway || exactTwelveDigit, date: selectCandidate(candidateValues(pageCtx, 'invoice.date', dateValue, { singleWord: true }), `related.${pageInfo.pageNumber}.date`, canonical) });
    }
    if (pageInfo.type === 'E_INVOICE_REPORT') related.push({ type: pageInfo.type, page: pageInfo.pageNumber, irn: selectCandidate(candidateValues(pageCtx, 'e_invoice.irn', value => String(value).match(/\b[a-f0-9]{64}\b/i)?.[0] || null), `related.${pageInfo.pageNumber}.irn`, canonical), ack_number: selectCandidate(candidateValues(pageCtx, 'e_invoice.ack_number', parseNumber, { singleWord: true }), `related.${pageInfo.pageNumber}.ack_number`, canonical), ack_date: selectCandidate(candidateValues(pageCtx, 'e_invoice.ack_date', dateValue, { singleWord: true }), `related.${pageInfo.pageNumber}.ack_date`, canonical), document_number: selectCandidate(candidateValues(pageCtx, 'invoice.number', parseInvoiceNumber, { aliases: ['document number', 'document no'], singleWord: true, exclude: [/ack|irn|e way|eway|reference|po\b/] }), `related.${pageInfo.pageNumber}.document_number`, canonical), document_date: selectCandidate(candidateValues(pageCtx, 'invoice.date', dateValue, { singleWord: true }), `related.${pageInfo.pageNumber}.document_date`, canonical), eway_bill_number: selectCandidate(candidateValues(pageCtx, 'logistics.eway_bill_number', parseEwayNumber, { singleWord: true }), `related.${pageInfo.pageNumber}.eway_bill_number`, canonical) });
    if (pageInfo.type === 'WEIGHBRIDGE_SLIP') related.push({ type: pageInfo.type, page: pageInfo.pageNumber, vehicle_number: selectCandidate(candidateValues(pageCtx, 'logistics.vehicle_number', parseVehicleNumber), `related.${pageInfo.pageNumber}.vehicle_number`, canonical), gross_weight: selectCandidate(candidateValues(pageCtx, 'weighbridge.gross_weight', parseAmount), `related.${pageInfo.pageNumber}.gross_weight`, canonical), tare_weight: selectCandidate(candidateValues(pageCtx, 'weighbridge.tare_weight', parseAmount), `related.${pageInfo.pageNumber}.tare_weight`, canonical), net_weight: selectCandidate(candidateValues(pageCtx, 'weighbridge.net_weight', parseAmount), `related.${pageInfo.pageNumber}.net_weight`, canonical) });
    if (['MATERIAL_RECEIPT_NOTE', 'GOODS_INWARD_REPORT'].includes(pageInfo.type)) related.push({ type: pageInfo.type, page: pageInfo.pageNumber, number: selectCandidate(candidateValues(pageCtx, 'mrn.number', parseNumber), `related.${pageInfo.pageNumber}.number`, canonical), invoice_number: selectCandidate(candidateValues(pageCtx, 'mrn.invoice_number', parseInvoiceNumber, { exclude: [/challan/] }), `related.${pageInfo.pageNumber}.invoice_number`, canonical), date: selectCandidate(candidateValues(pageCtx, 'mrn.date', dateValue), `related.${pageInfo.pageNumber}.date`, canonical), gate_entry_number: selectCandidate(candidateValues(pageCtx, 'mrn.gate_entry_number', parseNumber), `related.${pageInfo.pageNumber}.gate_entry_number`, canonical) });
  }
  return related;
}

function emptyCanonical(documentType, pages) {
  return { schema_version: '1.0', document_type: documentType, pages, invoice: { number: null, date: null, due_date: null, po_number: null }, supplier: { name: null, gstin: null, pan: null, address: null, state: null }, buyer: { name: null, gstin: null, pan: null, address: null, state: null }, ship_to: { name: null, gstin: null, address: null, state: null }, logistics: { eway_bill_number: null, vehicle_number: null, lr_number: null, transporter: null, place_of_supply: null }, items: [], taxes: { cgst: null, sgst: null, igst: null, cess: null }, totals: { subtotal: null, taxable_amount: null, discount: null, other_charges: null, round_off: null, grand_total: null }, e_invoice: { irn: null, ack_number: null, ack_date: null }, related_documents: [], field_evidence: {}, conflicts: [] };
}

function extractStructuredDocument(input) {
  const ctx = contextFor(input);
  const canonical = emptyCanonical(ctx.classification.documentType, ctx.classification.pages);
  canonical.invoice.number = selectCandidate(candidateValues(ctx, 'invoice.number', parseInvoiceNumber, { pageTypes: ['TAX_INVOICE', 'UNKNOWN'], preferredPageTypes: ['TAX_INVOICE'], exclude: [/purchase order|\bpo\b|sales order|e way|eway|ack|irn|gstin|pan|vehicle|\blr\b|lorry|challan|\bmrn\b|gate entry|phone|mobile|bank|ifsc|hsn|sac|taxable|amount|total|page|serial|transport|reference|document no/], singleWord: true }), 'invoice.number', canonical);
  canonical.invoice.date = selectCandidate(candidateValues(ctx, 'invoice.date', dateValue, { pageTypes: ['TAX_INVOICE', 'UNKNOWN'], preferredPageTypes: ['TAX_INVOICE'], singleWord: true }), 'invoice.date', canonical);
  canonical.invoice.due_date = selectCandidate(candidateValues(ctx, 'invoice.due_date', dateValue), 'invoice.due_date', canonical);
  canonical.invoice.po_number = selectCandidate(candidateValues(ctx, 'invoice.po_number', parseNumber, { pageTypes: ['TAX_INVOICE', 'E_INVOICE_REPORT', 'UNKNOWN'], singleWord: true }), 'invoice.po_number', canonical);
  extractParties(ctx, canonical);
  for (const [path, field, parser] of [
    ['logistics.eway_bill_number', 'logistics.eway_bill_number', parseEwayNumber], ['logistics.vehicle_number', 'logistics.vehicle_number', parseVehicleNumber], ['logistics.lr_number', 'logistics.lr_number', parseNumber], ['logistics.transporter', 'logistics.transporter', parseParty], ['logistics.place_of_supply', 'logistics.place_of_supply', parseParty],
    ['e_invoice.irn', 'e_invoice.irn', value => String(value).match(/\b[a-f0-9]{64}\b/i)?.[0] || null], ['e_invoice.ack_number', 'e_invoice.ack_number', parseNumber], ['e_invoice.ack_date', 'e_invoice.ack_date', dateValue],
    ['totals.subtotal', 'totals.subtotal', parseAmount], ['totals.taxable_amount', 'totals.taxable_amount', parseAmount], ['totals.discount', 'totals.discount', parseAmount], ['totals.other_charges', 'totals.other_charges', parseAmount], ['totals.round_off', 'totals.round_off', parseAmount], ['totals.grand_total', 'totals.grand_total', parseAmount],
    ['taxes.cgst', 'taxes.cgst', parseAmount], ['taxes.sgst', 'taxes.sgst', parseAmount], ['taxes.igst', 'taxes.igst', parseAmount], ['taxes.cess', 'taxes.cess', parseAmount]
  ]) {
    const [group, key] = path.split('.');
    const financial = group === 'totals' || group === 'taxes';
    const wordScoped = financial || ['logistics.eway_bill_number', 'logistics.vehicle_number', 'logistics.lr_number', 'e_invoice.ack_number'].includes(path);
    canonical[group][key] = selectCandidate(candidateValues(ctx, field, parser, wordScoped ? { singleWord: true, allowSpatial: !financial, ...(financial ? { preferredPageTypes: ['TAX_INVOICE', 'E_INVOICE_REPORT'] } : {}) } : {}), path, canonical);
  }
  canonical.totals.subtotal ??= canonical.totals.taxable_amount;
  canonical.totals.taxable_amount ??= canonical.totals.subtotal;
  canonical.items = [];
  canonical.related_documents = relatedDocuments(ctx, canonical);
  if (!canonical.invoice.number) {
    const supporting = canonical.related_documents.find(related => related.type === 'E_INVOICE_REPORT' && related.document_number);
    if (supporting) {
      const supportingEvidence = canonical.field_evidence[`related.${supporting.page}.document_number`];
      const supportingConfidence = Math.min(0.82, Math.max(0, Number(supportingEvidence?.confidence) || 0));
      canonical.invoice.number = supporting.document_number;
      canonical.field_evidence['invoice.number'] = { value: supporting.document_number, confidence: supportingConfidence, ocrConfidence: supportingEvidence?.ocrConfidence, relationship: supportingEvidence?.relationship, source: 'cross_document', matchedLabel: 'Document No', page: supporting.page, bbox: supportingEvidence?.bbox || null, candidates: [{ value: supporting.document_number, confidence: supportingConfidence, source: 'cross_document', page: supporting.page }] };
    }
  }
  const invoiceEvidence = canonical.field_evidence['invoice.number'];
  const eInvoiceNumbers = canonical.related_documents.filter(related => related.type === 'E_INVOICE_REPORT' && related.document_number);
  if (invoiceEvidence && eInvoiceNumbers.length) {
    const matching = eInvoiceNumbers.find(related => normalizeLabel(related.document_number, false) === normalizeLabel(invoiceEvidence.value, false));
    if (matching) invoiceEvidence.confidence = Math.min(0.99, invoiceEvidence.confidence + 0.08);
    else {
      canonical.conflicts.push({ field: 'invoice.number', values: [invoiceEvidence.value, ...eInvoiceNumbers.map(related => related.document_number)], pages: [invoiceEvidence.page, ...eInvoiceNumbers.map(related => related.page)], reason: 'Tax invoice and e-invoice report disagree.' });
      invoiceEvidence.confidence = Math.min(invoiceEvidence.confidence, 0.55);
    }
    invoiceEvidence.candidates = [...(invoiceEvidence.candidates || []), ...eInvoiceNumbers.map(related => ({ value: related.document_number, confidence: canonical.field_evidence[`related.${related.page}.document_number`]?.confidence || 0, source: 'e_invoice_document_number', page: related.page }))].slice(0, 8);
  }
  if (!canonical.invoice.date) {
    const supporting = canonical.related_documents.find(related => related.type === 'E_INVOICE_REPORT' && related.document_date) || canonical.related_documents.find(related => related.date);
    if (supporting) {
      canonical.invoice.date = supporting.document_date || supporting.date;
      canonical.field_evidence['invoice.date'] = { value: canonical.invoice.date, confidence: 0.8, source: 'cross_document', matchedLabel: 'Document Date', page: supporting.page, bbox: null, candidates: [{ value: canonical.invoice.date, confidence: 0.8, source: 'cross_document', page: supporting.page }] };
    }
  }
  canonical.logistics.eway_bill_number ||= canonical.related_documents.find(related => related.eway_bill_number)?.eway_bill_number || null;
  return canonical;
}

function toLegacyInvoice(canonical) {
  const items = [];
  const vendor = { ...canonical.supplier, phone: null, email: null };
  const amounts = { subtotal: canonical.totals.subtotal, taxableAmount: canonical.totals.taxable_amount, cgst: canonical.taxes.cgst, sgst: canonical.taxes.sgst, igst: canonical.taxes.igst, cess: canonical.taxes.cess, discount: canonical.totals.discount, otherCharges: canonical.totals.other_charges, roundOff: canonical.totals.round_off, total: canonical.totals.grand_total };
  return { documentType: canonical.document_type, invoiceNumber: canonical.invoice.number, invoice_number: canonical.invoice.number, invoiceDate: canonical.invoice.date, invoice_date: canonical.invoice.date, poNumber: canonical.invoice.po_number, vendor, vendor_name: vendor.name, vendorGstin: vendor.gstin, vendor_gstin: vendor.gstin, buyer: canonical.buyer, buyer_name: canonical.buyer.name, buyer_gstin: canonical.buyer.gstin, logistics: canonical.logistics, eInvoice: canonical.e_invoice, relatedDocuments: canonical.related_documents, amounts, subtotal: amounts.subtotal, taxable_amount: amounts.taxableAmount, cgst: amounts.cgst, sgst: amounts.sgst, igst: amounts.igst, cess: amounts.cess, discount: amounts.discount, round_off: amounts.roundOff, total: amounts.total, items, fieldEvidence: canonical.field_evidence, conflicts: canonical.conflicts, canonical };
}

function extractInvoice(input) { return toLegacyInvoice(extractStructuredDocument(input)); }

module.exports = { extractInvoice, extractStructuredDocument, toLegacyInvoice, cleanAmount, dateValue, GSTIN_PATTERN, PAN_PATTERN };
