# Phase 2 implementation and validation report

The remaining backend roadmap through 2O is implemented in this checkout.
Phases 2A–2E were supplied as completed; their invoice tests remain in the full
suite. Phases 2F–2O are covered below. Changes are uncommitted.

## 1. Phase 0 audits

Before implementation of each phase, the active schema, affected controllers,
routes and tests were reviewed. The audit/plan findings were reported in the
conversation before continuing under “complete all parts of phase 2”.

| Phase | Findings before implementation |
| --- | --- |
| 2F | Booking changed only invoice status. AP already had a unique nullable vendor_invoice_id, money columns and OPEN status. No AP reversal workflow existed. |
| 2G | AP had persisted balances/statuses but no dedicated read endpoints or recalculation/aging helper. Stored status could become stale as dates passed. |
| 2H | Payment, bank and AP models existed, with mode/type CHECK constraints. No vendor payment endpoint; no direct AP field on payment. |
| 2I | Allocation table existed. No transactional allocation controller, payment/AP lock ordering, or concurrent over-allocation protection. |
| 2J | Accounting entries, journals, lines and chart of accounts existed. No explicit company GL configuration, bank GL mapping, or booking/allocation posting hook. |
| 2K | Original schemas lacked reversal links and allocation reversal metadata. Deleting allocations would destroy history; generic journal reversal would desynchronize AP. |
| 2L | Vendor ledger table existed but no reliable maintained statement workflow. Posted accounting events could provide a single source for dated balances. |
| 2M | Bank transactions had an optional payment link but no unique link or reconciliation lifecycle. Matching needed payment-first locks shared with reversal. |
| 2N | Financial audit helper and reversal/journal/reconciliation events existed after earlier phases. Invoice/AP/payment/allocation creation actors needed completion. |
| 2O | AP aging and vendor ledger existed. Remaining financial reports needed journal-based date boundaries, reversal handling and exact Decimal aggregation. |

## 2. Current state

- **2F:** Booking locks the invoice, creates exactly one OPEN AP with paid=0
  and outstanding=invoice total in the same transaction. Duplicate requests fail.
  Cancellation uses **Option A**: once AP exists, normal cancellation is blocked.
- **2G:** Exact Decimal balance/status calculation; current effective OPEN,
  PARTIALLY_PAID, PAID, OVERDUE and CANCELLED states; UTC aging buckets; AP list,
  detail and vendor views. Ordinary recalculation cannot reopen PAID AP.
- **2H:** Validated VENDOR_PAYMENT creation with AP/vendor ownership, amount,
  date, mode and company bank checks. No allocation or journal at creation.
  Requested AP intent is retained in the creation audit.
- **2I:** Partial/full allocations across multiple APs/payments; payment-first,
  ordered AP locks; aggregate balance checks; atomic AP updates; rollback on errors.
- **2J:** Invoice debit to inventory/expense and input tax, credit to AP.
  Allocation debit to AP and credit to configured cash/bank. Exact balance check,
  unique accounting source, and source/journal/audit transaction rollback.
- **2K:** Invoice, payment and manual journal reversal endpoints; original rows
  retained; linked reversing entries; mandatory reason; duplicate prevention.
  Payment reversal restores AP from surviving allocations. Invoice reversal
  requires no active allocations and cancels AP while retaining BOOKED invoice
  amounts and lines. Managed journals reverse through their source endpoint.
- **2L:** Vendor ledger/statement with dated opening, ordered running balances,
  invoices, allocated payments, reversal adjustments and closing balance.
- **2M:** Bank transaction creation, explicit matching/unmatching, reconciliation,
  and per-status report. One statement transaction per payment, with exact
  amount/direction/bank/company matching and concurrency protection.
- **2N:** Authenticated actor IDs, timestamps and transactional audit snapshots
  for invoice creation/booking/cancellation, AP, payments, allocation, posting,
  reversal, configuration and bank reconciliation. Client actor fields ignored.
- **2O:** AP aging, vendor outstanding, purchase and GST registers, vendor ledger,
  procurement cash-flow impact, trial balance and general ledger. Reversed
  original journals remain in historical totals alongside dated reversing entries.

## 3. Risks and operational limits

1. **Production deployment has not happened.** Apply the approved additive migration
   through the environment's normal deployment process only after separate
   authorization. Regenerate Prisma client and configure GL mappings before booking.
2. No historical backfill: legacy booked invoices/AP without journals and mismatched
   historical allocation totals require reconciliation. They are not silently
   reconstructed. Journal-derived statements/registers exclude sources without
   journal postings. Nullable historical actor fields remain unknown.
3. Before production migration, inspect duplicate non-null bank payment links and
   company/source posting keys. The unique indexes deliberately fail on duplicates;
   no records are merged/deleted. Existing linked bank rows also require reviewed
   reconciliation-state initialization; this migration does not invent history.
4. The pre-existing baseline migration contains an invalid PostgreSQL column
   default: weighbridge net_weight_kg DEFAULT (gross_weight_kg - tare_weight_kg).
   It was not modified. The disposable database was initialized from the active
   schema with 120 existing CHECK constraints, then the approved additive migration
   was applied transactionally. This validates the additive migration and final
   schema, not a clean replay of the entire historical migration chain.
5. AP aging/outstanding are **current** reports, not historical AP snapshots.
   Historical statements/TB/GL use posted dates. Unallocated payments have no
   accounting entry and are excluded from the procurement cash-flow/ledger reports.
6. Bank matching is one-to-one; splitting a bank line, bank-feed ingestion and
   undoing a RECONCILED link are outside this phase. A linked payment cannot be
   reversed; a MATCHED link can first be unmatched. RECONCILED links are terminal.
7. Configured accounts must be active and in the same company. Reversal also
   validates historical journal accounts; inactive accounts must be reviewed
   before reversal. No inventory quantity/stock posting behavior was changed.
8. New dated reports return complete result sets in a consistent database snapshot;
   large-volume streaming/export and pagination are not implemented. Existing AP
   list pagination and chunked aging remain available.
9. Audit logs are append-only through these workflows; this is not database-level
   tamper-proof storage against a privileged database operator.
10. Existing authorization semantics are retained: these procurement endpoints
    use requireAuth and procurement.write. No new company-membership/RBAC model
    or financial permission roles were introduced.

## 4. Implementation plan and execution

| Phase | Executed plan |
| --- | --- |
| 2F | Lock invoice, enforce existing unique AP link, create AP atomically, block normal cancellation after AP. |
| 2G | Centralize exact balance/status/aging calculation; add filtered, paginated read endpoints and tests. |
| 2H | Validate vendor/AP/money/mode/bank, create only payment, persist audit in same transaction. |
| 2I | Lock payment then ascending AP IDs, validate active allocation sums, insert allocations and recalculate AP atomically. |
| 2J | Add approved explicit GL mappings and posting identity; post balanced journals inside booking/allocation transactions. |
| 2K | Add approved reversal metadata; append reversing entries, retain sources, recalculate surviving settlement balances. |
| 2L | Derive dated statement events from accounting sources and their reversals with deterministic ordering. |
| 2M | Use unique bank/payment link, shared lock ordering and explicit status transitions; audit every change. |
| 2N | Fill actor/time fields from authenticated user; add creation/lifecycle snapshots; test spoofing and rollback. |
| 2O | Reuse AP aging/vendor ledger; build company-filtered Decimal reports from source/journal events; validate cross-report balances. |

## 5. Files changed

Paths below are relative to this checkout.

Existing files modified:
- backend/controllers/erpController.js: invoice booking/AP/posting and lifecycle audit.
- backend/routes/moduleRoutes.js: finance and reporting routes.
- backend/prisma/schema.prisma: approved financial fields, configuration and relations.
- backend/package.json: include focused financial suites in npm test.
- backend/test/setup.js: isolated financial fixtures and cleanup.
- backend/test/vendorInvoice.test.js: AP booking/race/rollback tests and accounting expectations.

New controllers:
- backend/controllers/accountsPayableController.js
- backend/controllers/paymentController.js
- backend/controllers/financeConfigController.js
- backend/controllers/reversalController.js
- backend/controllers/vendorLedgerController.js
- backend/controllers/bankReconciliationController.js
- backend/controllers/financialReportsController.js

New helpers:
- backend/lib/accountsPayable.js
- backend/lib/finance.js
- backend/lib/accounting.js
- backend/lib/vendorLedger.js

Migration:
- backend/prisma/migrations/2_financial_workflows/migration.sql

Documentation/evidence:
- PHASE_2_REMAINING_PLAN.md
- PHASE_2_COMPLETION_REPORT.md
- phase2-validation/: local-only captured successful focused/full output for each phase (ignored by Git).

## 6. Tests added

- vendorInvoice.test.js: AP uniqueness, duplicate booking, cancellation,
  concurrent transitions, rollback, precision, zero/negative totals and legacy behavior.
- accountsPayable.test.js: 31 balance/status, aging, pagination, validation,
  transaction lock, terminal state and read-only tests.
- payment.test.js: 8 money/creation/validation/bank/authentication/rollback tests.
- allocation.test.js: 8 full/partial/multi allocation, concurrent limits,
  rollback and inconsistent legacy balance tests.
- accounting.test.js: 6 GL component/balancing, cash journal,
  missing mapping/imbalance rollback and invalid configuration tests.
- reversal.test.js: 6 invoice/payment/manual journal reversal,
  retained history, restored AP, validation and rollback tests.
- vendorLedger.test.js: 3 exact running/opening balance, reversal history,
  date validation and vendor isolation tests.
- bankReconciliation.test.js: 5 bank journal/matching/reconciliation,
  invalid match, concurrent uniqueness, unmatch/reversal and rollback tests.
- financialAudit.test.js: 3 authenticated actor/timestamp, cancellation snapshot
  and audit-failure rollback tests.
- financialReports.test.js: 5 cross-report reconciliation, tax components,
  historical reversals, read-only cash impact and company/range validation tests.
- financeFixtures.js: reusable booked invoice/payment/allocation fixtures.

## 7. Exact test results

Each row is the final successful gate at that phase. Failures=0 and skipped=0 in
all focused/full results below. Both commands exited 0. Full output is retained
locally in the Git-ignored phase2-validation/2<letter>-focused.log and
2<letter>-full.log files.

| Phase | Syntax checks passed | Focused passed/total | Full npm test passed/total |
| --- | ---: | ---: | ---: |
| 2F | 4/4 affected files | 76/76 | 147/147 |
| 2G | 7/7 affected files | 107/107 | 178/178 |
| 2H | 35/35 backend JS files | 8/8 | 186/186 |
| 2I | 36/36 | 47/47 | 194/194 |
| 2J | 39/39 | 90/90 | 200/200 |
| 2K | 42/42 | 20/20 | 206/206 |
| 2L | 45/45 | 9/9 | 209/209 |
| 2M | 47/47 | 11/11 | 214/214 |
| 2N | 48/48 | 85/85 | 217/217 |
| 2O | 50/50 | 39/39 | 222/222 |

Final full suite output:

    tests 222
    pass 222
    fail 0
    cancelled 0
    skipped 0
    todo 0

Prisma validate: exit 0, schema valid.
Read-only Prisma migrate diff from disposable database to schema: exit 0,
“No difference detected.” Prisma diff does not compare CHECK constraints.
git diff --check: exit 0.

Corrections/retries: Phase 2H initially exposed Decimal audit serialization,
fixed using financeJson. Phase 2N's first runner invocation used the wrong working
directory and did not execute tests; its first focused run passed 83/85 because
two new fixtures lacked required due_date. Corrected fixtures, then 85/85 and
217/217 passed. Phase 2O focused passed 39/39; first full run passed 221/222 with
one ECONNRESET/socket hang up in AP pagination. Without code changes, reran both
gates successfully: 39/39 and 222/222.

Runtime: Node 24.19.0, Prisma 6.19.3, isolated local PostgreSQL, TEST_DATABASE_URL
explicitly set to erp_phase2f_test on port 56432. Integration tests actually ran.
The test server is stopped after validation; data retained for inspection.

Reproduce against a separately prepared disposable database with the final schema
and CHECK constraints:

    cd backend
    TEST_DATABASE_URL=<disposable-database-url> npm test
    TEST_DATABASE_URL=<disposable-database-url> node --test --test-concurrency=1 test/financialReports.test.js test/accountsPayable.test.js test/vendorLedger.test.js
    DATABASE_URL=<disposable-database-url> npx prisma validate

Use node --check on the JS files in controllers, lib, routes, test and middleware
for the syntax gate. Do not point test cleanup at a real business database.

## 8. Confirmations

- User authorized continuing all remaining Phase 2 work.
- User explicitly approved the proposed schema and **test-only** migration:
  “Approve schema and test migration”.
- Approved additive migration applied only to the disposable database.
- No auth/RBAC implementation or inventory posting modifications.
- Completed invoice logic touched only where required for AP, accounting and audit.
- No production or development database migration was performed during implementation.
- Normal cancellation after AP creation remains blocked; explicit audited reversal
  is the separate Phase 2K workflow.

## API contracts

All paths below have prefix /api/procurement. New routes use the existing
requireAuth + procurement.write middleware.

| Method/path | Main input |
| --- | --- |
| GET /accounts-payable | vendor_id, company_id, status, page, pageSize |
| GET /accounts-payable/:id | AP ID |
| GET /accounts-payable/aging | optional vendor_id/company_id/status; current balances |
| GET /vendors/:vendorId/accounts-payable | pagination/status |
| POST /payments | vendor_id, accounts_payable_id, amount, payment_type=VENDOR_PAYMENT, mode, optional payment_date/reference_number/remarks; non-CASH requires bank_account_id |
| POST /payments/:id/allocations | allocations: array of accounts_payable_id + allocated_amount |
| PUT /finance-config/:companyId | all nine GL mapping IDs below |
| PATCH /bank-accounts/:id/gl-account | gl_account_id |
| POST /vendor-invoices/:id/reverse | reason, optional reversal_date |
| POST /payments/:id/reverse | reason, optional reversal_date |
| POST /journals/:id/reverse | reason, optional reversal_date; MANUAL sources only |
| GET /vendors/:vendorId/ledger | optional from/to inclusive YYYY-MM-DD |
| GET /vendors/:vendorId/statement | same statement with date range |
| POST /bank-transactions | bank_account_id, amount, transaction_type=DEBIT/CREDIT, optional transaction_date/reference_number/description |
| POST /bank-transactions/:id/match | payment_id |
| POST /bank-transactions/:id/unmatch | empty body |
| POST /bank-transactions/:id/reconcile | empty body |
| GET /bank-reconciliation | bank_account_id, optional from/to |
| GET /reports/accounts-payable-aging | optional company_id/vendor_id/status; current balances |
| GET /reports/vendor-outstanding | required company_id; current balances |
| GET /reports/purchase-register | required company_id, optional from/to |
| GET /reports/gst-purchase-register | required company_id, optional from/to |
| GET /reports/vendors/:vendorId/ledger | optional from/to |
| GET /reports/cash-flow-impact | required company_id, optional from/to |
| GET /reports/trial-balance | required company_id, optional from/to |
| GET /reports/general-ledger | required company_id, optional account_id/from/to |

Date-range defaults: from=1970-01-01, to=current UTC day. Vendor balances are
credit-positive (amount owed); trial balance/GL balances are debit-positive.
Monetary report values and bigint IDs are JSON strings.

GL mapping request fields: inventory_account_id (ASSET), expense_account_id
(EXPENSE), input_cgst_account_id, input_sgst_account_id, input_igst_account_id,
input_cess_account_id (all ASSET), payable_account_id (LIABILITY),
cash_account_id (ASSET), rounding_account_id (EXPENSE).
All accounts must belong to the company and be active. Bank GL must be ASSET.
