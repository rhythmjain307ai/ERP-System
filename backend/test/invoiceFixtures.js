const invoiceText = number => `ABC Steel Industries
Tax Invoice
Supplier: ABC Steel Industries
GSTIN: 27AAECA1234F1Z5
Invoice No: ${number}
Invoice Date: 21/09/2026
Buyer: Forge Works
Buyer GSTIN: 29AAACB1234C1Z1
Steel bars HSN: 7214 100 KG 850.00 85000.00
Taxable Amount: 85000.00
CGST 9%: 7650.00
SGST 9%: 7650.00
Grand Total: 100300.00`;

// Minimal valid PDF with byte-accurate xref offsets, using only synthetic test data.
function pdf(text) {
  const stream = 'BT /F1 14 Tf 40 780 Td 20 TL ' + text.split('\n').map((line, index) => `${index ? 'T* ' : ''}(${line.replace(/[\\()]/g, '\\$&')}) Tj`).join('\n') + ' ET';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 840] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
  let body = '%PDF-1.4\n', offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(body)); body += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(body);
}
module.exports = { pdf, invoiceText };
