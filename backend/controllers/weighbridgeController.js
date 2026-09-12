const prisma = require('../lib/prisma');
const { NotFoundError, ValidationError } = require('../lib/errors');
const { calculateNetWeight, decimal } = require('../lib/weighbridge');

function id(value, field) {
  try { return BigInt(value); } catch { throw new ValidationError(`${field} must be an integer`); }
}

function date(value) {
  return value === undefined ? undefined : new Date(value);
}

function relationData(body) {
  return {
    grn_id: body.grn_id === undefined ? undefined : id(body.grn_id, 'grn_id'),
    delivery_id: body.delivery_id === undefined ? undefined : id(body.delivery_id, 'delivery_id'),
    job_work_challan_id: body.job_work_challan_id === undefined ? undefined : id(body.job_work_challan_id, 'job_work_challan_id')
  };
}

function hasRelation(data) {
  return data.grn_id !== undefined || data.delivery_id !== undefined || data.job_work_challan_id !== undefined;
}

function createData(body) {
  const relations = relationData(body);
  if (!body.ticket_number || !body.vehicle_number) throw new ValidationError('ticket_number and vehicle_number are required');
  if (!hasRelation(relations)) throw new ValidationError('one of grn_id, delivery_id, or job_work_challan_id is required');
  return {
    ticket_number: body.ticket_number,
    ticket_date: date(body.ticket_date),
    vehicle_number: body.vehicle_number,
    transporter: body.transporter,
    gross_weight_kg: decimal(body.gross_weight_kg, 'gross_weight_kg'),
    tare_weight_kg: decimal(body.tare_weight_kg, 'tare_weight_kg'),
    net_weight_kg: calculateNetWeight(body.gross_weight_kg, body.tare_weight_kg),
    ...relations,
    operator_name: body.operator_name,
    remarks: body.remarks
  };
}

async function create(req, res) {
  const data = createData(req.body);
  const result = await prisma.weighbridge_ticket.create({ data });
  res.status(201).json({ success: true, data: result });
}

async function update(req, res) {
  const ticketId = id(req.params.id, 'id');
  const existing = await prisma.weighbridge_ticket.findUnique({ where: { weighbridge_ticket_id: ticketId } });
  if (!existing) throw new NotFoundError('weighbridge ticket');

  const data = {
    ticket_number: req.body.ticket_number,
    ticket_date: date(req.body.ticket_date),
    vehicle_number: req.body.vehicle_number,
    transporter: req.body.transporter,
    operator_name: req.body.operator_name,
    remarks: req.body.remarks,
    ...relationData(req.body)
  };
  if (req.body.gross_weight_kg !== undefined || req.body.tare_weight_kg !== undefined) {
    const grossWeight = req.body.gross_weight_kg === undefined ? existing.gross_weight_kg : req.body.gross_weight_kg;
    const tareWeight = req.body.tare_weight_kg === undefined ? existing.tare_weight_kg : req.body.tare_weight_kg;
    data.gross_weight_kg = decimal(grossWeight, 'gross_weight_kg');
    data.tare_weight_kg = decimal(tareWeight, 'tare_weight_kg');
    data.net_weight_kg = calculateNetWeight(grossWeight, tareWeight);
  }
  Object.keys(data).forEach((key) => data[key] === undefined && delete data[key]);
  const result = await prisma.weighbridge_ticket.update({ where: { weighbridge_ticket_id: ticketId }, data });
  res.json({ success: true, data: result });
}

module.exports = { create, update };
