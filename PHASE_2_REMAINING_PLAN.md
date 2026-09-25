# Remaining Phase 2 implementation and schema approval proposal

## Authorization and boundaries

The user authorized completing remaining phases sequentially, with Phase 0 audits,
syntax checks, focused tests, and full npm test for every phase. Existing Phase
2F/2G edits were preserved. No auth, RBAC, or inventory posting changes were planned.
The user subsequently approved these schema changes and the disposable test migration
with “Approve schema and test migration”. Development/production application is not approved.

## Phase 2H audit and plan

Reviewed schema.prisma payment, bank_account, accounts_payable, vendor and existing
PostgreSQL CHECK constraints, AP/invoice controllers, moduleRoutes, error handling,
and invoice/AP integration fixtures and tests. There is no payment endpoint.
Existing payment modes are BANK, CASH, CHEQUE, UPI, NEFT, RTGS, IMPS, OTHER.
The vendor endpoint will accept VENDOR_PAYMENT only; customer receipts and expense
payments are different workflows. It will validate AP ownership, vendor activity,
positive two-decimal amount and company ownership of an active bank account for
non-cash payment modes. Creation will not allocate, update AP or create journals.
The supplied AP ID validates payment intent; the existing payment table has no AP
link. Preserve that intent in a transactional audit record, not a fake allocation.
Use existing procurement.write middleware without changing permission definitions.

## Phase 2I preliminary plan

Lock payment first, then all target AP rows in ID order. Validate total allocation
against unallocated payment amount and individual AP outstanding; enforce same
vendor. Insert allocation rows and update AP paid/outstanding/status in one
transaction. Reject inconsistent legacy paid totals rather than silently reset
them. Test partial/full, multiple APs/payments, races, over-allocation and rollback.

## Approved schema changes (applied only to the disposable test database)

1. Explicit accounting mappings: add company_finance_config, one row per company,
   containing inventory, purchase expense, input CGST/SGST/IGST/cess, accounts payable,
   cash, and rounding GL account foreign keys. Add bank_account.gl_account_id.
   Account mappings must be active, have appropriate account types, and belong to
   the same company. Configuration is explicit; never guess accounts by name/code.
2. Payment lifecycle: add payment.status (CREATED/REVERSED), created_by/created_at,
   reversed_by/reversed_at and reversal_reason. Add allocation reversal timestamps
   and actors so original allocations remain immutable and can be excluded from
   active settlement totals without deleting their history.
3. Reversal linkage: add unique reversal_of_id self-relations to accounting_entry
   and journal_entry. A source can have only one reversing entry. Add durable
   vendor_invoice reversal actor/time/reason while keeping the original BOOKED
   invoice's amounts and lines immutable; AP becomes CANCELLED only through the
   explicit reversal operation. Reject invoice reversal while active allocations
   exist; reverse payments first. Managed journals can only be reversed through
   their source operation, keeping AP/payment state consistent.
4. Posting identity: add an appropriate unique company/source_type/source_id key
   to accounting_entry for idempotent posting. Validate legacy duplicates before
   applying any unique constraint; never delete or silently consolidate records.
5. Bank reconciliation: retain bank_transaction.payment_id as the link and add
   reconciliation_status (UNRECONCILED/MATCHED/RECONCILED), matched_by/matched_at,
   reconciled_by/reconciled_at. Matching must check bank, vendor payment type,
   direction, amount, and already-linked transactions under locks. Add a unique
   payment link for this phase's one-bank-transaction-per-payment matching scope.
6. Audit: add invoice created/booked/cancelled actor/time and AP created actor/time,
   allocation actor, and reversal metadata with nullable fields for existing rows.
   Continue transactional append-only audit_log records, taking actor IDs from
   authenticated req.user, never request-body actor fields. Historical actors must
   remain unknown rather than fabricated.

Approval requested: edit schema.prisma and create an additive migration for these
changes; generate Prisma client; apply only to a disposable test database. No
development/production migration, destructive reset, or historical data rewrite
is authorized by this proposal.

## Remaining phase behavior

- 2J: automatic balanced invoice/allocation journals in the same source transaction;
  reject missing mappings or imbalance and roll back the whole operation. Booking
  uses invoice date; allocation uses its posting date. Carry rounding separately.
- 2K: append reversing journals; mark source reversal metadata without hard deletes;
  restore AP balances from surviving allocations on payment reversal. Preserve the
  normal PAID-terminal rule outside the explicit reversal workflow.
- 2L: vendor ledger from posted events, including reversing events; dated opening,
  running and closing balances. Support inclusive date ranges with documented defaults; stable ordering.
- 2M: bank matching/reconciliation endpoints and report with actor/time history.
- 2N: transactional audit coverage and spoofed-actor/rollback tests for all actions.
- 2O: AP aging/outstanding, purchase/GST registers, vendor ledger, cash-flow impact,
  trial balance and general ledger, accounting for reversals and date boundaries.

Each later phase will receive a fresh audit of then-current schema, affected code,
routes and tests before implementation. This preliminary plan does not replace it.

## Open constraints

Historical booked invoices without journals/AP cannot be silently reconstructed.
The pre-existing baseline migration has a problematic weighbridge default. Test
setup uses the active schema plus existing CHECK constraints, as in phases 2F/2G.
Production deployment and historical backfill are outside this change.
