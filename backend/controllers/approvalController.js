const prisma = require('../lib/prisma');
const { audit, assertCompanyAccess, financeId, financeJson } = require('../lib/finance');
const { ApiError, NotFoundError, ValidationError } = require('../lib/errors');

const ACTIONS = ['APPROVED', 'REJECTED', 'RETURNED'];

async function salesOrder(tx, req, id) {
  const order = await tx.customer_order.findUnique({ where: { customer_order_id: id }, include: { customer: true } });
  if (!order) throw new NotFoundError('sales order');
  assertCompanyAccess(req, order.customer.company_id);
  return order;
}

async function createRequest(req, res) {
  const workflowId = financeId(req.body.approval_workflow_id, 'approval_workflow_id');
  const transactionId = financeId(req.body.transaction_id, 'transaction_id');
  if (typeof req.body.transaction_type !== 'string' || !req.body.transaction_type.trim()) throw new ValidationError('transaction_type is required');
  const transactionType = req.body.transaction_type.trim();
  const result = await prisma.$transaction(async tx => {
    const workflow = await tx.approval_workflow.findUnique({ where: { approval_workflow_id: workflowId }, include: { approval_step: { orderBy: { step_number: 'asc' } } } });
    if (!workflow?.is_active || workflow.transaction_type !== transactionType) throw new ValidationError('Active approval workflow must match transaction_type');
    if (transactionType === 'SALES_ORDER' && !workflow.approval_step.length) throw new ValidationError('Sales-order approval workflow has no steps');
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`${transactionType}:${transactionId}:approval`}, 0::bigint))`;
    if (transactionType === 'SALES_ORDER') {
      const order = await salesOrder(tx, req, transactionId);
      if (order.status !== 'DRAFT') throw new ApiError(409, 'Only DRAFT sales orders can be submitted for approval');
    }
    const latest = await tx.approval_request.findFirst({ where: { transaction_type: transactionType, transaction_id: transactionId }, orderBy: { request_version: 'desc' } });
    if (transactionType === 'SALES_ORDER' && latest && !['REJECTED', 'RETURNED', 'CANCELLED'].includes(latest.status)) throw new ApiError(409, `Sales order already has a ${latest.status} approval request`);
    const request = await tx.approval_request.create({ data: { approval_workflow_id: workflowId, transaction_type: transactionType,
      transaction_id: transactionId, requester_id: req.user.user_id, current_step_number: workflow.approval_step[0]?.step_number || 1,
      remarks: typeof req.body.remarks === 'string' ? req.body.remarks : undefined, request_version: (latest?.request_version || 0) + 1 } });
    await audit(tx, req.user.user_id, 'APPROVAL_REQUESTED', 'approval_request', request.approval_request_id, undefined, request);
    return request;
  });
  res.status(201).json({ success: true, data: financeJson(result) });
}

async function act(req, res) {
  const requestId = financeId(req.body.approval_request_id, 'approval_request_id');
  if (!ACTIONS.includes(req.body.action)) throw new ValidationError(`action must be one of ${ACTIONS.join(', ')}`);
  const result = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "approval_request_id" FROM "public"."approval_request" WHERE "approval_request_id" = ${requestId} FOR UPDATE`;
    const request = await tx.approval_request.findUnique({ where: { approval_request_id: requestId }, include: { approval_workflow: { include: { approval_step: { orderBy: { step_number: 'asc' } } } } } });
    if (!request) throw new NotFoundError('approval request');
    if (request.status !== 'PENDING') throw new ApiError(409, `Approval request is already ${request.status}`);
    if (!request.approval_workflow.is_active || request.approval_workflow.transaction_type !== request.transaction_type) throw new ApiError(409, 'Approval workflow is inactive or mismatched');
    if (req.body.transaction_type !== undefined && req.body.transaction_type !== request.transaction_type) throw new ValidationError('transaction_type does not match approval request');
    if (req.body.transaction_id !== undefined && financeId(req.body.transaction_id, 'transaction_id') !== request.transaction_id) throw new ValidationError('transaction_id does not match approval request');
    if (request.transaction_type === 'SALES_ORDER') await salesOrder(tx, req, request.transaction_id);
    if (request.requester_id === req.user.user_id) throw new ApiError(403, 'Requester cannot approve or reject their own transaction');
    const step = request.approval_workflow.approval_step.find(row => row.step_number === request.current_step_number);
    if (!step) throw new ApiError(409, 'Current approval step is not configured');
    if (step.role_id && step.role_id !== req.user.role_id) throw new ApiError(403, 'Current approval step requires a different role');
    const action = await tx.approval_action.create({ data: { approval_request_id: requestId, approval_workflow_id: request.approval_workflow_id,
      approval_step_id: step.approval_step_id, transaction_type: request.transaction_type, transaction_id: request.transaction_id,
      action_by: req.user.user_id, action: req.body.action, comments: typeof req.body.comments === 'string' ? req.body.comments : undefined } });
    let updatedRequest;
    if (req.body.action !== 'APPROVED') {
      updatedRequest = await tx.approval_request.update({ where: { approval_request_id: requestId }, data: { status: req.body.action, completed_at: new Date() } });
    } else {
      const next = request.approval_workflow.approval_step.find(row => row.step_number > step.step_number && row.is_mandatory);
      updatedRequest = await tx.approval_request.update({ where: { approval_request_id: requestId }, data: next ? { current_step_number: next.step_number } : { status: 'APPROVED', completed_at: new Date() } });
      if (!next && request.transaction_type === 'SALES_ORDER') {
        const changed = await tx.customer_order.updateMany({ where: { customer_order_id: request.transaction_id, status: 'DRAFT' }, data: { status: 'OPEN' } });
        if (changed.count !== 1) throw new ApiError(409, 'Sales order is no longer eligible for approval');
      }
    }
    await audit(tx, req.user.user_id, `APPROVAL_${req.body.action}`, 'approval_request', requestId, request, { request: updatedRequest, action });
    return { request: updatedRequest, action };
  });
  res.status(201).json({ success: true, data: financeJson(result) });
}

module.exports = { createRequest, act };
