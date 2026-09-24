const FIELD_ALIASES = Object.freeze({
  'invoice.number': ['invoice number', 'invoice no', 'inv number', 'inv no', 'invoice #', 'inv #', 'bill number', 'bill no', 'tax invoice number', 'tax invoice no', 'document number', 'document no', 'reference number', 'reference no', 'ref no', 'invoice ref'],
  'invoice.date': ['invoice date', 'inv date', 'date of invoice', 'bill date', 'document date', 'dated'],
  'invoice.due_date': ['due date', 'payment due date'],
  'invoice.po_number': ['purchase order number', 'purchase order no', 'purchase order', 'p o number', 'p o no', 'po number', 'po no', 'buyer order number', 'buyer order no', 'order number', 'order no'],
  'supplier.name': ['supplier name', 'supplier s name', 'supplier', 'vendor name', 'vendor', 'seller name', 'seller', 'from'],
  'buyer.name': ['buyer name', 'buyer', 'recipient name', 'recipient', 'bill to', 'billed to', 'customer', 'consignee', 'ship to'],
  'supplier.gstin': ['supplier gstin', 'seller gstin', 'gstin of supplier', 'gstin supplier'],
  'buyer.gstin': ['buyer gstin', 'recipient gstin', 'gstin of recipient', 'gstin buyer', 'gstin recipient'],
  'logistics.eway_bill_number': ['e way bill number', 'e way bill no', 'eway bill number', 'eway bill no'],
  'logistics.vehicle_number': ['vehicle number', 'vehicle no', 'truck number', 'truck no'],
  'logistics.lr_number': ['lr number', 'lr no', 'lorry receipt number', 'lorry receipt'],
  'logistics.transporter': ['transporter name', 'transporter', 'dispatch through'],
  'logistics.place_of_supply': ['place of supply'],
  'e_invoice.irn': ['invoice reference number', 'irn number', 'irn no', 'irn'],
  'e_invoice.ack_number': ['acknowledgement number', 'acknowledgment number', 'ack number', 'ack no'],
  'e_invoice.ack_date': ['acknowledgement date', 'acknowledgment date', 'ack date'],
  'totals.subtotal': ['sub total', 'subtotal'],
  'totals.taxable_amount': ['taxable amount', 'taxable value', 'taxable amt', 'taxable value rs'],
  'totals.discount': ['discount amount', 'discount'],
  'totals.other_charges': ['other charges', 'packing charges', 'freight charges'],
  'totals.round_off': ['round off', 'roundoff'],
  'totals.grand_total': ['grand total', 'total invoice amount', 'total inv amt', 'invoice amount', 'invoice total', 'net amount', 'net total', 'amount payable', 'total payable', 'balance due'],
  'taxes.cgst': ['cgst amount', 'cgst'],
  'taxes.sgst': ['sgst amount', 'sgst'],
  'taxes.igst': ['igst amount', 'igst'],
  'taxes.cess': ['state cess', 'cess amount', 'cess'],
  'weighbridge.gross_weight': ['gross weight', 'gross wt', 'gross'],
  'weighbridge.tare_weight': ['tare weight', 'tare wt', 'tare'],
  'weighbridge.net_weight': ['net weight', 'net wt', 'net'],
  'weighbridge.serial_number': ['serial number', 'serial no', 'sl number', 'sl no'],
  'mrn.number': ['material receipt note number', 'material receipt note no', 'mrn number', 'mrn no', 'goods inward number', 'goods inward no'],
  'mrn.gate_entry_number': ['gate entry number', 'gate entry no'],
  'mrn.invoice_number': ['supplier invoice number', 'supplier invoice no', 'challan number', 'challan no', 'invoice number', 'invoice no'],
  'mrn.date': ['material receipt date', 'mrn date', 'goods inward date', 'date'],
});

const TABLE_ALIASES = Object.freeze({
  description: ['item description', 'description of goods', 'description', 'name of product', 'name of goods and services', 'name of goods services', 'product', 'particulars'],
  hsn_sac: ['hsn sac code', 'hsn sac', 'hsn code', 'sac code', 'hsn', 'sac'],
  quantity: ['received quantity', 'rec qty', 'challan quantity', 'chl qty', 'quantity', 'qty', 'qry', 'nos', 'number of units'],
  accepted_quantity: ['accepted quantity', 'accepted qty', 'acpt qty'],
  rejected_quantity: ['rejected quantity', 'rejected qty', 'rej qty'],
  unit: ['uom', 'unit', 'per'],
  unit_price: ['unit price', 'unit rate', 'price per unit', 'rate', 'price'],
  discount: ['discount amount', 'discount'],
  taxable_amount: ['taxable amount', 'taxable value', 'taxable amt'],
  gst_rate: ['gst rate', 'tax rate', 'gst'],
  cgst: ['cgst amount', 'cgst'],
  sgst: ['sgst amount', 'sgst'],
  igst: ['igst amount', 'igst'],
  cess: ['cess amount', 'cess'],
  line_total: ['line total', 'total amount', 'amount', 'total'],
  heat_number: ['heat number', 'heat no', 'heat'],
});

function normalizeLabel(value, tolerant = true) {
  let normalized = String(value || '')
    .normalize('NFKD')
    .replace(/[’'`]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  if (tolerant) {
    normalized = normalized
      .replace(/\b(?:n[o0]|num|nurn)\b/g, 'no')
      .replace(/\binv[o0]ice\b/g, 'invoice')
      .replace(/\bgstln\b/g, 'gstin')
      .replace(/\bquantlty\b/g, 'quantity');
  }
  return normalized;
}

function aliasesFor(field) {
  return (FIELD_ALIASES[field] || []).map(alias => normalizeLabel(alias, false));
}

module.exports = { FIELD_ALIASES, TABLE_ALIASES, normalizeLabel, aliasesFor };
