# Checkpoint 0 audit — 2026-11-06

## Scope and state

Local checkout: `main` at `75fe359` before this audit. `tasks/` was already untracked. This audit reads the active Prisma schema, migrations, route definitions, affected controllers, frontend API calls, and test setup. No Neon records or migrations were changed. The only application change in this session is authentication on generated generic GET routes, with one regression test.

## API ownership, authorization, and coverage map

`GET` and `:id` below include list/detail where exposed. “Company check” describes code observed, not a two-company integration proof. Tests named here are existing coverage, not a claim that they all passed in this session.

| API family | Data owner | Route access now | Company check observed | Relevant tests / gap |
| --- | --- | --- | --- | --- |
| `/api/master/{companies,factories,departments,employees,users,roles,permissions,customers,vendors,item-categories,inventory-items,warehouses,inventory-lots,stock-movements}` GET/list/detail | Direct company for factory/department/employee/customer/vendor; inherited via factory/warehouse for warehouse/lot/movement; global or undecided for company, users, role, permission, item/category | Authenticated after this change; writes require `master.write` | None in generic controller | `api.test.js` now checks anonymous GET; no two-company CRUD matrix yet |
| `/api/customers`, `/api/vendors` GET/list/detail | Direct company | Authenticated after this change; writes require `master.write` | None in generic controller | `api.test.js` anonymous GET; no cross-company test |
| `/api/inventory/{items,warehouses,lots,movements}` generic GET/list/detail | Item policy undecided; warehouse/lot/movement inherit factory company | Authenticated after this change; writes require `inventory.write` | None in generic controller | `api.test.js` anonymous GET; no two-company test; generic movement writes/deletes need lifecycle review |
| `/api/inventory/stocks`, `/api/inventory/movements` workflow reads | Warehouse → factory → company | Authenticated | No company predicate in list queries | `api.test.js` auth; `deliveryHardening.test.js` validates stock effects, not tenant reads |
| `/api/procurement/purchase-orders`, `/grns` GET/list/detail | Vendor and warehouse company | Authenticated | No company predicate in list/detail queries | `api.test.js` workflow auth; procurement tests cover business behavior, not tenant reads |
| Procurement requisition, PO, GRN create/post | Department/vendor/warehouse company | `procurement.write` for create; `inventory.write` for GRN post | Requires per-handler audit; PO create is generic parent/item insert | `api.test.js`, `vendorInvoice.test.js`; add cross-company relation tests |
| Vendor invoices, AP, vendor payments/allocations, ledger/reports, finance config, reversals, reconciliation | Vendor/company | Authenticated plus `procurement.write` on financial routes | Finance controllers generally call `assertCompanyAccess` or filter by company; audit all nested paths before declaring complete | `vendorInvoice`, `accountsPayable`, `payment`, `allocation`, `accounting`, `reversal`, `vendorLedger`, `bankReconciliation`, `financialReports` tests |
| Sales orders, invoices, deliveries | Customer company | Authenticated reads; `sales.write` writes; dispatch needs `inventory.write` | Active sales order/invoice/delivery list/detail controllers filter by company; writes check ownership | `salesOrder`, `salesOrderApproval`, `deliveryHardening`, `salesInvoice`, `orderToCashE2E` tests |
| AR, customer payments/allocations, ledger, sales reversals | Customer company | Authenticated plus `sales.write` on finance routes | Company checks observed in finance controllers | `accountsReceivable`, `customerPayment`, `customerAllocation`, `customerLedger`, `salesAccounting`, `salesReversal` tests |
| `/api/documents` and review/file endpoints | Document has uploader user but no direct `company_id` | Authenticated reads; `documents.write` writes; `documents.review` review read/write | No company filter in document list/detail/file/review | `documents`, `upload`, `ocr`, `pdf` tests; add cross-company access tests |
| Approval, production posting, weighbridge | Transaction/factory company | Authenticated and write permissions | Approval controller has company checks; production/weighbridge need focused audit | `salesOrderApproval`, `api`, `weighbridge` tests; tenant cases incomplete |
| `/health`, `/api/session-config` | No business record | Public | Not applicable | Basic health/session response only |

The frontend currently makes live API calls for procurement PO/GRN, sales order/delivery, inventory, and documents. The `Live API` badge is static UI text, not a connection-health check. Frontend finance/payment/report journeys remain a later roadmap package.

## Test and environment baseline

- Active Prisma schema validated successfully with `npx prisma validate`.
- JavaScript syntax check passed for all backend controllers, routes, middleware, libraries, and tests; affected route and test files also passed `node --check` after the change.
- Safe no-database baseline before the route change: **277 tests, 33 passed, 0 failed, 244 skipped**. After the route change: **278 tests, 34 passed, 0 failed, 244 skipped**. Both runs forced `DATABASE_URL` to an unreachable localhost address and `TEST_DATABASE_URL` to empty. Integration tests were intentionally skipped.
- The new focused regression test failed before the route change and passed after it: **1 passed, 0 failed** on the final focused run.
- The first test attempt unexpectedly loaded `backend/.env` through Prisma and tried to reach Neon; the connection failed. A second sandboxed run failed six HTTP tests because Supertest could not bind a local server. The final safe runs used explicit dummy database variables and local HTTP binding. Neither failed attempt established a backend regression or wrote test records.
- Five migration SQL files exist in this checkout. Current remote migration status was **not** queried because the user asked not to connect Neon for tests. The historical 277/277 integration claim is therefore not reverified.
- `backend/.env` contains both application and test URL variables. They share a database path and username but use different Neon hosts; independence is **not proven**. Treat the test URL as unsafe until a disposable database/branch is verified. No local PostgreSQL binary or Docker CLI was found.
- No `.github/workflows` files were found. A clean-checkout frontend browser smoke and separate staging environment were not available in this local audit.

## Checkpoint decision

Task 0.1 is complete as an inventory and risk map. Task 0.2 and Checkpoint 0 remain open: database integration tests, staging migration status, environment isolation, and a browser smoke need a verified disposable environment. The generic-read fix is a partial start on task 1.1; role-specific read policy and two-company tests remain open.
